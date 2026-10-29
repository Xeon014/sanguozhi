// Pure route-hash helpers shared by the entry module and the heavy views.
// Keeping them here lets reader.js canonicalize every address without
// loading the atlas or knowledge renderers.
export const PERIODS = [
  {id:'all',title:'全景',from:184,to:280},
  {id:'184-199',title:'184—199',from:184,to:199},
  {id:'200-219',title:'200—219',from:200,to:219},
  {id:'220-249',title:'220—249',from:220,to:249},
  {id:'250-280',title:'250—280',from:250,to:280}
];
// Full filters in legacy homepage links belong to the full atlas, not a hidden filter.
export function canonicalAtlasHomeHash(hash, mobile=false) {
  if(mobile)return hash;
  const [path,query='']=hash.split('?');
  if(!['','#','#/'].includes(path))return hash;
  const qs=new URLSearchParams(query);
  if(!['category','q','person','year'].some(key=>qs.get(key))&&qs.get('period')!=='undated')return hash;
  qs.set('view','atlas');return '#/events?'+qs;
}
export function atlasState(bundle, qs) {
  let period=PERIODS.find(p=>p.id===qs.get('period')) || PERIODS[0];
  const from=Number(qs.get('from')),to=Number(qs.get('to'));
  if(qs.has('from')&&qs.has('to')&&Number.isInteger(from)&&Number.isInteger(to)&&from>=184&&to<=280&&from<=to)
    period=PERIODS.find(p=>p.from===from&&p.to===to)||{id:'custom',from,to};
  const category=Object.hasOwn(bundle.categories,qs.get('category'))?qs.get('category'):'';
  const filters=Object.fromEntries(['q','person','year'].filter(k=>qs.get(k)).map(k=>[k,qs.get(k)]));
  const nodes=bundle.nodes.filter(n=>qs.get('period')!=='undated'&&n.year>=period.from&&n.year<=period.to&&(!category||n.categories.includes(category))&&(!bundle.allowedKeys||bundle.allowedKeys.includes(n.key)));
  // The detail tier is category-neutral, so filters and category views keep it hidden.
  const records=!category&&!Object.keys(filters).length&&qs.get('period')!=='undated'&&Array.isArray(bundle.records)
    ?bundle.records.filter(r=>r.year>=period.from&&r.year<=period.to):[];
  const key=nodes.find(n=>n.key===qs.get('node'))?.key ||
    nodes.find(n=>n.key===bundle.default)?.key || nodes[0]?.key || '';
  return {period:qs.get('period')==='undated'?'undated':period.id,range:[period.from,period.to],category,key,nodes,records,...(Object.keys(filters).length?{filters}:{})};
}
export function atlasHash(state, home=false) {
  const q=new URLSearchParams(home?{}:{view:'atlas'});
  q.set('period',state.period);
  if(state.period==='custom'){q.delete('period');q.set('from',state.range[0]);q.set('to',state.range[1]);}
  if(state.category)q.set('category',state.category);
  if(state.key)q.set('node',state.key);
  for(const [k,v] of Object.entries(state.filters||{}))q.set(k,v);
  return (home?'#/':'#/events')+'?'+q;
}
export function yearbookHash(state,layout='') {
  const q=new URLSearchParams({view:'highlights'});
  if(layout==='compact')q.set('layout','compact');
  if(state.key)q.set('node',state.key);
  for(const key of ['q','person'])if(state.filters?.[key])q.set(key,state.filters[key]);
  return '#/events?'+q;
}
export function legacyKnowledgeHash(hash) {
  const [path,query='']=hash.slice(1).split('?');
  let parts;try{parts=path.split('/').filter(Boolean).map(decodeURIComponent);}catch{return hash;}
  if(parts.length===1&&parts[0]==='timeline')return `#/events${query?'?'+query:''}`;
  if(parts[0]!=='topics'||parts[1]!=='chibi')return hash;
  if(parts.length===4&&['person','event'].includes(parts[2]))return `#/${parts[2]==='person'?'people':'events'}/${encodeURIComponent(parts[3])}${query?'?'+query:''}`;
  if(parts.length!==2)return hash;
  const qs=new URLSearchParams(query);
  if(!['view','q','person','year'].some(key=>qs.has(key)))return hash;
  const view=qs.get('view')==='people'?'people':'events';
  qs.delete('view');return `#/${view}${qs.size?'?'+qs:''}`;
}
