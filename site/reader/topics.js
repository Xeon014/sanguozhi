import {eventSources, sourceLayerLabel, dateText} from './knowledge.js?v=fc84f6282a7a3932';
import {evidenceKey} from './profiles.js?v=fc84f6282a7a3932';
import {quoteText,readingProjection,passageHTML} from './event-reading.js?v=fc84f6282a7a3932';
import {citationHeading} from './inline-reading.js?v=fc84f6282a7a3932';

// Topic excerpts retain their existing context view; event pages use the new
// in-place paragraph projection. Do not couple these two reading interfaces.
export function topicReadingSources(catalog,event,sections) {
  const {direct,support}=eventSources(catalog,event);
  const extra=support.filter(r=>!direct.includes(r));
  const notes=extra.filter(r=>r.layer==='modern');
  const context=extra.filter(r=>r.layer!=='modern'&&direct.some(d=>d.section===r.section&&d.block===r.block));
  for(const r of direct){
    if(!['original','pei'].includes(r.layer))continue;
    const section=sections[r.section],block=section?.blocks.find(b=>b.id===r.block);
    if(!block)continue;
    if([...block.text].slice(r.start,r.end).join('')!==r.quote)throw Error('引文与当前文本不一致，暂不可查看前后文');
    const blocks=r.layer==='original'?section.blocks.filter(b=>b.kind==='original'):[block],at=blocks.indexOf(block);
    for(const b of blocks.slice(Math.max(0,at-1),at+2)){
      const item={...r,id:'context-'+b.id,ids:['context-'+b.id],block:b.id,source:b.source,
        start:0,end:[...b.text].length,quote:b.text,claims:[],attribution:r.attribution};
      if(!context.some(c=>evidenceKey(c)===evidenceKey(item)))context.push(item);
    }
  }
  return {notes,context};
}

export function topicReadingState(chapterIds, saved, targetChapter) {
  const prior=saved?.topic||{};
  let mode=prior.mode==='compare'?'compare':'all';
  const a=chapterIds.includes(prior.a)?prior.a:chapterIds[0];
  const b=chapterIds.includes(prior.b)&&prior.b!==a?prior.b:chapterIds.find(id=>id!==a);
  // An explicit new citation reveals its chapter. History restoration instead
  // preserves the reader's subsequent choices, even on a citation URL.
  if(targetChapter&&(!saved||saved.y===undefined)&&![a,b].includes(targetChapter))mode='all';
  return {mode,a,b};
}

export function topicDirectory(presentation, {esc, cv}) {
  const text=s=>esc(cv(s)),refs=new Map(presentation.preview_sources.map(r=>[r.id,r]));
  return `<section class="topic-directory"><header><p class="eyebrow">${text('诸篇合读')}</p><h1>${text('专题研究')}</h1>
    <p>${text('围绕一件史事，合读不同篇目的记载。')}</p></header><div class="topic-directory-list">
    ${presentation.topics.map(topic=>{
      const sources=[...new Map(topic.preview.map(p=>{const r=refs.get(p.ref);return [r.section,r.section_title];})).values()];
      return `<article class="topic-directory-card"><h2><a href="#/topics/${esc(topic.id)}">${text(topic.title)}</a></h2><p>${text(topic.subtitle)}</p>
      <ul class="topic-directory-sources" aria-label="${text('选读篇目')}">${sources.map(s=>`<li>${text(s)}</li>`).join('')}</ul></article>`;
    }).join('')}</div></section>`;
}

