// Presentation choices refer to existing facts; they never become a second event store.
export const evidenceKey=e=>JSON.stringify([e.source_sha256,e.section,e.block,e.layer,e.attribution||'',e.start,e.end,e.quote]);

// A node displays only its explicit citations, in sentence order. Retain every
// reference ID when identical source ranges share one visual quotation.
export function biographySources(node,data) {
  const refs=new Map(data.evidence.map(e=>[e.id,e])),groups=new Map();
  for(const id of new Set(node.sentences.flatMap(s=>s.evidence))){
    const e=refs.get(id),key=evidenceKey(e);
    if(!groups.has(key))groups.set(key,{...e,ids:[]});
    groups.get(key).ids.push(id);
  }
  return [...groups.values()];
}

// Legacy source scopes keep the complete original citation set after a node splits.
export function biographyScope(bio,id) {
  const node=bio?.nodes.find(n=>n.id===id);
  if(node)return {id,title:node.title,target:id,evidence:[...new Set(node.sentences.flatMap(s=>s.evidence))]};
  const legacy=bio?.compat?.sources?.[id];
  return legacy?{id,title:legacy.title,target:legacy.nodes[0],evidence:legacy.evidence}:null;
}
export const scopeIncludes=(scope,record)=>record.ids.some(id=>scope.evidence.includes(id));
export function biographyAnchor(bio,at) {
  const target=bio?.compat?.anchors?.[at]||at;
  return target==='profile'||(target==='supplement'&&bio?.placements.some(p=>p.stage===null))||bio?.nodes.some(n=>n.id===target)||bio?.stages.some(s=>'stage-'+s.id===target)?target:null;
}

export function biographyContext(bio,saved) {
  if(!bio||!saved)return saved;
  const ids=id=>{
    if(id?.startsWith('life-linked-')){
      const nodes=bio.compat?.sources?.[id.slice(12)]?.nodes;
      if(nodes)return nodes.map(n=>'life-linked-'+n);
    }
    const match=/^life-more-(.+)-(dated|other)$/.exec(id||'');
    if(match)return (bio.compat?.stage_groups?.[match[1]]||[match[1]]).map(s=>'life-more-'+s);
    if(id?.startsWith('life-')&&bio.compat?.anchors?.[id.slice(5)])return ['life-'+bio.compat.anchors[id.slice(5)]];
    return [id];
  };
  const limits={};
  for(const [id,n] of Object.entries(saved.lifeLimits||{}))for(const next of ids(id))limits[next]=Math.max(limits[next]||0,n);
  return {...saved,anchor:ids(saved.anchor)[0],open:[...new Set((saved.open||[]).flatMap(ids))],lifeLimits:limits};
}

export function biographyDate(node,events,dateText){
  const times=node.time_events.map(id=>events.get(id).time);
  if(times.length===1)return dateText(times[0]);
  // A combined narrative must not inherit its first action's month or age.
  const years=[...new Set(times.filter(t=>Number.isInteger(t.year)).map(t=>t.year))].sort((a,b)=>a-b);
  const uncertain=[...new Set(times.filter(t=>!Number.isInteger(t.year)).map(dateText))];
  return [...(years.length?[years.join('、')+' 年']:[]),...uncertain].join('；');
}

export function personSources(data,person,profile,base) {
  const refs=new Map(data.evidence.map(e=>[e.id,e])),groups=new Map();
  for(const r of base)groups.set(evidenceKey(r),{...r,ids:[...r.ids],purposes:[]});
  function add(ids,purpose) {
    for(const id of ids||[]){
      const e=refs.get(id);if(!e)continue;
      const key=evidenceKey(e);
      if(!groups.has(key))groups.set(key,{...e,ids:[],claims:[],events:[],purposes:[]});
      const r=groups.get(key);if(!r.ids.includes(id))r.ids.push(id);
      if(purpose&&!r.purposes.some(x=>x.key===purpose.key))r.purposes.push(purpose);
    }
  }
  add(person.evidence,{key:'name',use:'identity',text:'姓名：'+person.name,target:'profile'});
  const fields=profile?.fields||[];
  for(const f of fields)add(f.evidence,{key:f.id,use:'identity',text:f.label+'：'+f.text,target:'profile'});
  for(const f of person.facts)if(!fields.some(x=>x.id===f.id))add(f.evidence,{key:f.id,use:'other',text:f.label+'：'+f.text});
  for(const a of person.aliases||[])if(!person.facts.some(f=>f.text===a.text))add(a.evidence,{key:'alias-'+a.text,use:'other',text:'别称：'+a.text});
  for(const e of data.events){
    const participant=e.participants.find(p=>p.person===person.id);if(!participant)continue;
    // Only references explicitly used by this event; no paragraph-neighbour joins.
    const purpose={key:'event-'+e.id,use:'life',text:e.title+' · '+participant.role,event:e.id};
    for(const a of e.accounts)add(a.evidence,purpose);
    add(participant.evidence,purpose);
  }
  for(const n of profile?.biography?.nodes||[])for(const s of n.sentences)add(s.evidence,{key:'node-'+n.id,use:'life',text:'用于生平：'+n.title,target:n.id});
  for(const r of groups.values())r.uses=[...new Set(r.purposes.map(p=>p.use))];
  for(const r of groups.values())if(!r.uses.length)r.uses=['other'];
  return [...groups.values()].sort((a,b)=>a.section.localeCompare(b.section,undefined,{numeric:true})||({original:0,pei:1,modern:2}[a.layer]-{original:0,pei:1,modern:2}[b.layer])||(a.source?.file||'').localeCompare(b.source?.file||'',undefined,{numeric:true})||(a.source?.index||0)-(b.source?.index||0)||(a.start||0)-(b.start||0));
}

