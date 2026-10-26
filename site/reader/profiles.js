import {retainMoreFocus} from './people-reading.js?v=2509883ee0e90517';
import {citationHeading} from './inline-reading.js?v=2509883ee0e90517';
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

// An entry snapshot belongs to its exact arrangement. A split is migrated once,
// rather than expanding neighbouring stages again on every refresh.
export function biographyRevision(bio) {
  const signature=bio.stages.map(s=>s.id).join('|')+';'+bio.nodes.map(n=>n.id+':'+n.stage).join('|')+';'+bio.placements.map(p=>p.event+':'+(p.stage||'')).join('|');
  let hash=2166136261;
  for(const c of signature)hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
  return hash.toString(16).padStart(8,'0');
}
export function biographyContext(bio,saved) {
  if(!bio||!saved)return saved;
  const revision=biographyRevision(bio);
  const group=stage=>bio.compat?.stage_groups?.['revision-'+(saved.lifeRevision||'unversioned')+'-'+stage]||bio.compat?.stage_groups?.[stage]||[stage];
  const ids=id=>{
    if(id?.startsWith('life-linked-')){
      const nodes=bio.compat?.sources?.[id.slice(12)]?.nodes;
      if(nodes)return nodes.map(n=>'life-linked-'+n);
    }
    const match=/^life-more-(.+?)(?:-(dated|other))?$/.exec(id||'');
    if(match)return group(match[1]).map(s=>'life-more-'+s);
    if(id?.startsWith('life-stage-'))return ['life-stage-'+group(id.slice(11))[0]];
    if(id?.startsWith('life-')&&bio.compat?.anchors?.[id.slice(5)])return ['life-'+bio.compat.anchors[id.slice(5)]];
    return [id];
  };
  const limits={};
  for(const [id,n] of Object.entries(saved.lifeLimits||{}))for(const next of ids(id))limits[next]=Math.max(limits[next]||0,n);
  return {...saved,lifeRevision:revision,anchor:ids(saved.anchor)[0],open:[...new Set((saved.open||[]).flatMap(ids))],lifeLimits:limits};
}

// Processing notes (why a year is absent) never reach the reader; real era
// names, ages and relative wording stay untouched.
const TIME_NOTE_SOURCE='原文未明示时间|原文叙在|原文纪年(?:语?见引[文句]|表达保留)|不换算公元年|不自行换算|未换算年份|未明示具体年|未明示年份|保留原纪年|保留相对纪年';
export function cleanTimeLabel(raw){
  let label=String(raw||'').trim()
    .replace(new RegExp(`（[^（）]*(?:${TIME_NOTE_SOURCE})[^（）]*）`,'g'),'')
    .replace(new RegExp(TIME_NOTE_SOURCE,'g'),'');
  return label.replace(/^[\s；;，,]+|[\s；;，,]+$/g,'').replace(/([；;，,])\s*[；;，,]+/g,'$1');
}

export function biographyTime(time,dateText){
  const label=cleanTimeLabel(time.label).split(/[；;]/).map(s=>s.trim()).filter(s=>s&&!['年代未详','年代不详','生平补叙'].includes(s)).join('；');
  if(!label)return Number.isInteger(time.year)?`${time.year} 年`:'';
  return dateText({...time,label});
}

export function biographyDate(node,events,dateText){
  const times=node.time_events.map(id=>events.get(id).time);
  if(times.length===1)return biographyTime(times[0],dateText);
  // A combined narrative must not inherit its first action's month or age.
  const years=[...new Set(times.filter(t=>Number.isInteger(t.year)).map(t=>t.year))].sort((a,b)=>a-b);
  const uncertain=[...new Set(times.filter(t=>!Number.isInteger(t.year)).map(t=>biographyTime(t,dateText)).filter(Boolean))];
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
  // Person-level references identify an entity; only displayed fields define
  // the basic-profile scope. All original references remain in the base groups.
  const fields=profile?.fields||[];
  for(const f of fields)add(f.evidence,{key:f.id,use:'identity',text:f.label+'：'+f.text,target:'profile'});
  for(const f of person.facts)if(!fields.some(x=>x.id===f.id))add(f.evidence,{key:f.id,use:'other',text:(f.label?f.label+'：':'')+f.text});
  for(const a of person.aliases||[])if(!person.facts.some(f=>f.text===a.text))add(a.evidence,{key:'alias-'+a.text,use:'other',text:'别称：'+a.text});
  for(const e of data.events){
    const participant=e.participants.find(p=>p.person===person.id);if(!participant)continue;
    // Prefer a role label only on its exact evidence. Other accounts explain
    // the event, not necessarily this person's part in it. One link per event.
    const purpose={key:'event-'+e.id,use:'life',event:e.id};
    add(participant.evidence,{...purpose,kind:'role',text:e.title+' · '+participant.role});
    for(const a of e.accounts)add(a.evidence,{...purpose,kind:'event',text:e.title});
  }
  for(const n of profile?.biography?.nodes||[])for(const s of n.sentences)add(s.evidence,{key:'node-'+n.id,use:'life',text:'用于生平：'+n.title,target:n.id});
  for(const r of groups.values())r.uses=[...new Set(r.purposes.map(p=>p.use))];
  for(const r of groups.values())if(!r.uses.length)r.uses=['other'];
  return [...groups.values()].sort((a,b)=>a.section.localeCompare(b.section,undefined,{numeric:true})||({original:0,pei:1,modern:2}[a.layer]-{original:0,pei:1,modern:2}[b.layer])||(a.source?.file||'').localeCompare(b.source?.file||'',undefined,{numeric:true})||(a.source?.index||0)-(b.source?.index||0)||(a.start||0)-(b.start||0));
}