export function renderTopic(topic, catalog, {main, qs, esc, cv, url, collection, sections, saved, onChange}) {
  const text=s=>esc(cv(s)), refs=new Map(catalog.evidence.map(r=>[r.id,r]));
  const events=new Map(catalog.events.map(e=>[e.id,e])), people=new Map(catalog.persons.map(p=>[p.id,p]));
  const chapterIds=[...new Set(topic.steps.flatMap(s=>s.entries.map(e=>refs.get(e.ref).section)))].sort();
  const chapterName=id=>refs.get(topic.steps.flatMap(s=>s.entries).find(e=>refs.get(e.ref).section===id).ref).section_title;
  const targetStep=topic.steps.find(s=>s.entries.some(e=>e.ref===qs.get('ref')))||topic.steps.find(s=>s.id===qs.get('step'));
  const targetRef=targetStep?.entries.find(e=>e.ref===qs.get('ref'))?.ref;
  let {mode,a,b}=topicReadingState(chapterIds,saved,refs.get(targetRef)?.section);
  const sourceText=(r,context=false,link=false)=>`<p class="topic-source-label">${link?citationHeading(r,{text,url,label:sourceLayerLabel(r),ariaLabel:'阅读全文：'+r.section_title+' · '+sourceLayerLabel(r)}):text((context?r.section_title+' · ':'')+sourceLayerLabel(r))}</p><blockquote>${text(quoteText(r,sections))}</blockquote>`;
  const disclosure=(id,title,body)=>`<details class="topic-disclosure" id="${esc(id)}"><summary>${text(title)}</summary>${body}
    <div class="reading-actions"><button type="button" class="topic-close">${text('收起并返回')}</button></div></details>`;
  function card(entry,step) {
    const r=refs.get(entry.ref),event=events.get(entry.event),id=`topic-${step.id}-${r.id}`;
    const reading=topicReadingSources(catalog,{...event,accounts:[{evidence:[r.id]}],participants:[],place:null},sections);
    const passage=readingProjection([{...r,claims:[]}],[],sections).passages[0];
    const context=reading.context.filter(n=>n.start===0&&n.end===[...sections[n.section].blocks.find(b=>b.id===n.block).text].length||!reading.context.some(other=>other!==n&&other.block===n.block&&other.section===n.section&&other.layer===n.layer&&other.attribution===n.attribution&&other.start===0&&other.end===[...sections[n.section].blocks.find(b=>b.id===n.block).text].length));
    context.sort((x,y)=>sections[x.section].blocks.findIndex(b=>b.id===x.block)-sections[y.section].blocks.findIndex(b=>b.id===y.block));
    const contextBody=context.map(n=>n.section===r.section&&n.block===r.block&&n.layer===r.layer&&n.attribution===r.attribution
      ?`<p class="topic-source-label">${citationHeading(r,{text,url,label:r.section_title+' · '+sourceLayerLabel(r)})}</p><blockquote>${passageHTML(passage,text)}</blockquote>`:sourceText(n,true)).join('');
    return `<article class="topic-record" id="${esc(id)}" data-topic-evidence="${esc(r.id)}" tabindex="-1" data-context ${targetRef===r.id?'data-source-target':''}>
      <div class="topic-passage"><div class="topic-excerpt">${sourceText(r,false,true)}</div>
      ${context.some(n=>n.block!==r.block||n.quote!==r.quote)?disclosure(id+'-context','查看前后文',contextBody):''}</div>
      ${reading.notes.length?disclosure(id+'-notes','相关注释',reading.notes.map(n=>sourceText(n,true)).join('')):''}
      ${dateText(event.time)?`<p class="topic-date">${text('相关史事纪年：'+dateText(event.time))}</p>`:''}
    </article>`;
  }
  main.innerHTML=`<article class="topic-page" data-topic-mode="${mode}">
    <header class="topic-heading"><p class="crumb"><a href="#/topics">${text('专题研究')}</a> / ${text('诸篇合读')}</p>
    <p class="eyebrow">${text('赤壁')}</p><h1>${text(topic.title)}</h1><p>${text(topic.subtitle)}</p></header>
    <nav class="topic-steps" aria-label="${text('专题分节')}">${topic.steps.map((s,i)=>`<a href="#/topics/${esc(topic.id)}?step=${esc(s.id)}" ${s===targetStep?'aria-current="location"':''}><span aria-hidden="true">0${i+1}</span>${text(s.title)}</a>`).join('')}</nav>
    <div class="topic-controls"><div class="topic-mode" role="group" aria-label="${text('阅读布局')}"><button type="button" data-topic-view="all">${text('诸篇选读')}</button><button type="button" data-topic-view="compare">${text('两篇对读')}</button></div>
    <div class="topic-pair"><label>${text('第一篇')}<select id="topic-a">${chapterIds.map(id=>`<option value="${esc(id)}">${text(chapterName(id))}</option>`).join('')}</select></label>
    <label>${text('第二篇')}<select id="topic-b">${chapterIds.map(id=>`<option value="${esc(id)}">${text(chapterName(id))}</option>`).join('')}</select></label></div>
    <div class="topic-size"><button id="topic-smaller" aria-label="${text('减小字号')}">A−</button><button id="topic-larger" aria-label="${text('增大字号')}">A＋</button></div></div>
    ${topic.steps.map((s,i)=>`<section class="topic-step" id="topic-step-${esc(s.id)}" tabindex="-1" data-context ${!targetRef&&s===targetStep?'data-source-target':''}>
      <header class="topic-step-heading"><span class="topic-step-number" aria-hidden="true">0${i+1}</span><div><h2>${text(s.title)}</h2>
      ${s.intro.map(line=>`<p>${text(line.text)} <a class="topic-jump" data-topic-ref="topic-${esc(s.id)}-${esc(line.evidence[0])}" href="#/topics/${esc(topic.id)}?step=${esc(s.id)}&ref=${encodeURIComponent(line.evidence[0])}">${text('记载')}</a></p>`).join('')}
      </div></header>
      <div class="topic-chapters">${chapterIds.map(cid=>`<section class="topic-chapter" data-chapter="${esc(cid)}" data-book="${esc(collection(cid)?.id||'')}"><h3>${text(chapterName(cid))}</h3>${s.entries.filter(e=>refs.get(e.ref).section===cid).map(e=>card(e,s)).join('')||`<p class="topic-empty">${text('本节未选录《'+chapterName(cid)+'》。')}</p>`}</section>`).join('')}</div>
      <details class="topic-local-pair" id="topic-pair-${esc(s.id)}"><summary>${text('调整对读篇目')}</summary><div class="topic-pair">${['a','b'].map((slot,i)=>`<label>${text(i===0?'第一篇':'第二篇')}<select data-local-pair="${slot}" aria-label="${text(s.title+' · '+(i===0?'第一篇':'第二篇'))}">${chapterIds.map(cid=>{const included=s.entries.some(e=>refs.get(e.ref).section===cid);return `<option value="${esc(cid)}" data-included="${included}">${text(chapterName(cid)+(included?'':'（本节未选录）'))}</option>`;}).join('')}</select></label>`).join('')}</div></details>
      ${s.people.length?`<section class="topic-people" id="topic-people-${esc(s.id)}"><h3>${text('相关人物')}</h3><div>${s.people.map(id=>`<a class="topic-out" href="#/people/${encodeURIComponent(id)}">${text(people.get(id).name)}</a>`).join('')}</div></section>`:''}
      <section class="topic-events"><h3>${text('相关史事')}</h3><div>${[...new Set(s.entries.map(e=>e.event))].map(id=>`<a class="topic-out topic-event-link" href="#/events/${encodeURIComponent(id)}">${text(events.get(id).title)}</a>`).join('')}</div></section>
    </section>`).join('')}
    <nav class="topic-end"><a href="#/topics">${text('返回专题研究')}</a></nav></article>`;
  const page=main.querySelector('.topic-page'), selectA=main.querySelector('#topic-a'), selectB=main.querySelector('#topic-b');
  function update() {
    page.dataset.topicMode=mode;page.dataset.topicA=a;page.dataset.topicB=b;
    selectA.value=a;selectB.value=b;
    for(const o of selectA.options)o.disabled=o.value===b;
    for(const o of selectB.options)o.disabled=o.value===a;
    main.querySelector('.topic-pair').hidden=mode!=='compare';
    main.querySelectorAll('.topic-local-pair').forEach(el=>{
      el.hidden=mode!=='compare';
      for(const select of el.querySelectorAll('select')){
        const slot=select.dataset.localPair;select.value=slot==='a'?a:b;
        for(const option of select.options)option.disabled=option.value===(slot==='a'?b:a)||option.dataset.included!=='true';
      }
    });
    main.querySelectorAll('[data-topic-view]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.topicView===mode)));
    main.querySelectorAll('.topic-chapter').forEach(el=>{
      el.hidden=mode==='compare'?![a,b].includes(el.dataset.chapter):!el.querySelector('.topic-record');
      el.classList.toggle('topic-chapter-empty',!el.querySelector('.topic-record'));
      el.style.order=mode==='compare'?(el.dataset.chapter===a?'0':'1'):'';
    });
    onChange();
  }
  main.querySelectorAll('[data-topic-view]').forEach(el=>el.onclick=()=>{mode=el.dataset.topicView;update();});
  selectA.onchange=()=>{a=selectA.value;update();};selectB.onchange=()=>{b=selectB.value;update();};
  main.querySelectorAll('.topic-close').forEach(button=>button.onclick=()=>{
    const details=button.closest('details');details.open=false;
    const summary=details.querySelector('summary');summary.scrollIntoView({block:'nearest'});summary.focus({preventScroll:true});onChange();
  });
  main.querySelectorAll('[data-local-pair]').forEach(select=>select.onchange=()=>{
    const top=select.getBoundingClientRect().top;
    if(select.dataset.localPair==='a')a=select.value;else b=select.value;
    update();window.scrollBy(0,select.getBoundingClientRect().top-top);select.focus({preventScroll:true});onChange();
  });
  update();
  return topic.title;
}
