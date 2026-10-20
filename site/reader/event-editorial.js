// Editorial metadata is optional: absence is never a "detail" classification.
export function matchesEditorial(event, editorial, qs) {
  const record=editorial?.records[event.id];
  return ['category','importance','kind'].every(key=>{
    const value=qs.get(key);if(!value)return true;
    if(!record)return false;
    return key==='category'?record.categories.includes(value):
      record[key==='kind'?'record_kind':key]===value;
  });
}

export function canonicalEditorial(qs, editorial) {
  const result=new URLSearchParams();
  if(!editorial)return result;
  if(qs.get('view')==='highlights')result.set('view','highlights');
  const group=editorial.groups.find(g=>g.id===qs.get('group'));
  if(result.has('view')&&group){result.set('group',group.id);return result;}
  for(const [key,field] of [['category','categories'],['importance','importance'],['kind','record_kind']]){
    if(result.has('view')&&key!=='category')continue;
    if(Object.hasOwn(editorial.taxonomy[field],qs.get(key)))result.set(key,qs.get(key));
  }
  return result;
}

export function overviewItems(events, editorial, matches=()=>true, groupId='') {
  if(!editorial)return [];
  const byId=new Map(events.map(e=>[e.id,e])),result=[];
  const members=new Set();
  for(const group of editorial.groups){
    // Membership and rating have already been reviewed, not inferred from text.
    group.members.forEach(id=>members.add(id));
    if(group.importance!=='major'||(groupId&&groupId!==group.id))continue;
    const selected=group.members.map(id=>byId.get(id)).filter(e=>
      e&&editorial.records[e.id]?.record_kind==='event'&&matches(e));
    if(selected.length)result.push({type:'group',id:group.id,group,events:selected,anchor:byId.get(group.anchor)});
  }
  if(!groupId)for(const event of events){
    const metadata=editorial.records[event.id];
    if(metadata?.record_kind==='event'&&metadata.importance==='major'&&!members.has(event.id)&&matches(event))
      result.push({type:'event',id:event.id,event,anchor:event});
  }
  return result;
}

export function groupDateText(events) {
  const years=[...new Set(events.filter(e=>Number.isInteger(e.time.year)).map(e=>e.time.year))].sort((a,b)=>a-b);
  const parts=years.map(y=>`${y} 年`);
  if(events.some(e=>e.time.precision==='relative'))parts.push('另有相对时间记载');
  if(events.some(e=>e.time.precision==='undated'))parts.push('另有年代未详记载');
  return '记载纪年：'+(parts.join(' · ')||'年代未详');
}

export function editorialStats(events, editorial) {
  const levels={major:0,significant:0,detail:0};
  let eventCount=0,commentaryCount=0,unreviewed=0;
  for(const event of events){
    const r=editorial?.records[event.id];
    if(!r){unreviewed++;continue;}
    if(r.record_kind==='commentary'){commentaryCount++;continue;}
    eventCount++;levels[r.importance]++;
  }
  return {eventCount,commentaryCount,unreviewed,levels,overview:overviewItems(events,editorial).length};
}
