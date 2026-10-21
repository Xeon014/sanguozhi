import {personSources, renderBiography, evidenceKey, biographyScope, scopeIncludes, biographyAnchor} from './profiles.js';
import {matchesEditorial, canonicalEditorial, overviewItems, groupDateText, yearbookItems} from './event-editorial.js';
import {eventPeople, mountPersonFilter} from './person-filter.js';
import {readingProjection,quoteText,passageHTML} from './event-reading.js';
import {directoryPeople} from './people-directory.js';
import {inlineEventRow,mountInlineReading,citationText,mountCitationText} from './inline-reading.js';
// People and events share evidence; chronology is a view of events, never a second fact set.
const BATCH = 40, SOURCE_BATCH = 20;
const LAYERS = {original:'正文', pei:'裴注', modern:'现代注释'};
export const sourceLayerLabel = e => {
  const raw=e.attribution||'';
  const attribution=e.layer==='pei'?raw.replace(/^裴注\s*[·・：:]\s*/, ''):raw;
  return LAYERS[e.layer]+(attribution&&attribution!==LAYERS[e.layer]?' · '+attribution:'');
};
const yearOf = e => Number.isInteger(e.time.year) ? String(e.time.year) : e.time.precision === 'relative' ? 'relative' : 'undated';
export const dateText = time => Number.isInteger(time.year) ? `${time.year} 年 · ${time.label}` : (!time.label||time.label==='原文未明示时间'?'年代未详':time.label);
export function chronological(events) {
  const byId=new Map(events.map(e=>[e.id,e])),children=new Map(),attached=new Set();
  for(const e of events) {
    if(e.time.precision!=='relative'||!byId.has(e.time.after))continue;
    // Only explicit reviewed links can move a record. Never derive a year or
    // attach it to a neighbouring passage. Reject cyclic chains defensively.
    const seen=new Set([e.id]);let p=byId.get(e.time.after),cycle=false;
    while(p){if(seen.has(p.id)){cycle=true;break;}seen.add(p.id);p=byId.get(p.time.after);}
    if(cycle)continue;
    if(!children.has(e.time.after))children.set(e.time.after,[]);
    children.get(e.time.after).push(e);attached.add(e.id);
  }
  const roots=events.map((e,i)=>({e,i})).filter(x=>!attached.has(x.e.id)).sort((a,b)=>{
    const rank=e=>Number.isInteger(e.time.year)?0:e.time.precision==='relative'?1:2;
    return rank(a.e)-rank(b.e) || (a.e.time.year||0)-(b.e.time.year||0) || a.i-b.i;
  }).map(x=>x.e);
  const ordered=[];
  function append(e){ordered.push(e);for(const child of children.get(e.id)||[])append(child);}
  roots.forEach(append);return ordered;
}
function ownedRefs(entity, page) {
  return page==='people'
    ? [...(entity.evidence||[]),...(entity.facts||[]).flatMap(x=>x.evidence),...(entity.aliases||[]).flatMap(x=>x.evidence),...(entity.mentions||[]).flatMap(x=>x.evidence)]
    : [...entity.time.evidence,...entity.accounts.flatMap(x=>x.evidence),...entity.participants.flatMap(x=>x.evidence),...(entity.place?.evidence||[])];
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
export function canonicalKnowledgeHash(parts, qs, data, profiles={}, editorial=null) {
  const page=parts[0]==='timeline'&&parts.length===1?'events':parts[0],path='#/'+[page,...parts.slice(1)].map(encodeURIComponent).join('/'),out=new URLSearchParams();
  const validYear=(value,events)=>['relative','undated'].includes(value)||events.some(e=>yearOf(e)===value);
  if(parts.length===2&&['people','events'].includes(page)) {
    const entity=(page==='people'?data.persons:data.events).find(e=>e.id===parts[1]);
    if(!entity)return path;
    if(page==='events'||qs.get('view')==='sources') {
      if(page==='people')out.set('view','sources');
      const records=page==='people'?personSources(data,entity,profiles[entity.id],sourceRecords(data,page,entity)):null;
      const refs=new Set(records?records.flatMap(r=>r.ids):ownedRefs(entity,page)),evidence=data.evidence.filter(e=>refs.has(e.id));
      const target=evidence.find(e=>e.id===qs.get('ref')),section=qs.get('section');
      const use=qs.get('use');
      if(records&&['identity','life','other'].includes(use)&&(!target||records.find(r=>r.ids.includes(target.id)).uses.includes(use)))out.set('use',use);
      const node=biographyScope(profiles[entity.id]?.biography,qs.get('node'));
      if(records&&node&&(!out.has('use')||out.get('use')==='life')&&(!target||scopeIncludes(node,records.find(r=>r.ids.includes(target.id)))))out.set('node',node.id);
      const scoped=records?records.filter(r=>(!out.has('use')||r.uses.includes(out.get('use')))&&(!out.has('node')||scopeIncludes(node,r))):evidence;
      if(scoped.some(e=>e.section===section)&&(!target||target.section===section))out.set('section',section);
      if(target)out.set('ref',target.id);
      if(page==='events'&&!target&&(qs.get('basis')==='1'||qs.get('view')==='sources'))out.set('basis','1');
    } else if(page==='people'){
      const bio=profiles[entity.id]?.biography,at=biographyAnchor(bio,qs.get('at'));
      if(at)out.set('at',at);
      else if(validYear(qs.get('year'),data.events.filter(e=>e.participants.some(p=>p.person===entity.id))))out.set('year',qs.get('year'));
    }
  } else if(parts.length===1) {
    if(page==='events'){
      const additions=canonicalEditorial(qs,editorial);
      for(const [k,v] of additions)out.set(k,v);
      if(out.has('group')&&!qs.has('node'))return path+'?'+out;
    }
    if(['people','events','timeline'].includes(page)&&qs.get('q')?.trim())out.set('q',qs.get('q').trim());
    if(page==='people'&&Object.values(profiles).some(p=>p.directory?.faction===qs.get('faction')))out.set('faction',qs.get('faction'));
    if(['events','timeline'].includes(page)) {
      if(data.persons.some(p=>p.id===qs.get('person')))out.set('person',qs.get('person'));
      if(out.get('view')!=='highlights'&&validYear(qs.get('year'),data.events))out.set('year',qs.get('year'));
    }
  }
  return path+(out.size?'?'+out:'');
}
// Exact source ranges are deduplicated only within the same version and attribution.
export function sourceRecords(data, page, entity) {
  const evidence=new Map(data.evidence.map(e=>[e.id,e])),groups=new Map();
  function add(refs, claim=null) {
    for(const id of refs||[]) {
      const e=evidence.get(id);if(!e)continue;
      const key=JSON.stringify([e.source_sha256,e.section,e.block,e.layer,e.attribution||'',e.start,e.end,e.quote]);
      if(!groups.has(key))groups.set(key,{...e,ids:[],claims:[],events:[]});
      const r=groups.get(key);if(!r.ids.includes(id))r.ids.push(id);
      if(claim&&!r.claims.some(c=>c.key===claim.key))r.claims.push(claim);
    }
  }
  if(page==='people') {
    // Entity identification is not a claim about the person's name or profile.
    add(entity.evidence);
    for(const f of entity.facts)add(f.evidence,{key:f.id,label:f.label,text:f.text});
    for(const a of entity.aliases||[]) {
      // An alias already represented by an attribute needs no second identical claim.
      if(!entity.facts.some(f=>f.text===a.text))add(a.evidence,{key:'alias-'+a.text,label:'别称',text:a.text});
      else add(a.evidence);
    }
    for(const m of entity.mentions||[])add(m.evidence);
    const relevant=data.events.filter(e=>e.participants.some(p=>p.person===entity.id));
    const byQuote=new Map();
    for(const r of groups.values()) {
      byQuote.set(evidenceKey(r),r);
    }
    for(const event of relevant)for(const id of [...event.accounts.flatMap(a=>a.evidence),...event.participants.filter(p=>p.person===entity.id).flatMap(p=>p.evidence)]) {
      const e=evidence.get(id);if(!e)continue;
      const r=byQuote.get(evidenceKey(e));if(r&&!r.events.some(x=>x.id===event.id))r.events.push({id:event.id,title:event.title});
    }
  } else {
    add(entity.time.evidence,{key:entity.id+'-time',label:'时间',text:dateText(entity.time)});
    for(const a of entity.accounts)add(a.evidence,{key:a.id,label:'记载',text:a.text});
    for(const p of entity.participants)add(p.evidence,{key:entity.id+'-'+p.person,label:data.persons.find(x=>x.id===p.person).name,text:p.role});
    if(entity.place)add(entity.place.evidence,{key:entity.id+'-place',label:'地点',text:entity.place.text});
  }
  const layerOrder={original:0,pei:1,modern:2};
  return [...groups.values()].sort((a,b)=>a.section.localeCompare(b.section,undefined,{numeric:true})||layerOrder[a.layer]-layerOrder[b.layer]||
    (a.source?.file||'').localeCompare(b.source?.file||'',undefined,{numeric:true})||(a.source?.index||0)-(b.source?.index||0)||(a.start||0)-(b.start||0));
}

// Preserve exact evidence identity while placing account citations in narrative order.
export function eventSources(data, event) {
  const records=sourceRecords(data,'events',event),byRef=new Map();
  for(const r of records)for(const id of r.ids)byRef.set(id,r);
  const direct=[];
  for(const account of event.accounts)for(const id of account.evidence){
    const r=byRef.get(id);if(!direct.includes(r))direct.push(r);
  }
  const support=records.filter(r=>r.claims.some(c=>c.label!=='记载'));
  return {direct,support};
}

// Source paragraphs are an optional in-place reading view, not extra evidence.
export function eventReadingSources(data,event,sections={}) {
  const {direct,support}=eventSources(data,event);
  return readingProjection(direct,support,sections);
}

export function renderKnowledge(data, {main, parts, qs, esc, cv, normalize, url, navigate, loadSection, saved=null, visiblePeople=null, profiles={}, directoryFactions={}, personListHash='#/people', eventHasContext=false, editorial=null, atlasEnabled=false, atlas=null, sections:sourceSections={}, legacySources=false, onChange=()=>{}}) {
  const people=new Map(data.persons.map(p=>[p.id,p])),sources=new Map(data.evidence.map(e=>[e.id,e]));
  const page=parts[0],id=parts[1],text=s=>esc(cv(s)),personURL=id=>'#/people/'+encodeURIComponent(id),eventURL=id=>'#/events/'+encodeURIComponent(id);
  const personLink=id=>`<a class="person-link" href="${personURL(id)}">${text(people.get(id).name)}</a>`;
  const factLabel=label=>label==='本文称谓'?'称谓':label.replace(/记载/g,'');
  const sourceLabel=e=>`${e.section_title} · ${sourceLayerLabel(e)}`;
  const linkQuery=(path,values)=>{const q=new URLSearchParams();for(const [k,v] of Object.entries(values))if(v)q.set(k,v);return path+(q.size?'?'+q:'');};
  const detailPath='#/'+page+'/'+encodeURIComponent(id);
  const sourceURL=ref=>linkQuery(detailPath,page==='events'?{ref,...(!ref?{basis:'1'}:{})}:{view:'sources',ref});
  const tabs=items=>`<nav class="knowledge-tabs" aria-label="${text('内容视图')}">${items.map(([title,href,current])=>`<a href="${esc(href)}" ${current?'aria-current="page"':''}>${text(title)}</a>`).join('')}</nav>`;
  const head=(title,back='',meta='')=>`<header class="knowledge-heading">${back?`<p class="crumb"><a href="${esc(back)}">${text(page==='people'?'风云人物':'大事年表')}</a></p>`:''}<h1>${text(title)}</h1>${meta}</header>`;
  const empty=`<p class="query-empty" role="status">${text(page==='events'&&!id?'没有符合条件的记录，可尝试其他用词，或放宽人物、年份与类别等筛选条件。':'没有符合条件的记录。')}</p>`;
  const years=events=>[...new Set(events.filter(e=>Number.isInteger(e.time.year)).map(e=>e.time.year))].sort((a,b)=>a-b);
  const yearSelect=(events,value)=>`<label class="filter-field"><span>${text('年份')}</span><select name="year" id="year-filter"><option value="">${text('全部时间')}</option>${years(events).map(y=>`<option value="${y}" ${String(y)===value?'selected':''}>${y}${text('年')}</option>`).join('')}<option value="relative" ${value==='relative'?'selected':''}>${text('相对时间')}</option><option value="undated" ${value==='undated'?'selected':''}>${text('年代未详')}</option></select></label>`;
  const eventRow=(e,mode,person)=>`<article class="${person?'person-event':mode==='timeline'?'timeline-entry':'event-card'}" id="event-card-${esc(e.id)}" data-context tabindex="-1">
    <p class="event-date">${text(dateText(e.time))}</p><div><h3><a href="${eventURL(e.id)}">${text(e.title)}</a></h3>${person?`<p class="event-role">${text(e.participants.find(p=>p.person===person).role)}</p>`:`<p class="event-summary">${text(e.accounts[0].text)}</p>`}${e.time.precision==='relative'&&e.time.after?`<p class="relative-context">${text('晚于')} <a href="${eventURL(e.time.after)}">${text(data.events.find(p=>p.id===e.time.after).title)}</a>${text('；具体年份及与其他史事的先后未详。')}</p>`:''}</div></article>`;
  const readingRow=(e,person='',id='event-card-'+e.id,className='person-event')=>inlineEventRow(e,{text,esc,dateText,person,id,className});
  const grouped=(events,person)=>{
    let previous=null;return events.map(e=>{
      const key=yearOf(e),heading=key!==previous?`${previous===null?'':'</section>'}<section class="chronology-group ${key==='relative'?'relative-events':key==='undated'?'undated-events':'timeline-year'}"><h2>${text(key==='relative'?'相对时间 · 年份未详':key==='undated'?'年代未详':key+' 年')}</h2>`:'';
      previous=key;return heading+(person?readingRow(e,person):eventRow(e,'timeline',person));
    }).join('')+(events.length?'</section>':'');
  };
  // Keep disclosure state and focus while extending a list in the current history entry.
  function batch(items,size,render,targetIndex=-1) {
    const container=main.querySelector('[data-batch]');
    let limit=Math.max(size,Number(saved?.knowledgeLimit)||0,targetIndex>=0?Math.ceil((targetIndex+1)/size)*size:0);
    const paint=()=>{
      const open=[...container.querySelectorAll('details[open]')].map(e=>e.id);
      const active=document.activeElement,keepFocus=active?.id;
      container.innerHTML=(items.length?render(items.slice(0,limit)):empty)+(items.length>limit?`<button class="load-more" id="knowledge-more">${text('加载更多')}</button>`:'');
      main.querySelector('.knowledge-page').dataset.limit=String(Math.min(limit,items.length));
      for(const id of open){const node=container.querySelector('#'+CSS.escape(id));if(node)node.open=true;}
      const button=container.querySelector('.load-more');
      if(button)button.onclick=()=>{const y=window.scrollY,previous=limit;limit+=size;paint();window.scrollTo(0,y);
        const focus=container.querySelector('#knowledge-more')||container.querySelectorAll('[data-context]')[previous];focus?.focus({preventScroll:true});onChange();};
      if(keepFocus)container.querySelector('#'+CSS.escape(keepFocus))?.focus({preventScroll:true});
    };paint();
  }
  function formSubmit(path,extras={},instant=false) {
    const form=main.querySelector('form');if(!form)return;
    const apply=focus=>{const values={...extras};for(const [key,value] of new FormData(form))values[key]=value.trim();navigate(linkQuery(path,values),focus);};
    form.onsubmit=e=>{e.preventDefault();apply(document.activeElement?.id);};
    form.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.isComposing)e.preventDefault();});
    if(instant)form.querySelectorAll('select').forEach(select=>{select.onchange=()=>apply(select.id);});
    return apply;
  }
  function sourceCard(r,compact=false) {
    const long=r.quote.length>180;
    return `<article class="source-record" id="source-${esc(r.ids[0])}" data-context tabindex="-1" ${r.ids.includes(qs.get('ref'))?'data-source-target':''}>
      <${compact?'h3':'h2'}>${text(sourceLabel(r))}</${compact?'h3':'h2'}>${!compact&&r.claims.length?`<dl class="source-claims">${r.claims.map(c=>`<div data-claim="${esc(c.key)}"><dt>${text(factLabel(c.label))}</dt><dd>${text(c.text)}</dd></div>`).join('')}</dl>`:''}
      ${long?`<details class="source-quote" id="quote-${esc(r.ids[0])}"><summary>${citationText(r,text,'span','quote-preview')}<span class="quote-action"><span class="when-closed">${text('展开全文')}</span><span class="when-open">${text('收起')}</span></span></summary>${citationText(r,text)}</details>`:citationText(r,text)}
      ${!compact&&r.events.length?`<div class="source-events">${r.events.map(e=>`<a href="${eventURL(e.id)}">${text(e.title)}</a>`).join('')}</div>`:''}
      <a class="evidence-link" href="${url(r.section,r.block)}">${text('阅读全文')} <span aria-hidden="true">↗</span></a></article>`;
  }
  function renderSources(entity,heading) {
    const records=personSources(data,entity,profiles[entity.id],sourceRecords(data,page,entity));
    const selected=qs.get('section')||'',use=qs.get('use')||'';
    const node=biographyScope(profiles[entity.id]?.biography,qs.get('node'));
    const scoped=records.filter(r=>(!use||r.uses.includes(use))&&(!node||scopeIncludes(node,r)));
    const sections=[...new Map(scoped.map(r=>[r.section,r.section_title]))];
    const filtered=scoped.filter(r=>!selected||r.section===selected);
    const scopeTitle=node?node.title+'的史料':({identity:'基本资料的史料',life:'生平事迹的史料',other:'其他记载的史料'}[use]||entity.name+'的全部史料');
    const purpose=p=>p.target?`<a href="${detailPath}?at=${esc(p.target)}">${text(p.text)}</a>`:p.event?`<a href="${eventURL(p.event)}">${text(p.text)}</a>`:`<span>${text(p.text)}</span>`;
    function card(r){
      const long=r.quote.length>180;
      const purposes=use?r.purposes.filter(p=>p.use===use):r.purposes;
      return `<article class="source-record person-source" id="source-${esc(r.ids[0])}" data-evidence-ids="${esc(JSON.stringify(r.ids))}" data-context tabindex="-1" ${r.ids.includes(qs.get('ref'))?'data-source-target':''}>
      <h4>${text(sourceLayerLabel(r))}</h4>
      ${long?`<details class="source-quote event-quote" id="quote-${esc(r.ids[0])}"><summary>${citationText(r,text,'span','quote-preview')}<span class="quote-action"><span class="when-closed">${text('展开全文')}</span><span class="when-open">${text('收起')}</span></span></summary>${citationText(r,text)}</details>`:citationText(r,text)}
      <a class="evidence-link" href="${url(r.section,r.block)}">${text('阅读全文')} <span aria-hidden="true">↗</span></a>
      ${purposes.length?`<details class="source-associations" id="associations-${esc(r.ids[0])}"><summary>${text('关联内容')}</summary><div class="source-purpose">${purposes.map(p=>`<div data-purpose="${esc(p.key)}">${purpose(p)}</div>`).join('')}</div></details>`:''}</article>`;
    }
    const group=items=>{
      let previous=null;return items.map(r=>{
        const header=r.section!==previous?`${previous===null?'':'</section>'}<section class="person-source-section"><h3>${text(r.section_title)}</h3>`:'';
        previous=r.section;return header+card(r);
      }).join('')+(items.length?'</section>':'');
    };
    const scopeValues={view:'sources',use,node:node?.id};
    main.innerHTML=`<article class="knowledge-page person-detail sources-view">${heading}${tabs([['概览',detailPath,false],['史料',linkQuery(detailPath,{...scopeValues,section:selected,ref:qs.get('ref')}),true]])}<header class="source-scope"><h2>${text(scopeTitle)}</h2>${node||use?`<nav class="source-scope-actions" aria-label="${text('史料范围')}">${node?`<a href="${detailPath}?at=${esc(node.target)}">${text('返回这段生平')}</a>`:use==='identity'?`<a href="${detailPath}?at=profile">${text('返回基本资料')}</a>`:''}<a href="${sourceURL()}">${text('查看'+entity.name+'全部史料')}</a></nav>`:''}</header>${sections.length>1?`<form class="source-filter" role="search"><label class="filter-field"><span>${text('篇目')}</span><select name="section" id="source-section"><option value="">${text('全部篇目')}</option>${sections.map(([id,title])=>`<option value="${esc(id)}" ${id===selected?'selected':''}>${text(title)}</option>`).join('')}</select></label></form>`:''}<div data-batch></div></article>`;
    batch(filtered,SOURCE_BATCH,group,filtered.findIndex(r=>r.ids.includes(qs.get('ref'))));
    const target=main.querySelector('[data-source-target]');if(target&&!saved){const quote=target.querySelector('.source-quote');if(quote)quote.open=true;}
    const form=main.querySelector('.source-filter');
    if(form){
      const filter=()=>navigate(linkQuery(detailPath,{...scopeValues,section:form.elements.section.value}));
      form.onsubmit=e=>{e.preventDefault();filter();};form.elements.section.onchange=filter;
    }
    mountCitationText(main.querySelector('.person-detail'),{data,text,loadSection,onChange});
  }
  if(parts.length>2||(page==='timeline'&&id))throw Error('未找到此页面');
  if(page==='people'&&id) {
    const p=people.get(id);if(!p)throw Error('未找到此人物');
    const profile=profiles[id],fields=profile?.fields||[];
    const heading=fields.length?head(p.name,eventHasContext?'':personListHash):head(p.name,eventHasContext?'':personListHash).replace('<header','<header id="life-profile" data-context tabindex="-1"');
    if(qs.get('view')==='sources'){renderSources(p,heading);return p.name+' · 史料';}
    const related=data.events.filter(e=>e.participants.some(x=>x.person===p.id));
    const year=qs.get('year')||'',filtered=chronological(related.filter(e=>!year||yearOf(e)===year));
    const biography=profile?.biography&&!year?renderBiography({bio:profile.biography,data,main,text,esc,dateText,url,sourceLabel,detailPath,saved,onChange,renderQuote:r=>citationText(r,text),readingRow:e=>readingRow(e,p.id,'life-event-'+e.id,'life-event inline-life-event')}):null;
    main.innerHTML=`<article class="knowledge-page person-detail">${heading}<p class="person-source-link"><a href="${sourceURL()}">${text('全部史料')} →</a></p>
      ${fields.length?`<section class="person-facts" id="life-profile" data-context tabindex="-1"><div class="section-heading"><h2>${text('基本资料')}</h2></div><dl class="profile-facts">${fields.map(f=>`<div class="${f.text.length>16?'fact-wide':''}"><dt>${text(f.label)}</dt><dd>${text(f.text)}</dd></div>`).join('')}</dl><details class="inline-identity" id="person-identity-evidence" data-inline-identity><summary>${text('文献依据')}</summary><div class="inline-evidence-body" data-inline-content></div><div class="reading-actions"><button type="button" class="close-inline">${text('收起记载')}</button></div></details></section>`:''}
      ${biography?biography.html:related.length?`<section class="person-history"><div class="section-heading"><h2>${text('经历')}</h2><form class="experience-filter" role="search">${yearSelect(related,year)}<button>${text('筛选')}</button></form></div>${profile?.biography?`<p><a href="${detailPath}">${text('生平概览')}</a></p>`:''}<div data-batch></div></section>`:`<section class="person-excerpts"><h2>${text('原文摘录')}</h2>${sourceRecords(data,page,p).slice(0,2).map(r=>sourceCard(r,true)).join('')}</section>`}</article>`;
    if(biography)biography.bind();
    else if(related.length){batch(filtered,BATCH,items=>grouped(items,p.id));formSubmit(detailPath);}
    mountInlineReading(main.querySelector('.person-detail'),{data,text,url,sourceLabel,fields,loadSection,onChange});
    const at=qs.get('at');if(at){const target=main.querySelector('#'+CSS.escape('life-'+at));if(target)target.setAttribute('data-source-target','');}
    return p.name;
  }
  if(page==='events'&&id) {
    const e=data.events.find(e=>e.id===id);if(!e)throw Error('未找到此条记载');
    const {direct,dating,notes,other,passages}=eventReadingSources(data,e,sourceSections);
    const all=[...new Set([...direct,...dating,...notes,...other])],selected=qs.get('section')||'';
    const sections=[...new Map(all.map(r=>[r.section,r.section_title]))];
    const visible=passages.filter(p=>!selected||p.records[0].section===selected);
    const scoped=items=>items.filter(r=>!selected||r.section===selected);
    const target=all.find(r=>r.ids.includes(qs.get('ref')));
    const quote=r=>{
      const value=quoteText(r,sourceSections);
      return value.length>180
        ? `<details class="source-quote event-quote" id="quote-${esc(r.ids[0])}"><summary><span class="quote-preview">${text(value)}</span><span class="quote-action"><span class="when-closed">${text('展开全文')}</span><span class="when-open">${text('收起')}</span></span></summary><blockquote>${text(value)}</blockquote><div class="reading-actions"><button type="button" class="close-reading">${text('收起并返回')}</button></div></details>`
        : `<blockquote>${text(value)}</blockquote>`;
    };
    const uses=r=>[...new Set(r.claims.filter(c=>c.label!=='记载').map(c=>c.label==='时间'?'纪年':c.label+'：'+c.text))];
    const card=(r,grouped=false,withUses=false)=>`<article class="source-record event-source" data-evidence-ids="${esc(JSON.stringify(r.ids))}" id="source-${esc(r.ids[0])}" data-context tabindex="-1" ${r===target&&!grouped?'data-source-target':''}>
      <h2>${text(sourceLabel(r))}</h2>
      ${withUses?`<p class="source-uses">${uses(r).map(text).join(' · ')}</p>`:''}${quote(r)}
      <a class="evidence-link" href="${url(r.section,r.block)}">${text('阅读全文')} <span aria-hidden="true">↗</span></a></article>`;
    const disclosure=(items,id,title)=>scoped(items).length?`<details class="event-reading" id="${id}"><summary>${text(title)}</summary><div>${scoped(items).map(r=>direct.includes(r)
      ?`<p class="evidence-pointer"><a href="${esc(sourceURL(r.ids[0]))}">${text(sourceLabel(r)+' · 查看本文引句')}</a><small>${uses(r).map(text).join(' · ')}</small></p>`:card(r,false,true)).join('')}<div class="reading-actions"><button type="button" class="close-reading">${text('收起并返回')}</button></div></div></details>`:'';
    const passage=p=>`<section class="event-passage" id="passage-${esc(p.records[0].ids[0])}" data-context tabindex="-1" ${p.records.includes(target)?'data-source-target':''}>
      <div class="passage-excerpts">${p.records.map(r=>card(r,true)).join('')}</div>
      ${p.canExpand?`<details class="event-paragraph" id="paragraph-${esc(p.records[0].ids[0])}"><summary><span class="when-closed">${text('展开所在段落')}</span><span class="when-open">${text('收起所在段落')}</span></summary>
      <div class="source-record"><h2>${text(sourceLabel(p.records[0]))}</h2><blockquote>${passageHTML(p,text)}</blockquote><a class="evidence-link" href="${url(p.records[0].section,p.records[0].block)}">${text('阅读全文')} ↗</a><div class="reading-actions"><button type="button" class="close-reading">${text('收起并返回')}</button></div></div></details>`:''}</section>`;
    const heading=head(e.title,eventHasContext?'':'#/events?view=highlights',`<p class="event-meta">${text(dateText(e.time))}${e.place?`<span> · ${text(e.place.text)}</span>`:''}</p>${disclosure(dating,'event-dating','纪年依据')}`);
    const group=editorial?.groups.find(g=>g.id===editorial.records[e.id]?.primary_group);
    const contextCount=e.participants.length+(e.related_events?.length||0)+(e.time.after?1:0)+(group?1:0);
    const contextTag=contextCount>1?'details':'section';
    main.innerHTML=`<article class="knowledge-page event-detail unified-event">${heading}
      ${sections.length>1?`<form class="source-filter" role="search"><label class="filter-field"><span>${text('篇目')}</span><select name="section" id="source-section"><option value="">${text('全部篇目')}</option>${sections.map(([id,title])=>`<option value="${esc(id)}" ${id===selected?'selected':''}>${text(title)}</option>`).join('')}</select></label><button>${text('筛选')}</button></form>`:''}
      <section class="event-accounts" aria-label="${text('文献记载')}" data-batch></section>
      <div id="event-basis">${disclosure(other,'event-other','其他依据')}${disclosure(notes,'event-notes','相关注释')}</div>
      ${contextCount?`<${contextTag} class="event-context ${contextCount>1?'reading-more':''}" id="event-further-reading">${contextCount>1?`<summary>${text('相关人物与史事')}</summary>`:''}
      ${e.participants.length?`<section class="event-participants"><h2>${text('人物')}</h2><dl class="participant-list">${e.participants.map(p=>`<div class="participant"><dt>${personLink(p.person)}</dt><dd>${text(p.role)}</dd></div>`).join('')}</dl></section>`:''}
      ${e.related_events?.length?`<section class="related-events"><h2>${text('相关史事')}</h2>${e.related_events.map(r=>`<p><a href="${eventURL(r.event)}">${text(data.events.find(x=>x.id===r.event).title)}</a></p>`).join('')}</section>`:''}
      ${e.time.after?`<p class="preceding-event"><a href="${eventURL(e.time.after)}">${text('前接')}：${text(data.events.find(x=>x.id===e.time.after).title)}</a></p>`:''}
      ${group?`<p><a href="#/events?view=highlights&group=${encodeURIComponent(group.id)}">${text('所属大事：'+group.title)} →</a></p>`:''}</${contextTag}>`:''}</article>`;
    batch(visible,SOURCE_BATCH,items=>items.map(passage).join(''),visible.findIndex(p=>p.records.includes(target)));
    if(sections.length>1)formSubmit(detailPath);
    // Persist the default action synchronously, before an immediate refresh can
    // race the browser's asynchronously dispatched details toggle event.
    main.querySelector('.unified-event').addEventListener('click',event=>{
      const close=event.target.closest('.close-reading');
      if(close){const details=close.closest('details');details.open=false;const summary=details.querySelector('summary');summary.focus({preventScroll:true});summary.scrollIntoView({block:'nearest'});onChange();return;}
      const summary=event.target.closest('summary');
      if(!summary||event.button!==0)return;
      event.preventDefault();summary.parentElement.open=!summary.parentElement.open;onChange();
    });
    if(!saved||legacySources){
      if(qs.get('basis')==='1')main.querySelectorAll('.event-reading').forEach(d=>d.open=true);
      if(target){
        const node=main.querySelector('[data-source-target]');
        const exact=target&&document.getElementById('source-'+target.ids[0]);
        exact?.querySelector('.source-quote')?.setAttribute('open','');
        for(let parent=node?.parentElement;parent&&parent!==main;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
      }
    }
    return e.title;
  }
  const q=qs.get('q')||'',selected=qs.get('person')||'',year=qs.get('year')||'',needle=normalize(q);
  const highlights=page==='events'&&qs.get('view')==='highlights'&&editorial;
  const editorialSelect=(key,field,title,all)=>`<label class="filter-field"><span>${text(title)}</span><select id="${key}-filter" name="${key}" aria-label="${text(title)}"><option value="">${text(all)}</option>${Object.entries(editorial.taxonomy[field]).map(([id,name])=>`<option value="${id}" ${qs.get(key)===id?'selected':''}>${text(name)}</option>`).join('')}</select></label>`;
  const editorialFilters=page==='events'&&editorial&&!highlights?editorialSelect('category','categories','类别','全部类别')+
    (highlights?'':`<details class="filter-more" open><summary>${text('更多筛选')}</summary><div class="filter-more-body">${editorialSelect('importance','importance','层级','全部层级')}${editorialSelect('kind','record_kind','性质','全部性质')}</div></details>`):'';
  const switchView=view=>{const next=new URLSearchParams(qs);if(next.get('group')&&!next.has('node'))next.set('node','group:'+next.get('group'));next.delete('group');if(!view){next.delete('node');next.delete('period');}next.delete('importance');next.delete('kind');if(view==='highlights')for(const key of ['period','year','category'])next.delete(key);if(view)next.set('view',view);else next.delete('view');return '#/events'+(next.size?'?'+next:'');};
  const views=page==='events'&&editorial?`<nav class="knowledge-tabs" aria-label="${text('时代视图')}">${atlasEnabled?`<a href="${esc(switchView('atlas'))}">${text('时代星图')}</a>`:''}<a href="${esc(switchView('highlights'))}" ${highlights?'aria-current="page"':''}>${text('大事年表')}</a></nav>`:'';
  const faction=qs.get('faction')||'';
  const factionTabs=page==='people'?`<nav class="people-factions" aria-label="${text('人物阵营')}">${[['','全部'],...Object.entries(directoryFactions)].map(([key,label])=>{const next=new URLSearchParams();if(q)next.set('q',q);if(key)next.set('faction',key);return `<a id="people-faction-${key||'all'}" href="#/people${next.size?'?'+esc(next.toString()):''}" ${key===faction?'aria-current="page"':''}>${text(label)}</a>`;}).join('')}</nav>`:'';
  const input=`<label class="filter-field query-field"><span>${text('搜索')}</span><input id="knowledge-query" name="q" type="search" value="${esc(q)}" aria-label="${text(page==='people'?'人物搜索':'史事搜索')}"></label>`;
  const personFilter='<div class="filter-field person-combo"></div>';
  main.innerHTML=`<div class="knowledge-page query-view">${head(page==='people'?'风云人物':highlights?'大事年表':'史事')}${views}${factionTabs}<form class="knowledge-filter ${page==='people'?'people-filter':'history-filter'}" role="search">${input}${page==='people'?(faction?`<input type="hidden" name="faction" value="${esc(faction)}">`:''):personFilter+(highlights?'':yearSelect(data.events,year)+editorialFilters)}<button type="submit">${text('检索')}</button></form><p class="editorial-result meta" role="status"></p><div data-batch></div></div>`;
  main.querySelectorAll('.people-factions a').forEach(a=>{a.onclick=event=>{if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();navigate(a.getAttribute('href'),a.id);};});
  const filterMore=main.querySelector('.filter-more');
  if(filterMore&&matchMedia('(max-width:760px)').matches&&!qs.get('importance')&&!qs.get('kind'))filterMore.open=false;
  if(page==='people') {
    const matches=directoryPeople(data,visiblePeople,profiles,qs,normalize);
    batch(matches,BATCH,items=>`<div class="people-grid">${items.map(p=>`<article id="person-card-${esc(p.id)}" data-context tabindex="-1"><h2><a href="${personURL(p.id)}">${text(p.name)}</a></h2>${[...new Set(p.facts.filter(f=>f.label==='字').map(f=>f.text))].map(value=>`<p>${text('字')}${text(value)}</p>`).join('')}</article>`).join('')}</div>`);
  } else {
    const matches=e=>(!selected||e.participants.some(p=>p.person===selected))&&(!year||yearOf(e)===year)&&
      [e.title,e.place?.text||'',...e.accounts.map(a=>a.text)].some(value=>normalize(value).includes(needle))&&matchesEditorial(e,editorial,qs);
    if(highlights){
      const overview=yearbookItems(data.events,editorial,qs,normalize);
      const nodes=new Map((atlas?.nodes||[]).map(n=>[n.key,n]));
      const selectedKey=qs.get('node')||(qs.get('group')?'group:'+qs.get('group'):'');
      main.querySelector('.editorial-result').textContent=cv(overview.length?`精选大事 ${overview.length} 项`:'没有符合条件的大事，可调整关键词或人物。');
      const years=[...new Set(overview.map(i=>Number.isInteger(i.anchor.time.year)?String(i.anchor.time.year):'undated'))];
      main.querySelector('[data-batch]').innerHTML=years.map(year=>`<section class="yearbook-year"><h2>${text(year==='undated'?'相对时间与年代未详':year+' 年')}</h2><div>${overview.filter(i=>(Number.isInteger(i.anchor.time.year)?String(i.anchor.time.year):'undated')===year).map(item=>{
        const key=item.type+':'+item.id,node=nodes.get(key),g=item.group,chosen=selectedKey===key;
        const next=new URLSearchParams(qs);next.set('view','atlas');next.set('node',key);next.delete('group');
        const locate=node?`<p class="yearbook-actions"><a class="yearbook-locate" href="#/events?${esc(next.toString())}">${text('在时代星图中定位')} ↗</a></p>`:'';
        const title=node?.title||g?.title||item.event.title;
        return `<article class="yearbook-item ${g?'overview-group':''}" id="${g?'overview-'+esc(g.id):'yearbook-'+esc(item.id)}" data-context tabindex="-1" data-node="${esc(key)}" ${chosen?'data-source-target':''}>
          <h3>${g?text(title):`<a href="${eventURL(item.id)}">${text(title)}</a>`}</h3>
          ${g?`<p class="event-date">${text(groupDateText(item.events))}</p>`:`<p class="event-date">${text(Number.isInteger(item.event.time.year)?item.event.time.label:dateText(item.event.time))}</p>`}
          ${g?`<details id="group-${esc(g.id)}" ${chosen?'open':''}><summary>${text('相关记载')} · ${item.events.length}</summary>${chronological(item.events).map(e=>readingRow(e,'','event-card-'+e.id,'timeline-entry inline-timeline-entry')).join('')}<div class="reading-actions"><button type="button" class="close-overview">${text('收起并返回')} ↑</button></div></details>`:`<p>${text(item.event.accounts[0]?.text||'')}</p>`}
          ${locate}
          </article>`;
      }).join('')}</div></section>`).join('');
      mountInlineReading(main.querySelector('.knowledge-page'),{data,text,url,sourceLabel,loadSection,onChange});
      main.querySelector('[data-batch]').addEventListener('click',e=>{
        const button=e.target.closest('.close-overview');if(!button)return;
        const details=button.closest('details');details.open=false;const summary=details.querySelector('summary');
        summary.scrollIntoView({block:'nearest'});summary.focus({preventScroll:true});onChange();
      });
    }else{
      const filtered=data.events.filter(matches);
      main.querySelector('.editorial-result').textContent=cv(`符合条件的记载：${filtered.length} 条`);
      batch(chronological(filtered),BATCH,items=>grouped(items));
    }
  }
  const apply=formSubmit(page==='people'?'#/people':'#/events',highlights?{view:'highlights',...(qs.get('node')?{node:qs.get('node')}:{})}:{},true);
  if(page!=='people')mountPersonFilter(main.querySelector('.person-combo'),eventPeople(data,visiblePeople,normalize),
    {selected,esc,cv,normalize,restoreFocus:saved?.filterFocus==='person-filter',onSelect:()=>apply('person-filter')});
  return page==='people'?'风云人物':highlights?'大事年表':'史事';
}
