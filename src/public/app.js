const fileEl=document.querySelector('#file');
const nameEl=document.querySelector('#fileName');
const btn=document.querySelector('#translate');
const stopBtn=document.querySelector('#stop');
const status=document.querySelector('#status');
const preview=document.querySelector('#preview');
const statsEl=document.querySelector('#stats');
const logCard=document.querySelector('#logCard');
const logs=document.querySelector('#logs');
const clearLogs=document.querySelector('#clearLogs');
const progressText=document.querySelector('#progressText');
const progressPercent=document.querySelector('#progressPercent');
const progressBar=document.querySelector('#progressBar');
const liveResult=document.querySelector('#liveResult');
const liveOutput=document.querySelector('#liveOutput');
const livePages=document.querySelector('#livePages');
const result=document.querySelector('#result');
const output=document.querySelector('#output');
const validation=document.querySelector('#validation');
const download=document.querySelector('#download');

let parsed=null, outputText='', jobId=null, eventSource=null;

function log(text){
  const time=new Date().toLocaleTimeString();
  logs.textContent += `[${time}] ${text}\n`;
  logs.scrollTop=logs.scrollHeight;
}
function setProgress(done,total,current){
  const pct=total?Math.round(done/total*100):0;
  progressText.textContent=`${done} / ${total} pages${current?` — current: ${current}`:''}`;
  progressPercent.textContent=`${pct}%`;
  progressBar.style.width=`${pct}%`;
}
function resetResult(){
  output.textContent=''; validation.textContent=''; result.classList.add('hidden'); download.disabled=true; outputText='';
  liveOutput.textContent=''; livePages.textContent='0 pages compiled'; liveResult.classList.add('hidden');
}

fileEl.addEventListener('change', async()=>{
  const file=fileEl.files[0]; if(!file)return;
  nameEl.textContent=file.name; status.textContent='Reading and parsing…'; resetResult(); logs.textContent='';
  const text=await file.text();
  const r=await fetch('/api/parse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,filename:file.name})});
  const data=await r.json();
  if(data.error){status.textContent=data.error;return;}
  parsed={...data,text}; btn.disabled=false; stopBtn.disabled=true;
  preview.classList.remove('hidden'); logCard.classList.remove('hidden');
  statsEl.innerHTML=Object.entries(data.stats).map(([k,v])=>`<span class="stat"><b>${v}</b> ${k}</span>`).join('');
  setProgress(0,data.stats.pages,null);
  log(`Loaded ${file.name}`); log(`Detected ${data.stats.pages} pages and ${data.stats.units} translatable units.`); log('Translation mode: exactly ONE ChatGPT request per page.');
  status.textContent='Ready. Click Start Translation.';
});

btn.addEventListener('click',async()=>{
  if(!parsed)return;
  btn.disabled=true; stopBtn.disabled=false; resetResult(); status.textContent='Starting ChatGPT automation…';
  logCard.classList.remove('hidden');
  const r=await fetch('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:parsed.text,filename:parsed.filename})});
  const data=await r.json();
  if(data.error){status.textContent=data.error;btn.disabled=false;stopBtn.disabled=true;log(data.error);return;}
  jobId=data.jobId; log(`Job started: ${jobId}`);
  eventSource=new EventSource(`/api/jobs/${jobId}/events`);
  eventSource.onmessage=e=>handleEvent(JSON.parse(e.data));
  eventSource.onerror=()=>{};
});

function handleEvent(e){
  if(e.message) log(e.message);
  if(e.type==='page-start'){
    setProgress(e.completed,e.total,e.page);
    status.textContent=`Translating page ${e.page} of ${e.total} in ChatGPT…`;
  }
  if(e.type==='page-done'){
    setProgress(e.completed,e.total,e.page);
    if(typeof e.compiledOutput==='string'){
      liveOutput.textContent=e.compiledOutput;
      livePages.textContent=`${e.completed} / ${e.total} pages compiled`;
      liveResult.classList.remove('hidden');
      liveOutput.scrollTop=liveOutput.scrollHeight;
    }
    status.textContent=`Page ${e.page} translated. Compiled file updated live.`;
  }
  if(e.type==='complete' || e.type==='error'){
    stopBtn.disabled=true; btn.disabled=false;
    if(e.type==='complete'){
      status.textContent='Translation complete and validation passed.';
      fetch(`/api/jobs/${jobId}`).then(r=>r.json()).then(showResult);
    } else status.textContent=e.message;
    eventSource?.close();
  }
  if(e.type==='info' && /cancel/i.test(e.message)) status.textContent=e.message;
}

async function showResult(data){
  if(!data.output)return;
  outputText=data.output; output.textContent=data.output; result.classList.remove('hidden'); download.disabled=false;
  validation.className=data.validation?.ok?'ok':'err';
  validation.textContent=data.validation?.ok?'✓ Validation passed: page markers, Sanskrit source, order, unit count, and verse numbers were preserved.':'⚠ '+(data.validation?.errors||[]).join(' ');
  setProgress(data.completedPages,data.totalPages,data.currentPage);
  liveOutput.textContent=data.output;
  livePages.textContent=`${data.completedPages} / ${data.totalPages} pages compiled`;
  liveResult.classList.remove('hidden');
}

stopBtn.addEventListener('click',async()=>{
  if(!jobId)return;
  await fetch(`/api/jobs/${jobId}/cancel`,{method:'POST'}); stopBtn.disabled=true; status.textContent='Stopping…';
});

clearLogs.addEventListener('click',()=>logs.textContent='');
download.addEventListener('click',()=>{
  const blob=new Blob([outputText],{type:'text/plain;charset=utf-8'}); const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=(parsed?.filename||'translated.txt').replace(/\.txt$/i,'')+'_translated.txt'; a.click(); URL.revokeObjectURL(a.href);
});
