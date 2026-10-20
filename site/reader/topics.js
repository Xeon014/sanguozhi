import {eventReadingSources, sourceLayerLabel, dateText} from './knowledge.js';

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

export function topicHome(topic, catalog, {esc, cv, collection}) {
  const text=s=>esc(cv(s)), refs=new Map(catalog.evidence.map(r=>[r.id,r]));
  return `<section class="topic-feature" aria-labelledby="topic-feature-title">
    <div class="topic-feature-heading"><p class="eyebrow">${text('诸篇合读')}</p>
    <h2 id="topic-feature-title">${text('赤壁')}</h2><p>${text(topic.subtitle)}</p>
    <a class="topic-enter" href="#/topics/${esc(topic.id)}">${text('合读赤壁')} <span aria-hidden="true">→</span></a></div>
    <div class="topic-preview">${topic.preview.map(p=>{
      const r=refs.get(p.ref), col=collection(r.section);
      return `<figure class="topic-preview-quote" data-book="${esc(col?.id||'')}"><figcaption>${text(r.section_title)}</figcaption>
      <blockquote><a href="#/topics/${esc(topic.id)}?step=battle&ref=${encodeURIComponent(r.id)}">${text(p.quote)}</a></blockquote></figure>`;
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
  const sourceText=(r,context=false)=>`<p class="topic-source-label">${text((context?r.section_title+' · ':'')+sourceLayerLabel(r))}</p><blockquote>${text(r.quote)}</blockquote>`;
  const disclosure=(id,title,body)=>`<details class="topic-disclosure" id="${esc(id)}"><summary>${text(title)}</summary>${body}
    <div class="reading-actions"><button type="button" class="topic-close">${text('收起并返回')} ↑</button></div></details>`;
  function card(entry,step) {
    const r=refs.get(entry.ref),event=events.get(entry.event),id=`topic-${step.id}-${r.id}`;
    const reading=eventReadingSources(catalog,{...event,accounts:[{evidence:[r.id]}],participants:[],place:null},sections);
    return `<article class="topic-record" id="${esc(id)}" tabindex="-1" data-context ${targetRef===r.id?'data-source-target':''}>
      ${sourceText(r)}
      ${reading.notes.length?disclosure(id+'-notes','相关注释',reading.notes.map(n=>sourceText(n,true)).join('')):''}
      ${disclosure(id+'-context','查看前后文',reading.context.map(n=>sourceText(n,true)).join(''))}
      <div class="topic-record-links"><a class="topic-out" href="${url(r.section,r.block)}">${text('阅读全文')} ↗</a>
      <a class="topic-out" href="#/events/${encodeURIComponent(event.id)}?ref=${encodeURIComponent(r.id)}">${text(event.title)} →</a></div>
      <p class="topic-date">${text('相关史事纪年：'+dateText(event.time))}</p>
    </article>`;
  }
  main.innerHTML=`<article class="topic-page" data-topic-mode="${mode}">
    <header class="topic-heading"><p class="crumb"><a href="#/">${text('首页')}</a> / ${text('诸篇合读')}</p>
    <p class="eyebrow">${text('赤壁')}</p><h1>${text(topic.title)}</h1><p>${text(topic.subtitle)}</p></header>
    <nav class="topic-steps" aria-label="${text('专题分节')}">${topic.steps.map((s,i)=>`<a href="#/topics/${esc(topic.id)}?step=${esc(s.id)}" ${s===targetStep?'aria-current="location"':''}><span aria-hidden="true">0${i+1}</span>${text(s.title)}</a>`).join('')}</nav>
    <div class="topic-controls"><div class="topic-mode" role="group" aria-label="${text('阅读布局')}"><button type="button" data-topic-view="all">${text('诸篇选读')}</button><button type="button" data-topic-view="compare">${text('两篇对读')}</button></div>
    <div class="topic-pair"><label>${text('第一篇')}<select id="topic-a">${chapterIds.map(id=>`<option value="${esc(id)}">${text(chapterName(id))}</option>`).join('')}</select></label>
    <label>${text('第二篇')}<select id="topic-b">${chapterIds.map(id=>`<option value="${esc(id)}">${text(chapterName(id))}</option>`).join('')}</select></label></div>
    <div class="topic-size"><button id="topic-smaller" aria-label="${text('减小字号')}">A−</button><button id="topic-larger" aria-label="${text('增大字号')}">A＋</button></div></div>
    ${topic.steps.map((s,i)=>`<section class="topic-step" id="topic-step-${esc(s.id)}" tabindex="-1" data-context ${!targetRef&&s===targetStep?'data-source-target':''}>
      <header class="topic-step-heading"><span class="topic-step-number" aria-hidden="true">0${i+1}</span><div><h2>${text(s.title)}</h2>
      ${s.intro.map(line=>`<p>${text(line.text)} <a class="topic-jump" data-topic-ref="topic-${esc(s.id)}-${esc(line.evidence[0])}" href="#/topics/${esc(topic.id)}?step=${esc(s.id)}&ref=${encodeURIComponent(line.evidence[0])}">${text('记载')} ↓</a></p>`).join('')}
      </div></header>
      <div class="topic-chapters">${chapterIds.map(cid=>`<section class="topic-chapter" data-chapter="${esc(cid)}" data-book="${esc(collection(cid)?.id||'')}"><h3>${text(chapterName(cid))}</h3>${s.entries.filter(e=>refs.get(e.ref).section===cid).map(e=>card(e,s)).join('')||`<p class="topic-empty">${text('本节请选读其他篇目。')}</p>`}</section>`).join('')}</div>
      <nav class="topic-people" aria-label="${text(s.title+'相关人物')}">${s.people.map(id=>`<a class="topic-out" href="#/people/${encodeURIComponent(id)}">${text(people.get(id).name)} →</a>`).join('')}<button class="topic-adjust" type="button">${text('调整对读篇目')} ↑</button></nav>
    </section>`).join('')}
    <nav class="topic-end"><a href="#/events">${text('继续浏览史事')} →</a><a href="#/contents">${text('全书目录')} →</a></nav></article>`;
  const page=main.querySelector('.topic-page'), selectA=main.querySelector('#topic-a'), selectB=main.querySelector('#topic-b');
  function update() {
    page.dataset.topicMode=mode;page.dataset.topicA=a;page.dataset.topicB=b;
    selectA.value=a;selectB.value=b;
    for(const o of selectA.options)o.disabled=o.value===b;
    for(const o of selectB.options)o.disabled=o.value===a;
    main.querySelector('.topic-pair').hidden=mode!=='compare';
    main.querySelectorAll('[data-topic-view]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.topicView===mode)));
    main.querySelectorAll('.topic-chapter').forEach(el=>{
      el.hidden=mode==='compare'?![a,b].includes(el.dataset.chapter):!el.querySelector('.topic-record');
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
  main.querySelectorAll('.topic-adjust').forEach(button=>button.onclick=()=>{
    mode='compare';update();selectA.scrollIntoView({block:'center'});selectA.focus({preventScroll:true});
  });
  update();
  return topic.title;
}
