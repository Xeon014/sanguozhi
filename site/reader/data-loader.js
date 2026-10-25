// Cache parsed resources by full versioned URL, including concurrent consumers.
export function createJSONLoader(base, version, transport=fetch) {
  const cache=new Map();
  return function load(path, options) {
    const address=new URL(path,base);
    if(version)address.searchParams.set('v',version);
    const key=address.href;
    if(options?.cache==='reload')cache.delete(key);
    if(!cache.has(key)){
      const pending=transport(key,options).then(r=>{
        if(!r.ok)throw Error(`读取失败（${r.status}）`);
        return r.json();
      }).catch(error=>{if(cache.get(key)===pending)cache.delete(key);throw error;});
      cache.set(key,pending);
    }
    return cache.get(key);
  };
}

const indexes=new WeakMap();
export function knowledgeIndex(data){
  const previous=indexes.get(data),stamp=[data.events?.length||0,data.persons?.length||0,data.evidence.length,data.runtimeRevision||0].join(':');
  if(previous?.stamp===stamp)return previous;
  const result={stamp,events:new Map((data.events||[]).map(e=>[e.id,e])),people:new Map((data.persons||[]).map(p=>[p.id,p])),evidence:new Map(data.evidence.map(r=>[r.id,r]))};
  indexes.set(data,result);return result;
}

export function attachRuntime(data, load) {
  const pending=new Map();
  data.loadEvent=id=>{
    if(!pending.has(id))pending.set(id,load('events/'+encodeURIComponent(id)+'.json').then(bundle=>{
      if(bundle.source_sha256!==data.source_sha256)throw Error('史事资料版本不一致');
      const event=bundle.events.find(e=>e.id===id),index=data.events.findIndex(e=>e.id===id);
      if(!event)throw Error('未找到此条记载');
      if(index>=0)data.events[index]=event;else data.events.push(event);
      const ids=new Set(data.evidence.map(r=>r.id));
      data.evidence.push(...bundle.evidence.filter(r=>!ids.has(r.id)));
      data.runtimeRevision=(data.runtimeRevision||0)+1;
      return event;
    }).catch(error=>{pending.delete(id);throw error;}));
    return pending.get(id);
  };
  data.loadPeople=()=>load('chooser.json');
  return data;
}
