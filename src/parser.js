const PAGE_RE=/^---\s*Page\s+(\d+)\s*---\s*$/i;
const NUM_RE=/([०-९]+|\d+)\s*$/u;
const NUM_GLOBAL=/([०-९]+|\d+)(?=\s|$)/gu;
const devanagari='०१२३४५६७८९';
function numberValue(s){return Number(s.replace(/[०-९]/gu,d=>devanagari.indexOf(d)));}

export function extractVerseNumber(text){const m=text.trim().match(NUM_RE);return m?m[1]:null;}

export function splitNumberedUnits(line){
  const text=line.trim(); const matches=[...text.matchAll(NUM_GLOBAL)];
  const valid=matches.filter(m=>{const n=numberValue(m[1]);return Number.isInteger(n)&&n>=1&&n<=10000;});
  if(valid.length<=1)return [text];
  const chunks=[]; let start=0;
  for(const m of valid){const end=m.index+m[0].length; chunks.push(text.slice(start,end).trim()); start=end;}
  if(start<text.length) chunks.push(text.slice(start).trim());
  return chunks.filter(Boolean);
}

export function classifyTextUnit(text){
  const t=text.trim(); if(!t)return 'blank';
  if(NUM_RE.test(t))return 'verse';
  if(/^(?:अथ\s+)?(?:[^।॥!?]{1,100}(?:वर्णनम्|विधानम्|लक्षणम्|माहात्म्यवर्णनम्|विधिः|कर्म|पूजा|स्नानम्|आह्निकम्|नमः)\s*)$/u.test(t))return 'heading';
  return 'prose';
}

export function structureDocument(text){
  const lines=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n');
  const out=[]; let page=null, id=0;
  for(const raw of lines){
    const line=raw.trimEnd(); const pm=line.match(PAGE_RE);
    if(pm){page=Number(pm[1]); out.push({id:`p${page}`,type:'page',page,source:line});continue;}
    if(!line.trim()){out.push({id:`b${++id}`,type:'blank',page,source:''});continue;}
    for(const piece of splitNumberedUnits(line)){
      const type=classifyTextUnit(piece);
      out.push({id:`u${++id}`,type,page,source:piece,verseNumber:type==='verse'?extractVerseNumber(piece):null,translation:null,translatedSource:null});
    }
  }
  return out;
}