export function renderBiography({bio,data,main,text,esc,dateText,url,sourceLabel,detailPath,saved,onChange}) {
  const events=new Map(data.events.map(e=>[e.id,e]));
  const selected=new Set(bio.nodes.flatMap(n=>n.sentences.flatMap(s=>s.events)));
  const eventLink=e=>`<a href="#/events/${esc(e.id)}">${text(e.title)}</a>`;
  const row=e=>`<article class="life-event" id="life-event-${esc(e.id)}" data-context tabindex="-1"><span>${text(dateText(e.time))}</span>${eventLink(e)}</article>`;
  const nodes=stage=>bio.nodes.filter(n=>n.stage===stage).map(n=>{
    const ids=[...new Set(n.sentences.flatMap(s=>s.events))];
    const quotes=biographySources(n,data).map(r=>`<div class="life-source" id="life-source-${esc(n.id)}-${esc(r.ids[0])}" data-evidence-ids="${esc(JSON.stringify(r.ids))}"><p class="life-source-label">${text(sourceLabel(r))}</p><blockquote>${text(r.quote)}</blockquote><a class="evidence-link" href="${url(r.section,r.block)}">${text('原文与译注')} <span aria-hidden="true">↗</span></a></div>`).join('');
    return `<article class="life-node" id="life-${esc(n.id)}" data-context tabindex="-1"><p class="event-date">${text(biographyDate(n,events,dateText))}</p><h4>${text(n.title)}</h4><p class="life-narrative">${n.sentences.map(s=>text(s.text)).join('')}</p><details class="life-documents" id="life-linked-${esc(n.id)}"><summary>${text('文献记载')}</summary><div class="life-documents-body">${quotes}<div class="life-document-events" role="group" aria-label="${text('所含史事')}">${ids.map(id=>row(events.get(id))).join('')}</div><div class="reading-actions"><button type="button" class="close-records">${text('收起记载')}</button></div></div></details></article>`;
  }).join('');
  const buckets=[];
  function bucket(stage,title){
    // Preserve source narrative order without inventing dates for undated actions.
    const items=bio.placements.filter(p=>p.stage===stage&&!selected.has(p.event)).map(p=>events.get(p.event)).sort((a,b)=>a.order-b.order);
    if(!items.length)return '';
    const id='life-more-'+(stage||'supplement');buckets.push({id,items});
    return `<details class="life-more" id="${id}"><summary>${text(title)}</summary><div data-life-list="${id}" data-limit="0"></div></details>`;
  }
  const supplement=bucket(null,'展开记载');
  const html=`<section class="person-biography"><div class="section-heading"><h2>${text('生平')}</h2><a href="#/events?person=${esc(detailPath.split('/').pop())}">${text('全部相关史事')}</a></div><nav class="life-stages" aria-label="${text('生平阶段')}">${bio.stages.map(s=>`<a href="${detailPath}?at=stage-${esc(s.id)}">${text(s.title)}</a>`).join('')}</nav>${supplement?`<p class="supplement-jump"><a href="${detailPath}?at=supplement">${text('生平补遗')}</a></p>`:''}${bio.stages.map(s=>`<section class="life-stage" id="life-stage-${esc(s.id)}" data-context tabindex="-1"><h3>${text(s.title)}</h3>${nodes(s.id)}${bucket(s.id,'更多事迹')}</section>`).join('')}</section>${supplement?`<section class="person-supplement" id="life-supplement" data-context tabindex="-1" aria-labelledby="supplement-heading"><h2 id="supplement-heading">${text('生平补遗')}</h2>${supplement}</section>`:''}`;
  return {html,bind(){
    main.querySelectorAll('.close-records').forEach(button=>button.onclick=()=>{
      const details=button.closest('details');details.open=false;
      details.querySelector('summary').focus({preventScroll:true});
      details.closest('.life-node').scrollIntoView({block:'start'});onChange();
    });
    for(const b of buckets){
      const container=main.querySelector(`[data-life-list="${b.id}"]`);
      const targetIndex=b.items.findIndex(e=>'life-event-'+e.id===saved?.anchor);
      let limit=Math.max(20,Number(saved?.lifeLimits?.[b.id])||0,targetIndex>=0?Math.ceil((targetIndex+1)/20)*20:0);
      if(targetIndex>=0)container.closest('details').open=true;
      const paint=()=>{container.dataset.limit=String(limit);container.innerHTML=b.items.slice(0,limit).map(row).join('')+(limit<b.items.length?`<button type="button" class="load-more">${text('加载更多')}</button>`:'');
        const button=container.querySelector('button');if(button)button.onclick=()=>{const y=window.scrollY,old=limit;limit+=20;paint();window.scrollTo(0,y);(container.querySelector('button')||container.querySelectorAll('article')[old])?.focus({preventScroll:true});onChange();};};paint();
    }
  }};
}