export function renderBiography({bio,data,main,text,esc,dateText,url,sourceLabel,detailPath,saved,onChange,readingRow=null,renderQuote=r=>`<blockquote>${text(r.quote)}</blockquote>`}) {
  const events=new Map(data.events.map(e=>[e.id,e]));
  const selected=new Set(bio.nodes.flatMap(n=>n.sentences.flatMap(s=>s.events)));
  const eventLink=e=>`<a href="#/events/${esc(e.id)}">${text(e.title)}</a>`;
  const displayDate=t=>biographyTime(t,dateText);
  const row=e=>readingRow?readingRow(e,displayDate):`<article class="life-event ${displayDate(e.time)?'':'without-event-date'}" id="life-event-${esc(e.id)}" data-context tabindex="-1">${displayDate(e.time)?`<span>${text(displayDate(e.time))}</span>`:''}${eventLink(e)}</article>`;
  const nodes=stage=>bio.nodes.filter(n=>n.stage===stage).map(n=>{
    const ids=[...new Set(n.sentences.flatMap(s=>s.events))];
    const linked=new Set();
    const quotes=biographySources(n,data).map(r=>`<div class="life-source" id="life-source-${esc(n.id)}-${esc(r.ids[0])}" data-evidence-ids="${esc(JSON.stringify(r.ids))}"><p class="life-source-label">${citationHeading(r,{text,url,label:sourceLabel(r),linked})}</p>${renderQuote(r)}</div>`).join('');
    const links=ids.map(id=>`<p>${eventLink(events.get(id))}</p>`).join('');
    const related=ids.length>1?`<details class="life-document-events reading-more" id="life-events-${esc(n.id)}"><summary>${text('相关史事')}</summary>${links}</details>`:`<div class="life-document-events" id="life-events-${esc(n.id)}">${links}</div>`;
    const date=biographyDate(n,events,dateText);
    return `<article class="life-node" id="life-${esc(n.id)}" data-context tabindex="-1">${date?`<p class="event-date">${text(date)}</p>`:''}<h4>${text(n.title)}</h4><p class="life-narrative">${n.sentences.map(s=>text(s.text)).join('')}</p><details class="life-documents" id="life-linked-${esc(n.id)}"><summary>${text('文献记载')}</summary><div class="life-documents-body">${quotes}${related}<div class="reading-actions"><button type="button" class="close-records">${text('收起记载')}</button></div></div></details></article>`;
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
  const html=`<section class="person-biography" data-life-revision="${biographyRevision(bio)}"><div class="section-heading"><h2>${text('生平')}</h2></div><div class="biography-layout"><details class="life-navigation" id="life-navigation" open><summary><span>${text('生平阶段')}</span><span class="life-current"></span></summary><div class="life-stage-menu"><nav class="life-stages" aria-label="${text('生平阶段')}">${bio.stages.map(s=>`<a data-stage-target="life-stage-${esc(s.id)}" href="${detailPath}?at=stage-${esc(s.id)}">${text(s.title)}</a>`).join('')}</nav>${supplement?`<p class="supplement-jump"><a data-stage-target="life-supplement" href="${detailPath}?at=supplement">${text('生平补遗')}</a></p>`:''}</div></details><div class="life-chapters">${bio.stages.map(s=>`<section class="life-stage" id="life-stage-${esc(s.id)}" data-context tabindex="-1"><h3>${text(s.title)}</h3>${nodes(s.id)}${bucket(s.id,'更多记载')}</section>`).join('')}</div></div></section>${supplement?`<section class="person-supplement" id="life-supplement" data-context tabindex="-1" aria-labelledby="supplement-heading"><h2 id="supplement-heading">${text('生平补遗')}</h2>${supplement}</section>`:''}`;
  return {html,bind(){
    if(matchMedia('(max-width:760px)').matches)main.querySelector('.life-navigation').open=!!saved?.open?.includes('life-navigation');
    main.querySelectorAll('.close-records').forEach(button=>button.onclick=()=>{
      const details=button.closest('details');details.open=false;
      const summary=details.querySelector('summary');summary.focus({preventScroll:true});
      summary.scrollIntoView({block:'nearest'});onChange();
    });
    for(const b of buckets){
      const container=main.querySelector(`[data-life-list="${b.id}"]`);
      const targetIndex=b.items.findIndex(e=>'life-event-'+e.id===saved?.anchor);
      let limit=Math.max(20,Number(saved?.lifeLimits?.[b.id])||0,targetIndex>=0?Math.ceil((targetIndex+1)/20)*20:0);
      if(targetIndex>=0)container.closest('details').open=true;
      const more=()=>limit<b.items.length?`<button type="button" class="load-more" data-people-more>${text('加载更多')}</button>`:'';
      limit=Math.min(limit,b.items.length);container.dataset.limit=String(limit);
      container.innerHTML=b.items.slice(0,limit).map(row).join('')+more();
      const load=(automatic=false)=>{
        const button=container.querySelector(':scope>.load-more');if(!button)return 0;
        const y=window.scrollY,keepMoreFocus=automatic&&document.activeElement===button,old=limit;limit=Math.min(limit+20,b.items.length);button.remove();
        container.insertAdjacentHTML('beforeend',b.items.slice(old,limit).map(row).join('')+more());
        container.dataset.limit=String(limit);window.scrollTo(0,y);
        if(keepMoreFocus)retainMoreFocus(button,container,text);
        if(!automatic)container.querySelectorAll(':scope>article')[old]?.focus({preventScroll:true});onChange();bindMore();return limit-old;
      };
      const bindMore=()=>{const button=container.querySelector(':scope>.load-more');if(button){button.onclick=()=>load();button.peopleLoad=()=>load(true);}};
      bindMore();
    }
  }};
}
