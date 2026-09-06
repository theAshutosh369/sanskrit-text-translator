import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { structureDocument } from './parser.js';
import { ChatGPTBrowser } from './translator.js';
import { formatOutput } from './formatter.js';
import { validateOutput } from './validator.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const projectDir = path.join(root, '..');
const port = Number(process.env.PORT || 3000);
const profileDir = path.join(projectDir, '.chatgpt-profile');
const jobs = new Map();

function stats(units) {
  return {
    pages: new Set(units.filter(u => u.type === 'page').map(u => u.page)).size,
    units: units.filter(u => !['page', 'blank'].includes(u.type)).length,
    verses: units.filter(u => u.type === 'verse').length,
    headings: units.filter(u => u.type === 'heading').length,
    prose: units.filter(u => u.type === 'prose').length
  };
}

function pageGroups(units) {
  const groups = new Map();
  let page = null;
  for (const u of units) {
    if (u.type === 'page') {
      page = u.page;
      if (!groups.has(page)) groups.set(page, []);
      continue;
    }
    if (['blank'].includes(u.type)) continue;
    if (page == null) page = 1;
    if (!groups.has(page)) groups.set(page, []);
    groups.get(page).push(u);
  }
  return [...groups.entries()].map(([page, items]) => ({page, units: items}));
}

async function body(req) {
  const chunks=[];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function json(res, code, value) {
  const data=JSON.stringify(value);
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(data);
}

function event(job, type, message, extra = {}) {
  const item = {time:new Date().toISOString(), type, message, ...extra};
  job.events.push(item);
  for (const res of job.clients) res.write(`data: ${JSON.stringify(item)}\n\n`);
  console.log(`[${job.id}] ${message}`);
}

async function runJob(job) {
  let driver;
  try {
    event(job, 'info', 'Parsing document into page batches…');
    job.units = structureDocument(job.text);
    job.pages = pageGroups(job.units);
    job.totalPages = job.pages.length;
    event(job, 'info', `Found ${job.totalPages} pages and ${stats(job.units).units} translatable units.`);

    driver = new ChatGPTBrowser({
      profileDir,
      headless: false,
      timeoutMs: 240000,
      log: message => event(job, 'log', message)
    });
    await driver.connect();

    const byId = new Map(job.units.map(u => [u.id, u]));
    for (let i = 0; i < job.pages.length; i++) {
      if (job.cancelled) throw new Error('Translation cancelled by user.');
      const group = job.pages[i];
      job.currentPage = group.page;
      event(job, 'page-start', `Starting page ${group.page}/${job.totalPages} — one ChatGPT batch.`, {page: group.page, completed: i});
      const translated = await driver.translatePage(group.units, group.page, job.totalPages);
      for (const item of translated) byId.set(item.id, item);
      job.completedPages = i + 1;
      event(job, 'page-done', `Page ${group.page}/${job.totalPages} translated and received.`, {page: group.page, completed: job.completedPages, total: job.totalPages});
      const partial = [...byId.values()];
      job.partialUnits = partial;
      const partialOutput = formatOutput(job.units.map(u => byId.get(u.id) || u));
      await fs.writeFile(path.join(projectDir, `.translation-${job.id}.partial.txt`), partialOutput, 'utf8');
    }

    const resultUnits = job.units.map(u => byId.get(u.id) || u);
    const validation = validateOutput(job.units, resultUnits);
    job.output = formatOutput(resultUnits);
    job.validation = validation;
    job.status = validation.ok ? 'complete' : 'validation-error';
    event(job, validation.ok ? 'complete' : 'error', validation.ok ? 'Translation complete. Validation passed.' : `Translation finished but validation failed: ${validation.errors.join(' ')}`, {validation});
    if (validation.ok) await fs.writeFile(path.join(projectDir, `.translation-${job.id}.txt`), job.output, 'utf8');
  } catch (e) {
    job.status = job.cancelled ? 'cancelled' : 'error';
    event(job, 'error', e.message || String(e));
  } finally {
    await driver?.close();
    for (const res of job.clients) res.end();
  }
}

const server=http.createServer(async (req,res)=>{
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method==='POST' && url.pathname==='/api/parse') {
      const {text, filename='source.txt'}=JSON.parse(await body(req));
      if(typeof text!=='string') return json(res,400,{error:'text is required'});
      const units=structureDocument(text);
      return json(res,200,{units,filename,stats:stats(units),pages:pageGroups(units).map(x=>({page:x.page,units:x.units.length}))});
    }

    if (req.method==='POST' && url.pathname==='/api/jobs') {
      const {text,filename='source.txt'}=JSON.parse(await body(req));
      if(typeof text!=='string' || !text.trim()) return json(res,400,{error:'text is required'});
      const id=randomUUID();
      const job={id,text,filename,status:'queued',events:[],clients:new Set(),completedPages:0,currentPage:null,totalPages:0,output:'',validation:null,cancelled:false};
      jobs.set(id,job);
      void runJob(job);
      return json(res,202,{jobId:id});
    }

    if (req.method==='GET' && url.pathname.startsWith('/api/jobs/') && url.pathname.endsWith('/events')) {
      const id=url.pathname.split('/')[3]; const job=jobs.get(id);
      if(!job) return json(res,404,{error:'job not found'});
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Connection':'keep-alive'});
      for(const e of job.events) res.write(`data: ${JSON.stringify(e)}\n\n`);
      job.clients.add(res);
      req.on('close',()=>job.clients.delete(res));
      return;
    }

    if (req.method==='GET' && url.pathname.startsWith('/api/jobs/')) {
      const id=url.pathname.split('/')[3]; const job=jobs.get(id);
      if(!job) return json(res,404,{error:'job not found'});
      return json(res,200,{id:job.id,status:job.status,filename:job.filename,completedPages:job.completedPages,currentPage:job.currentPage,totalPages:job.totalPages,validation:job.validation,output:job.output});
    }

    if (req.method==='POST' && url.pathname.startsWith('/api/jobs/') && url.pathname.endsWith('/cancel')) {
      const id=url.pathname.split('/')[3]; const job=jobs.get(id);
      if(!job) return json(res,404,{error:'job not found'});
      job.cancelled=true;
      event(job,'info','Cancellation requested. The current ChatGPT response will finish before stopping.');
      return json(res,200,{ok:true});
    }

    let file=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
    if(file.includes('..')) return json(res,400,{error:'invalid path'});
    const p=path.join(publicDir,file);
    try {
      const data=await fs.readFile(p); const ext=path.extname(p);
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
      res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream'});res.end(data);
    } catch {
      if (extname(file) === '.ico') {res.writeHead(204);return res.end();}
      return json(res,404,{error:'not found'});
    }
  } catch(e) { console.error(e); if(!res.headersSent) json(res,500,{error:e.message}); else res.end(); }
});

function extname(file){return path.extname(file).toLowerCase();}

server.listen(port,()=>console.log(`Sanskrit Translator: http://localhost:${port}`));
