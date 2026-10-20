// Display-only projection. All offsets remain Unicode code-point offsets in the
// original text, including note markers; evidence text and IDs are never edited.
const tokenText=t=>t.type==='text'?t.text:(t.children||[]).map(tokenText).join('');
const masks=new WeakMap();
export function noteMask(block,section) {
  if(masks.has(block))return masks.get(block);
  const hidden=new Set(),notes=Object.values(section?.notes||{});
  let offset=0;
  function walk(tokens,suppressed=false) {
    for(const t of tokens||[]){
      const bodyMarker=t.type==='link'&&notes.some(n=>n.blocks.includes(block.id)&&
        JSON.stringify(t.target)===JSON.stringify(n.reference)&&tokenText(t)===n.label);
      const omit=suppressed||!!t.note_id||bodyMarker;
      if(t.type==='text'){
        for(const c of t.text){if(omit)hidden.add(offset);offset++;}
      }else walk(t.children,omit);
    }
  }
  walk(block.tokens);
  // Unknown token structure must not silently remove characters.
  const flattened=(block.tokens||[]).map(tokenText).join('');
  if(flattened!==block.text)hidden.clear();
  masks.set(block,hidden);return hidden;
}
export function quoteText(record,sections) {
  const section=sections[record.section],block=section?.blocks.find(b=>b.id===record.block);
  if(!block)return record.quote;
  const chars=[...block.text],hidden=noteMask(block,section);
  if(chars.slice(record.start,record.end).join('')!==record.quote)throw Error('引文与当前文本不一致');
  return chars.slice(record.start,record.end).filter((_,i)=>!hidden.has(record.start+i)).join('');
}
export const passageKey=r=>JSON.stringify([r.source_sha256,r.section,r.block,r.layer,r.attribution||'']);
export function readingProjection(direct,support,sections) {
  const isDate=r=>r.claims.some(c=>c.key.endsWith('-time')&&c.label==='时间');
  const dating=support.filter(isDate);
  const extra=support.filter(r=>!direct.includes(r)&&!dating.includes(r));
  const notes=extra.filter(r=>r.layer==='modern'),other=extra.filter(r=>r.layer!=='modern');
  const grouped=new Map();
  for(const r of direct){
    const key=passageKey(r);
    if(!grouped.has(key))grouped.set(key,{key,records:[],block:sections[r.section]?.blocks.find(b=>b.id===r.block)});
    grouped.get(key).records.push(r);
  }
  const passages=[...grouped.values()];
  for(const p of passages){
    p.canExpand=false;
    if(!p.block)continue;
    const chars=[...p.block.text],section=sections[p.records[0].section];
    p.hidden=noteMask(p.block,section);
    for(const r of p.records)quoteText(r,sections);
    // The union is only a display-coverage test, never a merge of evidence.
    p.canExpand=['original','pei'].includes(p.records[0].layer)&&chars.some((c,i)=>
      /\S/.test(c)&&!p.hidden.has(i)&&!p.records.some(r=>r.start<=i&&i<r.end));
  }
  return {direct,dating,notes,other,passages};
}
export function passageHTML(p,renderText) {
  const chars=[...p.block.text],parts=[];
  let buffer='',marked=null;
  const flush=()=>{if(buffer)parts.push(marked?`<mark>${renderText(buffer)}</mark>`:renderText(buffer));buffer='';};
  for(let i=0;i<chars.length;i++){
    if(p.hidden.has(i))continue;
    const next=p.records.some(r=>r.start<=i&&i<r.end);
    if(next!==marked){flush();marked=next;}
    buffer+=chars[i];
  }
  flush();return parts.join('');
}
