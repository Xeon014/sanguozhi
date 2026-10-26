// Count reviewed participant relationships, never mentions, quotations or accounts.
export function directoryEventCounts(data) {
  if(data.directory_counts)return new Map(Object.entries(data.directory_counts));
  const related=new Map();
  for(const event of data.events)for(const {person} of event.participants){
    if(!related.has(person))related.set(person,new Set());
    related.get(person).add(event.id);
  }
  return new Map([...related].map(([person,events])=>[person,events.size]));
}

export function directoryPeople(data, visible, profiles, qs, normalize=s=>String(s).toLowerCase(), featuredPeople=[]) {
  if(!Array.isArray(featuredPeople)||!featuredPeople.length||new Set(featuredPeople).size!==featuredPeople.length)throw Error('人物精选配置无效');
  const byId=new Map(data.persons.map(p=>[p.id,p]));
  const listed=visible===null?data.persons:[...visible.map(entry=>byId.get(entry.id)),...featuredPeople.filter(id=>!visible.some(p=>p.id===id)).map(id=>byId.get(id))];
  if(listed.some(p=>!p)||new Set(listed.map(p=>p.id)).size!==listed.length)throw Error('人物展示名单无效');
  const counts=directoryEventCounts(data),order=new Map(listed.map((p,i)=>[p.id,i]));
  const original=(a,b)=>order.get(a.id)-order.get(b.id);
  const byEvents=(a,b)=>(counts.get(b.id)||0)-(counts.get(a.id)||0)||original(a,b);
  // People with a reviewed biography lead the default order; both groups then
  // follow reviewed participant counts, never mentions or quotations.
  const bySelection=(a,b)=>Number(!!profiles[b.id]?.biography)-Number(!!profiles[a.id]?.biography)||byEvents(a,b);
  const selected=featuredPeople.map(id=>byId.get(id));
  if(selected.some(p=>!p))throw Error('人物精选名单无效');
  // Selection precedes search and display sorting, so a query cannot nominate a person.
  const needle=normalize((qs.get('q')||'').trim());
  const matches=selected.filter(p=>[p.name,
    ...p.facts.filter(f=>f.label==='字').map(f=>f.text),
    ...(profiles[p.id]?.fields||[]).filter(f=>f.key==='courtesy').map(f=>f.text),
    ...(p.aliases||[]).map(a=>a.text)].some(value=>normalize(value).includes(needle)));
  if(qs.get('sort')==='name'){
    const collator=new Intl.Collator('zh-Hans-CN-u-co-pinyin');
    return matches.sort((a,b)=>collator.compare(normalize(a.name),normalize(b.name))||original(a,b));
  }
  return matches.sort(bySelection);
}
