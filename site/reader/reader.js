// Heavy views load per route so first paint only needs the shell helpers;
// pure address canonicalizers stay in route-hash.js for every navigation.
import {atlasState, atlasHash, yearbookHash, canonicalAtlasHomeHash, legacyKnowledgeHash} from './route-hash.js?v=41167bc9ab1fa07b';
import {createJSONLoader,attachRuntime,presentPeople} from './data-loader.js?v=41167bc9ab1fa07b';
import {searchHash,canonicalSearchHash,searchPeople,highlightText} from './search.js?v=41167bc9ab1fa07b';
import {blockText} from './event-reading.js?v=41167bc9ab1fa07b';
const $ = (q, el = document) => el.querySelector(q);
const main = $('#main');
const mobileLayout=matchMedia('(max-width:760px)');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeRead = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const safeWrite = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let book, site, zhDisplay, root, prefs, storageKey, section, blockMap, groupForBlock, routeVersion = 0, currentId = null;
let contextTimer, searchRows, searchNormalized, activeMode = 'both';
let renderedHash = '', ready = false, searchLimit = 40, returnSearch = null, returnList = null;
let topicBundle, topicPresentation, topicRequestOptions;
const topicSections = new Set();
let atlasPresentation,atlasRecords,homeAtlasRun=0;
let readingPresentation;
async function loadReading(){
  if(!runtimePath)return {records:{}};
  if(!readingPresentation)readingPresentation=runtime('reading.json').then(p=>{
    if(p.source_sha256!==book.source_sha256)throw Error('阅读编排与当前文本版本不一致');
    return p;
  }).catch(e=>{readingPresentation=null;throw e;});
  return readingPresentation;
}
const normalize = s => simplified(String(s)).normalize('NFKC').toLowerCase();
const cache = new Map();
const assetVersion = new URL(import.meta.url).searchParams.get('v');
const loadJSON=createJSONLoader(location.href,assetVersion);
const json=async(...args)=>presentPeople(await loadJSON(...args),site?.knowledge?.displayNames);
let runtimePath,anchorsPath;
const runtime=async path=>{
  const value=await json(runtimePath+path);
  if(value.source_sha256&&value.source_sha256!==book.source_sha256)throw Error('查询资料与当前文本版本不一致');
  return value;
};
// Simplified display runs on the reviewed projection map; the full vendored
// converter is fetched only when a reader actually switches to traditional.
let zhChars = null, zhPhrases = [], zhPhraseHeads = new Set();
function adoptZhDisplay(display) {
  zhChars = new Map(Object.entries(display.chars));
  zhPhrases = Object.entries(display.phrases).sort((a,b)=>b[0].length-a[0].length);
  zhPhraseHeads = new Set(zhPhrases.map(([from])=>from[0]));
}
const simplified = value => {
  const s = String(value);
  if(!zhChars) return s;
  let out = null, i = 0;
  while(i < s.length){
    let matched = false;
    if(zhPhraseHeads.has(s[i]))
      for(const [from,to] of zhPhrases)if(s.startsWith(from,i)){
        if(out===null)out=s.slice(0,i);
        out+=to;i+=from.length;matched=true;break;
      }
    if(matched)continue;
    const mapped=zhChars.get(s[i]);
    if(mapped!==undefined){if(out===null)out=s.slice(0,i);out+=mapped;}
    else if(out!==null)out+=s[i];
    i++;
  }
  return out===null?s:out;
};
let toTraditional = null, openccPending = null;
function ensureTraditional() {
  if(toTraditional)return Promise.resolve();
  openccPending??=new Promise((resolve,reject)=>{
    if(window.OpenCC){resolve();return;}
    const script=document.createElement('script');
    script.src='vendor/opencc.js'+(assetVersion?'?v='+assetVersion:'');
    script.onload=()=>resolve();
    script.onerror=()=>{openccPending=null;script.remove();reject(Error('繁体转换组件载入失败'));};
    document.head.append(script);
  });
  return openccPending.then(()=>{toTraditional=window.OpenCC.Converter({from:'cn',to:'t'});});
}
const traditional = s => toTraditional ? toTraditional(String(s)) : String(s);
const cv = s => prefs?.zh === 't' ? traditional(String(s)) : simplified(String(s));
const label = kind => site.noteLabels?.[kind] || book.note_types[kind]?.label || ({original:'原文',translation:'译文',source:'附录',heading:'标题',unclassified:'附录'})[kind] || kind;
const collection = id => site.collections.find(c=>c.chapters.includes(id));
const chapterName = s => s.title.replace(/第[一二三四五六七八九十百]+$/,'');
const numeral = n => n<10?'〇一二三四五六七八九'[n]:n<20?'十'+(n%10?numeral(n%10):''):numeral(Math.floor(n/10))+'十'+(n%10?numeral(n%10):'');
const chapterCaption = s => {const c=collection(s.id);return c?`${c.label} · 卷${numeral(c.chapters.indexOf(s.id)+1)}`:'';};
const noteClass = kind => Object.keys(book.note_types).indexOf(kind) % 2 === 1 ? 'note-secondary' : 'note-primary';
const url = (id, target = '') => `#/read/${encodeURIComponent(id)}${target ? '/' + encodeURIComponent(target) : ''}`;
const resourceURL = path => root + 'resources/' + path.split('/').map(encodeURIComponent).join('/');
async function data(path, options) {
  if (!cache.has(path)) {
    const pending=json(root + path, options).catch(e => { if(cache.get(path)===pending)cache.delete(path); throw e; });
    cache.set(path,pending);
  }
  return cache.get(path);
}
function savePrefs() { safeWrite(storageKey + ':preferences', prefs); }
function applyPrefs() {
  document.documentElement.dataset.theme = prefs.theme;
  document.documentElement.lang = prefs.zh === 't' ? 'zh-Hant' : 'zh-Hans';
  document.documentElement.style.setProperty('--fs', prefs.fs + 'px');
  $('#zh').textContent = prefs.zh === 't' ? '简' : '繁';
  $('#theme').textContent = cv(prefs.theme === 'dark' ? '切换至日间' : '切换至夜间');
  $('#brand').textContent = cv(site.title);
  document.querySelectorAll('[data-nav-label]').forEach(a => a.textContent = cv(a.dataset.navLabel));
  $('#nav-toggle').textContent=cv('菜单');
  $('#footer').textContent = cv(`${site.title} · ${site.credit}`);
}
function tokenHTML(tokens, {backlinks = false, source = false, prefix = '', highlight = ''} = {}) {
  return tokens.map((t, i) => {
    if (t.type === 'text') return highlight?highlightText(cv(t.text),highlight,normalize,esc):esc(cv(t.text));
    if (t.type === 'image') return book.assets.includes(t.path)
      ? `<img src="${esc(resourceURL(t.path))}" alt="${esc(t.alt || '原书图版') }" loading="lazy">`
      : '';
    if (t.type === 'link') {
      const content = tokenHTML(t.children, {source});
      if (t.note_id && !source) {
        const n = section.notes[t.note_id];
        return `<button class="note-ref ${noteClass(n.type)}" id="ref-${esc(prefix)}-${i}" data-note="${esc(n.id)}" data-note-type="${esc(n.type)}" aria-controls="${esc(n.id)}" aria-expanded="false" aria-label="${esc(cv(label(n.type)))} ${esc(cv(t.children.map(x=>x.text||'').join('')))}">${content}</button>`;
      }
      if (!backlinks && !source && Object.values(book.note_types).some(n=>new RegExp(n.body_pattern).test(t.anchor||''))) return '';
      const dest = t.target && book.anchor_index[t.target.join('#')];
      const docTarget = t.target && !t.target[1] && book.toc.find(x=>x.source[0]===t.target[0])?.target;
      const hit = dest || docTarget;
      return hit ? `<a href="${url(hit.section,hit.block)}">${content}</a>` : content;
    }
    return '';
  }).join('');
}
function blockHTML(id, options = {}) {
  const b = blockMap.get(id);
  const [path,query='']=location.hash.split('?'),q=new URLSearchParams(query).get('q');
  if(b.kind==='original'&&q&&path.split('/').at(-1)===id)options={...options,highlight:q};
  return `<div class="block kind-${esc(b.kind)} ${book.note_types[b.kind]?'annotation-block':''}" id="${b.id}" tabindex="-1">${tokenHTML(b.tokens, {...options,prefix:b.id})}</div>`;
}
function sectionItems(items) {
  return `<ul class="contents">${items.map(s=>`<li><a href="${url(s.id)}" ${s.id===currentId?'aria-current="page"':''}><span class="chapter-number">${esc(cv(chapterCaption(s)))}</span><span>${esc(cv(chapterName(s)))}</span></a></li>`).join('')}</ul>`;
}
async function loadTopics() {
  if(!site.topics)return null;
  if(!topicBundle){
    const pending=(async()=>{
    const [presentation,catalog]=await Promise.all([loadTopicPresentation(),json(site.knowledge.file,topicRequestOptions)]);
    if(presentation.source_sha256!==book.source_sha256||catalog.source_sha256!==book.source_sha256||
      Object.entries(presentation.section_sha256).some(([id,sha])=>catalog.section_sha256[id]!==sha))throw Error('专题与当前文本版本不一致');
    const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
    const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const refs=new Map(catalog.evidence.map(r=>[r.id,r])),events=new Map(catalog.events.map(e=>[e.id,e]));
    for(const [id,sha] of Object.entries(presentation.bindings))if(!refs.has(id)||await digest(refs.get(id))!==sha)throw Error('专题引文已变化，暂不可查看');
    for(const [id,sha] of Object.entries(presentation.event_bindings))if(!events.has(id)||await digest(events.get(id))!==sha)throw Error('专题史事已变化，暂不可查看');
    return {presentation,catalog};
    })().catch(e=>{if(topicBundle===pending)topicBundle=null;throw e;});
    topicBundle=pending;
  }
  return topicBundle;
}
async function loadTopicPresentation(){
  if(!site.topics)return null;
  if(!topicPresentation){
    const pending=json(site.topics.file,topicRequestOptions).then(p=>{
    if(p.source_sha256!==book.source_sha256)throw Error('专题与当前文本版本不一致');
    return p;
    }).catch(e=>{if(topicPresentation===pending)topicPresentation=null;throw e;});
    topicPresentation=pending;
  }
  return topicPresentation;
}
function resetTopics() {
  // A homepage preview may belong to an earlier release than the catalog.
  // Retry the whole bound bundle, including any previously read source chapters.
  topicBundle=null;topicPresentation=null;topicRequestOptions={cache:'reload'};
  for(const id of topicSections)cache.delete(`sections/${id}.json`);
  topicSections.clear();
}
async function loadAtlas() {
  if(!site.knowledge?.atlas)return null;
  if(!atlasPresentation)atlasPresentation=Promise.all([json(site.knowledge.atlas),loadReading()]).then(([p,reading])=>{
    if(p.source_sha256!==book.source_sha256||p.schema_version!==1||!p.nodes?.length)throw Error('时代星图与当前文本版本不一致');
    return {...p,nodes:p.nodes.map(n=>{const r=reading.records[n.key]||{};return {...n,...(r.summary?{summary:r.summary}:{}),...(Object.hasOwn(r,'time_label')?{time:r.time_label}:{}),members:n.members.map(m=>{const entry=reading.records['event:'+m.id]||{};return {...m,...(Object.hasOwn(entry,'time_label')?{time:entry.time_label}:{})};})};})};
  }).catch(e=>{atlasPresentation=null;throw e;});
  return atlasPresentation;
}
// The detail tier backs the full atlas only; the homepage keeps its light requests.
// site.json is preservation-pinned, so the sibling projection path is derived here.
function loadAtlasRecords(){
  const atlasPath=site.knowledge?.atlas;
  if(!atlasPath||!atlasPath.endsWith('atlas.json'))return Promise.resolve(null);
  if(!atlasRecords)atlasRecords=json(atlasPath.replace(/atlas\.json$/,'atlas-records.json')).then(p=>{
    if(p.source_sha256!==book.source_sha256||p.schema_version!==1||!Array.isArray(p.records))throw Error('星图纪年细事与当前文本版本不一致');
    return p;
  }).catch(e=>{atlasRecords=null;throw e;});
  return atlasRecords;
}
function atlasCommit(hash) {
  saveContext();
  history.replaceState({...history.state,book:storageKey,hash,returnSearch,returnList},'',hash);
  renderedHash=hash;
}
async function showAtlas(host,bundle,qs,saved,home=false) {
  const {mountAtlas}=await import('./atlas.js?v=41167bc9ab1fa07b');
  // The renderer module may resolve after navigation moved on; never mount into a detached host.
  if(!host.isConnected)return;
  const state=mountAtlas(host,bundle,{esc,cv,qs,home,saved:saved?.atlas,onState:atlasCommit,onChange:saveContext});
  replaceHash(atlasHash(state,home));
}
async function home(version,qs,saved) {
  // Core reading entrances are available while optional visual data is loading.
  main.innerHTML=`<section class="hero"><div class="hero-title"><p class="eyebrow">${esc(cv(site.credit))}</p><h1>${esc(cv(site.title))}</h1></div>
  <nav class="collection-grid" aria-label="${cv('分书目录')}">${site.collections.map(c=>`<a class="collection-card" href="#/contents?book=${encodeURIComponent(c.id)}"><span class="collection-title">${esc(cv(c.label))}</span><span class="collection-meta"><span>${cv(`${numeral(c.chapters.length)}卷`)}</span><span>${esc(cv(c.subtitle))}</span></span></a>`).join('')}</nav></section>
  <section class="featured"><div class="section-heading"><h2>${cv('篇目选读')}</h2></div><div class="featured-books">${site.collections.map(c=>`<section><h3>${esc(cv(c.label))}</h3>${sectionItems(site.featured.filter(id=>c.chapters.includes(id)).map(id=>book.sections.find(s=>s.id===id)))}</section>`).join('')}</div></section>`;
  await syncHomeAtlas(version,qs,saved);
}
async function syncHomeAtlas(version,qs,saved) {
  const run=++homeAtlasRun;
  const previous=$('#home-atlas');
  if(mobileLayout.matches){
    if(previous?.contains(document.activeElement))main.focus({preventScroll:true});
    previous?.atlasDispose?.();previous?.remove();return;
  }
  if(!site.knowledge?.atlas)return;
  const atlas=await loadAtlas().catch(()=>null);
  if(version!==routeVersion||run!==homeAtlasRun||mobileLayout.matches||main.dataset.page!=='home')return;
  if(atlas){
    const host=previous||document.createElement('section');host.id='home-atlas';
    if(!previous)main.querySelector('.featured').before(host);
    previous?.atlasDispose?.();showAtlas(host,atlas,qs,saved,true);
  }
}
function directoryHTML(selected='') {
  return `<div class="directory-controls"><label class="sr-only" for="directory-book">${cv('分书')}</label><select id="directory-book" aria-label="${cv('分书')}"><option value="">${cv('全书')}</option>${site.collections.map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${esc(cv(c.label))}</option>`).join('')}</select></div><div class="directory-list">${site.collections.map(c=>`<section class="directory-section" data-collection="${c.id}"><h2>${esc(cv(c.label))}<small>${cv(`${numeral(c.chapters.length)}卷`)}</small></h2>${sectionItems(c.chapters.map(id=>book.sections.find(s=>s.id===id)))}</section>`).join('')}</div>`;
}
function supplements() {
  main.innerHTML=`<header class="page-heading"><p class="eyebrow">${esc(cv(site.title))}</p><h1>${cv('补充材料')}</h1></header>${(site.supplements||[]).map(g=>`<section class="supplement-section"><h2>${esc(cv(g.title))}</h2>${sectionItems(g.sections.map(id=>book.sections.find(s=>s.id===id)))}</section>`).join('')}`;
}
function contents(qs) {
  const selected=site.collections.some(c=>c.id===qs.get('book'))?qs.get('book'):'';
  if(qs.has('book')&&!selected){qs.delete('book');history.replaceState({...history.state,hash:'#/contents'+(qs.size?'?'+qs:'')},'','#/contents'+(qs.size?'?'+qs:''));}
  main.innerHTML=`<header class="page-heading"><p class="eyebrow">${esc(cv(site.title))}</p><h1>${cv('全书目录')}</h1></header>${directoryHTML(selected)}`;
  directoryFilter(main,true);
}
function directoryFilter(container,routeFilter=false) {
  const select=$('select',container);
  const update=()=>{for(const part of container.querySelectorAll('.directory-section'))part.hidden=!!select.value&&part.dataset.collection!==select.value;};
  select.onchange=()=>{if(routeFilter){const q=new URLSearchParams();if(select.value)q.set('book',select.value);navigate('#/contents'+(q.size?'?'+q:''),{...viewSnapshot(),y:0,anchor:null});}else update();};update();
}
function openDirectory() {
  main.readingControls?.prepareJump();
  const dialog=document.createElement('dialog');dialog.className='directory-panel';dialog.setAttribute('aria-labelledby','directory-title');
  dialog.innerHTML=`<div class="panel-head"><h2 id="directory-title">${cv('全书目录')}</h2><button autofocus>${cv('关闭目录')}</button></div>${directoryHTML(collection(currentId)?.id||'')}`;
  document.body.append(dialog);dialog.querySelector('button').onclick=()=>dialog.close();directoryFilter(dialog);
  dialog.addEventListener('close',()=>{dialog.remove();$('#open-directory')?.focus({preventScroll:true});});dialog.showModal();
  dialog.querySelector('[aria-current=page]')?.scrollIntoView({block:'center'});
}
function sidebarHTML() {
  if(!collection(currentId))return `<aside class="chapter-sidebar"><details open id="chapter-navigation"><summary>${cv('补充材料')}</summary>${(site.supplements||[]).map(g=>`<h2 class="supplement-label">${esc(cv(g.title))}</h2>${sectionItems(g.sections.map(id=>book.sections.find(s=>s.id===id)))}`).join('')}<a class="all-contents" href="#/supplements">${cv('全部补充材料')}</a></details></aside>`;
  return `<aside class="chapter-sidebar"><details open id="chapter-navigation"><summary>${cv('本书目录')}</summary>${site.collections.map(c=>`<details class="sidebar-book" id="sidebar-${c.id}" ${c===collection(currentId)?'open':''}><summary>${esc(cv(c.label))}</summary>${sectionItems(c.chapters.map(id=>book.sections.find(s=>s.id===id)))}</details>`).join('')}<a class="all-contents" href="#/contents">${cv('全书目录')}</a></details></aside>`;
}
function notesHTML(group) {
  const ids=[...new Set(group.original.flatMap(id=>blockMap.get(id).tokens.filter(t=>t.note_id).map(t=>t.note_id)))];
  return `<div class="note-stacks">${Object.keys(book.note_types).filter(k=>ids.some(id=>section.notes[id].type===k)).map(k=>`<details class="note-stack ${noteClass(k)}" data-note-type="${esc(k)}" id="notes-${group.id}-${k}"><summary>${esc(cv(label(k)))}</summary>${ids.filter(id=>section.notes[id].type===k).map(id=>{
    const n=section.notes[id],ref=group.original.find(bid=>blockMap.get(bid).tokens.some(t=>t.note_id===id));
    return `<details class="note ${noteClass(n.type)}" id="${n.id}"><summary>${esc(cv(label(n.type)))} ${esc(cv(n.label))}</summary><div class="note-body">${n.blocks.map(b=>blockHTML(b)).join('')}<div class="reading-actions"><button type="button" class="return-link" data-return="${esc(ref)}">${cv('收起')}</button></div></div></details>`;
  }).join('')}</details>`).join('')}</div>`;
}
function setMode(mode) {
  if (!['both','original','translation'].includes(mode)) mode='both';
  activeMode=mode; prefs.mode=mode; savePrefs();
  $('#reading')?.setAttribute('class', 'mode-'+mode);
  applyNoteMarkers();
  document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
  if($('#reading-mode'))$('#reading-mode').value=mode;
  main.readingControls?.refresh();
}
function applyNoteMarkers() {
  main.readingControls?.applyNotes();
}
// Browser-entry context, never per-chapter persistent progress.
function viewSnapshot() {
  const toolbar=$('.toolbar'),top=toolbar?toolbar.getBoundingClientRect().bottom+16:120;
  const nodes=[...main.querySelectorAll('.reading-group,.source-reading .block,[data-context]')];
  const el=nodes.find(el=>{const r=el.getBoundingClientRect();return !el.closest('details:not([open])')&&el.getClientRects().length&&r.bottom>top;});
  return {y:window.scrollY,anchor:el?.id,offset:el?.getBoundingClientRect().top,
    ...(main.readingControls?{noteReveal:main.readingControls.revealedId()}:{}),
    topic:$('.topic-page')?{mode:$('.topic-page').dataset.topicMode,a:$('.topic-page').dataset.topicA,b:$('.topic-page').dataset.topicB}:null,
    atlas:$('.atlas')?{scrollLeft:$('.atlas-scroll').scrollLeft,yearbookLayout:$('.atlas').dataset.yearbookLayout}:null,
    atlasReturn:$('.yearbook-page')?.atlasReturn||null,
    lifeRevision:main.querySelector('.person-biography')?.dataset.lifeRevision,
    lifeLimits:Object.fromEntries([...main.querySelectorAll('[data-life-list]')].map(e=>[e.dataset.lifeList,Number(e.dataset.limit)||20])),
    knowledgeLimit:Number($('.knowledge-page')?.dataset.limit)||0,
    open:[...main.querySelectorAll('details[open]')].map(el=>el.id || el.closest('.reading-group')?.id).filter(Boolean),
    returns:[...main.querySelectorAll('.note[open][data-return-id]')].map(el=>[el.id,el.dataset.returnId]),
    closed:[...main.querySelectorAll('.chapter-sidebar details:not([open]),.life-navigation:not([open])')].map(el=>el.id),searchLimit};
}
function restoreView(saved) {
  if(!saved)return;
  main.readingControls?.resetScrollIntent();
  for(const id of saved.closed||[]){const el=document.getElementById(id);if(el)el.open=false;}
  for(const id of saved.open||[]){const el=document.getElementById(id);if(el?.matches('details'))el.open=true;
    else if(el?.matches('.yearbook-group-members'))el.closest('.yearbook-entry').open=true;
    else if(el?.matches('.reading-group')&&el.querySelector('.note-stack'))el.querySelector('.note-stack').open=true;}
  $('.knowledge-page')?.restoreInlineReading?.();
  for(const [id,ref] of saved.returns||[]){const el=document.getElementById(id);if(el)el.dataset.returnId=ref;}
  const anchor=saved.anchor && document.getElementById(saved.anchor);
  if(anchor?.getClientRects().length && saved.y>0)window.scrollBy(0,anchor.getBoundingClientRect().top-saved.offset);
  else window.scrollTo(0,saved.y||0);
  if(saved.filterFocus)document.getElementById(saved.filterFocus)?.focus({preventScroll:true});
}
function saveContext() {
  if(!ready || renderedHash!==location.hash)return;
  history.replaceState({...history.state,book:storageKey,hash:renderedHash,view:viewSnapshot(),returnSearch,returnList},'');
}
function localPosition(a) {
  const [path,query='']=a.getAttribute('href').split('?'),[current,currentQuery='']=location.hash.split('?');
  if(path!==current)return false;
  const next=new URLSearchParams(query),prior=new URLSearchParams(currentQuery);let target=null;
  if(path.startsWith('#/people/')&&next.has('at')&&next.get('view')===prior.get('view'))target=document.getElementById('life-'+next.get('at'));
  if(path.startsWith('#/topics/')&&$('.topic-page')){
    if(a.dataset.topicRef)target=document.getElementById(a.dataset.topicRef);
    else if(next.has('ref'))target=[...main.querySelectorAll('[data-topic-evidence]')].find(el=>el.dataset.topicEvidence===next.get('ref'));
    else if(next.has('step'))target=document.getElementById('topic-step-'+next.get('step'));
    if(target?.closest('.topic-chapter')?.hidden)main.querySelector('[data-topic-view=all]')?.click();
  }
  if(path.startsWith('#/events/')&&next.has('ref')){
    target=document.getElementById('source-'+next.get('ref'))||[...main.querySelectorAll('[data-evidence-ids]')].find(el=>JSON.parse(el.dataset.evidenceIds).includes(next.get('ref')));
  }
  if(!target||!main.contains(target))return false;
  saveContext();for(let el=target.parentElement;el&&el!==main;el=el.parentElement)if(el.tagName==='DETAILS')el.open=true;
  const quote=target.querySelector('.source-quote');if(quote&&next.has('ref'))quote.open=true;
  main.querySelectorAll('[data-source-target]').forEach(el=>el.removeAttribute('data-source-target'));target.setAttribute('data-source-target','');
  main.querySelectorAll('.topic-steps a').forEach(link=>{if(new URLSearchParams(link.hash.split('?')[1]).get('step')===next.get('step'))link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});
  history.replaceState({...history.state,hash:a.getAttribute('href')},'',a.getAttribute('href'));renderedHash=location.hash;
  if(!target.hasAttribute('tabindex'))target.tabIndex=-1;target.scrollIntoView({block:'start'});target.focus({preventScroll:true});saveContext();return true;
}

function navigate(hash, saved=null, origin=null, list=null) {
  saveContext();document.querySelector('.directory-panel')?.close();
  history.pushState({book:storageKey,hash,view:saved,returnSearch:origin,returnList:list},'',hash);
  route();
}
function mountSourceReturn(origin,fromSearch) {
  const previous=main.querySelector('[data-source-return]');
  if(previous){if(previous.matches('.back-search,.knowledge-back'))previous.remove();else{delete previous.dataset.sourceReturn;previous.onclick=null;}}
  if(mobileLayout.matches&&origin.hash.split('?')[0]==='#/')origin={...origin,label:'返回首页'};
  if(mobileLayout.matches&&origin.hash.startsWith('#/events?')&&new URLSearchParams(origin.hash.split('?')[1]).get('view')==='atlas'){
    const q=new URLSearchParams(origin.hash.split('?')[1]);
    origin={...origin,label:'返回大事年表',hash:yearbookHash({key:q.get('node'),filters:Object.fromEntries(['q','person'].map(k=>[k,q.get(k)]).filter(([,v])=>v))}),view:{atlasReturn:{hash:origin.hash,view:origin.view}}};
  }
  const embedded=[...main.querySelectorAll('.crumb a,.knowledge-tabs a,.source-scope-actions a')]
    .find(a=>a.getAttribute('href')===origin.hash&&a.getAttribute('aria-current')!=='page');
  const back=embedded||document.createElement('a');back.dataset.sourceReturn='';
  if(!embedded){back.className=fromSearch?'back-search':'knowledge-back';back.href=origin.hash;
    back.textContent=cv(origin.label?.replace(/[\u2190\u2192\u2197\u2191\u2193]/g,'').trim()||(origin.hash.startsWith('#/people')?'返回风云人物':origin.hash.includes('view=highlights')?'返回大事年表':'返回记载查询'));
    (main.querySelector('.chapter-article')||main).prepend(back);
  }
  back.onclick=e=>{if(e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();e.stopPropagation();
    navigate(origin.hash,origin.view,fromSearch?origin.parent||null:origin.origin||null,fromSearch?origin.returnList||null:null);};
}
// A deep link may reveal one note; only reader controls change the preference.
function focusTarget(id,{revealNotes=true}={}) {
  main.readingControls?.prepareJump();
  let el=document.getElementById(id);
  if (!el || !main.contains(el)) return false;
  if(el.closest('[data-note-type]')&&prefs.noteVisibility[el.closest('[data-note-type]').dataset.noteType]===false){
    if(revealNotes)el=main.readingControls.revealNote(el)||el;
    if(el.closest('.note')?.hidden||el.matches('.note-ref')&&el.hidden)el=el.closest('.reading-group');
  }
  if (section.status==='aligned' && el.closest('.original,.note-stack') && activeMode==='translation') setMode('both');
  if (section.status==='aligned' && el.closest('.translation') && activeMode==='original') setMode('both');
  let parent=el.parentElement;
  while(parent && parent!==main){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}
  el.scrollIntoView({block:'start'}); el.focus({preventScroll:true}); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  return true;
}
async function readSection(id,target,version,saved) {
  const info=book.sections.find(x=>x.id===id);
  if(!info)throw Error('目录中没有这一章节');
  const [loaded,anchors,controls]=await Promise.all([data(`sections/${id}.json`),book.anchor_index||json(anchorsPath),import('./reading-controls.js?v=41167bc9ab1fa07b')]);
  const {readingSettingsHTML,chapterProgressHTML,mountReadingControls}=controls;
  if(version!==routeVersion)return;
  book.anchor_index=anchors;
  section=loaded;currentId=id;blockMap=new Map(section.blocks.map(b=>[b.id,b]));groupForBlock=new Map();
  for(const g of section.groups)for(const bid of [...g.original,...g.translation])groupForBlock.set(bid,g.id);
  const aligned=section.status==='aligned';
  const first=section.blocks[0],titleBlock=!aligned&&first?.kind==='heading'&&first.text===section.title&&first.tokens.every(t=>t.type==='text')?first:null;
  const landmarks=aligned?section.groups:section.blocks.filter(b=>b.kind==='heading'||b.kind==='original'||b.tokens.some(t=>t.type==='image'));
  const landmarkText=g=>[...blockText(aligned?blockMap.get(g.original[0]):g,section)].slice(0,18).join('')||'原书图版';
  const settingsHTML=readingSettingsHTML({types:aligned?Object.keys(book.note_types).map(type=>[type,label(type)]):[],landmarks:landmarks.map(g=>[g.id,landmarkText(g)]),fontSize:prefs.fs,esc,cv});
  const toolbar=`<div class="toolbar" role="region" aria-label="${cv('阅读工具')}"><div class="toolbar-row"><button id="open-directory">${cv('目录')}</button>${aligned?`<select id="reading-mode" aria-label="${cv('文白模式')}">${['both','original','translation'].map((m,i)=>`<option value="${m}">${cv(['对照','原文','译文'][i])}</option>`).join('')}</select>`:''}${chapterProgressHTML(cv)}${settingsHTML}</div></div>`;
  const body=aligned?section.groups.map(g=>`<section class="reading-group" id="${g.id}" tabindex="-1"><a class="passage-link" href="${url(id,g.id)}" aria-label="${cv('此处链接')}" title="${cv('此处链接')}">⌁</a><div class="parallel"><div class="column original">${g.original.map(b=>blockHTML(b)).join('')}</div><div class="column translation">${g.translation.map(b=>blockHTML(b)).join('')}</div></div>${notesHTML(g)}</section>`).join(''):`<div class="source-reading">${section.blocks.filter(b=>b!==titleBlock).map(b=>blockHTML(b.id,{source:true,backlinks:true})).join('')}</div>`;
  const peers=info.kind==='chapter'?book.sections.filter(s=>s.kind==='chapter'):(site.supplements||[]).flatMap(g=>g.sections).map(sid=>book.sections.find(s=>s.id===sid));
  const idx=peers.findIndex(s=>s.id===id),prev=idx>=0?peers[idx-1]:null,next=idx>=0?peers[idx+1]:null;
  main.innerHTML=`<div class="chapter-layout">${sidebarHTML()}<article class="chapter-article"><header class="chapter-heading"><p class="eyebrow">${esc(cv(chapterCaption(info)))}</p><h1 ${titleBlock?`id="${esc(titleBlock.id)}" tabindex="-1"`:''}>${titleBlock?tokenHTML(titleBlock.tokens,{source:true}):esc(cv(section.title))}</h1></header>${toolbar}<div id="reading">${body}</div><nav class="pager" aria-label="${cv('相邻篇目')}">${prev?`<a href="${url(prev.id)}">${cv('上一篇')}：${esc(cv(prev.title))}</a>`:'<span></span>'}${next?`<a href="${url(next.id)}">${cv('下一篇')}：${esc(cv(next.title))}</a>`:''}</nav></article></div>`;
  main.readingControls=mountReadingControls({host:main,getPrefs:()=>prefs,cv,
    entries:landmarks.map(g=>[document.getElementById(g.id),landmarkText(g)]).filter(([el])=>el),
    onNoteChange:(type,visible)=>{const view=viewSnapshot();prefs.noteVisibility[type]=visible;savePrefs();applyNoteMarkers();restoreView(view);saveContext();},
    onFontChange:delta=>resize(delta),onJump:target=>navigate(url(id,target)),onPositionChange:saveContext});
  if(aligned)setMode(prefs.mode);else activeMode='source';
  $('#open-directory').onclick=openDirectory;
  if($('#reading-mode'))$('#reading-mode').onchange=event=>{const saved=viewSnapshot();setMode(event.target.value);restoreView(saved);saveContext();};
  document.querySelectorAll('[data-note]').forEach(b=>b.onclick=()=>{
    const note=document.getElementById(b.dataset.note);
    if(note.open){note.open=false;delete note.dataset.returnId;b.setAttribute('aria-expanded','false');b.focus({preventScroll:true});saveContext();return;}
    note.parentElement.open=true;note.open=true;
    b.setAttribute('aria-expanded','true');note.dataset.returnId=b.id;
    note.scrollIntoView({block:'nearest'});note.querySelector('summary').focus({preventScroll:true});saveContext();
  });
  const closeNote=n=>{
    const temporary=main.readingControls.isTemporary(n),ref=document.getElementById(n.dataset.returnId);
    const dest=temporary?n.closest('.reading-group'):ref?.getClientRects().length?ref:ref?.closest('.block')||n.querySelector('summary');
    n.open=false;delete n.dataset.returnId;main.readingControls.dismissNote(n);
    dest?.focus({preventScroll:true});dest?.scrollIntoView({block:ref&&!temporary?'center':'nearest'});saveContext();
  };
  document.querySelectorAll('.note').forEach(n=>{
    n.querySelector('summary').addEventListener('click',e=>{e.preventDefault();if(n.open&&main.readingControls.isTemporary(n)){closeNote(n);return;}delete n.dataset.returnId;n.open=!n.open;document.querySelectorAll(`[data-note="${n.id}"]`).forEach(b=>b.setAttribute('aria-expanded',String(n.open)));saveContext();});
    n.addEventListener('toggle',()=>{if(!n.open)delete n.dataset.returnId;document.querySelectorAll(`[data-note="${n.id}"]`).forEach(b=>b.setAttribute('aria-expanded',String(n.open)));saveContext();});
  });
  document.querySelectorAll('.note-stack>summary').forEach(summary=>summary.addEventListener('click',e=>{
    e.preventDefault();const stack=summary.parentElement,n=stack.querySelector('.note:not([hidden])');
    if(stack.open&&n&&main.readingControls.isTemporary(n)){closeNote(n);return;}
    stack.open=!stack.open;saveContext();
  }));
  document.querySelectorAll('[data-return]').forEach(a=>a.onclick=()=>closeNote(a.closest('.note')));
  if(saved?.noteReveal){const note=document.getElementById(saved.noteReveal);if(note)main.readingControls.revealNote(note);}
  if(target){if(!focusTarget(target,{revealNotes:!saved||!Object.hasOwn(saved,'noteReveal')}))main.insertAdjacentHTML('afterbegin',`<p role="status">${cv('未找到指定段落，已显示本章。')}</p>`);}
  else window.scrollTo(0,0);
}
function resize(delta){const saved=viewSnapshot();
  prefs.fs=Math.min(30,Math.max(16,prefs.fs+delta));savePrefs();applyPrefs();restoreView(saved);saveContext();main.readingControls?.syncSettings();main.readingControls?.refresh();}
async function search(qs,version){
  const q=qs.get('q')||'',type=qs.get('type')==='people'?'people':'original';
  const bookScope=type==='original'&&site.collections.some(c=>c.id===qs.get('book'))?qs.get('book'):'';
  if(type==='original'&&qs.has('book')&&!bookScope){qs.delete('book');replaceHash(searchHash(type,q));}
  const scopeLabel=bookScope?site.collections.find(c=>c.id===bookScope).label:'全书';
  main.innerHTML=`<p class="eyebrow">${esc(cv(site.title))}</p><h1>${cv('检索')}</h1><nav class="knowledge-tabs search-modes" aria-label="${cv('检索类型')}">${[['original','原文'],['people','人物']].map(([key,title])=>`<a id="search-${key}" data-search-type="${key}" href="${esc(searchHash(key,q))}" ${type===key?'aria-current="page"':''}>${cv(title)}</a>`).join('')}</nav><p class="search-scope">${cv(type==='people'?'按姓名、字或别名检索人物。':`检索${scopeLabel}正文，不含译文、裴注及现代注释。`)}</p><form class="search-form" role="search">${type==='original'?`<label class="sr-only" for="search-book">${cv('检索范围')}</label><select id="search-book"><option value="">${cv('全书')}</option>${site.collections.map(c=>`<option value="${c.id}" ${c.id===bookScope?'selected':''}>${esc(cv(c.label))}</option>`).join('')}</select>`:''}<input id="query" type="search" aria-label="${cv('关键词')}" value="${esc(q)}"><button>${cv('检索')}</button></form><div id="results" aria-live="polite"></div>`;
  const syncLinks=()=>main.querySelectorAll('[data-search-type]').forEach(a=>a.href=searchHash(a.dataset.searchType,$('#query').value));
  $('#query').addEventListener('input',syncLinks);
  if($('#search-book'))$('#search-book').onchange=e=>navigate(searchHash(type,$('#query').value,e.target.value),{searchFocus:'search-book'});
  main.querySelectorAll('[data-search-type]').forEach(a=>a.addEventListener('click',e=>{
    if(e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
    e.preventDefault();
    if(a.dataset.searchType!==type)navigate(searchHash(a.dataset.searchType,$('#query').value),{searchFocus:a.id});
  }));
  $('.search-form').onsubmit=e=>{e.preventDefault();navigate(searchHash(type,$('#query').value,$('#search-book')?.value||''),{searchFocus:'query'});};
  $('.search-form').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.isComposing)e.preventDefault();});
  if(!q.trim()){ $('#results').innerHTML=`<p class="query-empty">${cv(type==='people'?'输入姓名、字或别名，如：诸葛亮、孔明。':`全书正文共${numeral(site.collections.reduce((n,c)=>n+c.chapters.length,0))}卷：${site.collections.map(c=>`${c.label}${numeral(c.chapters.length)}卷`).join('、')}。`)}</p>`;return;}
  const out=$('#results');out.textContent=cv('正在检索……');
  let hits;
  if(type==='people'){
    const index=await runtime('people-search.json');if(version!==routeVersion)return;
    hits=searchPeople(index.persons,q,normalize);
  }else{
    // The slim projection carries only the original blocks of main chapters.
    if(!searchRows)searchRows=(await runtime('search-original.json')).rows;
    if(version!==routeVersion)return;
    if(!searchNormalized)searchNormalized=searchRows.map(r=>normalize(r.text));
    const needle=normalize(q);
    hits=searchRows.map((r,i)=>({...r,at:searchNormalized[i].indexOf(needle)})).filter(r=>r.at>=0&&book.sections.some(s=>s.id===r.section&&s.kind==='chapter')&&(!bookScope||collection(r.section)?.id===bookScope));
  }
  let shown=0;
  out.innerHTML=`<p>${cv('命中')} ${hits.length} ${cv(type==='people'?'人':'段')}</p>${hits.length?'':`<p class="query-empty">${cv(type==='people'?'未找到匹配人物，可尝试姓名、字或别名。':`${scopeLabel}正文未命中，可尝试其他原文用词；译文、裴注及现代注释不在检索范围内。`)}</p>`}<div id="hit-list"></div><p class="search-status sr-only" role="status"></p>`;
  const list=$('#hit-list');
  const add=async(manual=false)=>{
    $('#more')?.remove();
    const startIndex=shown;
    const batch=hits.slice(shown,shown+40);
    const sections=type==='people'?{}:Object.fromEntries(await Promise.all([...new Set(batch.map(h=>h.section))].map(async id=>[id,await data(`sections/${id}.json`)])));
    if(version!==routeVersion)return;
    const display=new Map();
    if(type!=='people')for(const h of batch){
      const source=sections[h.section],block=source.blocks.find(b=>b.id===h.block);
      if(!block||block.text!==h.text)throw Error('检索摘要与当前文本不一致');
      display.set(h,simplified(blockText(block,source)));
    }
    for(const h of batch){
      if(type==='people'){
        const sources=(h.sections||[]).map(id=>book.sections.find(s=>s.id===id)?.title).filter(Boolean);
        list.insertAdjacentHTML('beforeend',`<article class="result" id="search-person-${esc(h.id)}" data-context tabindex="-1"><h2><a href="#/people/${encodeURIComponent(h.id)}">${esc(cv(h.name))}</a></h2>${h.courtesy.length?`<p>${cv('字')}：${h.courtesy.map(value=>esc(cv(value))).join('、')}</p>`:''}${sources.length?`<p class="result-meta">${sources.map(value=>esc(cv(value))).join(' · ')}</p>`:''}</article>`);
        continue;
      }
      const sectionInfo=book.sections.find(s=>s.id===h.section);
      const normalizedDisplay=display.get(h);const pos=normalizedDisplay.indexOf(simplified(q));
      const start=Math.max(0,(pos>=0?pos:h.at)-28),snippet=normalizedDisplay.slice(start,start+150);
      const matchAt=snippet.indexOf(simplified(q));
      const snippetHTML=matchAt<0?esc(cv(snippet)):esc(cv(snippet.slice(0,matchAt)))+'<mark>'+esc(cv(snippet.slice(matchAt,matchAt+simplified(q).length)))+'</mark>'+esc(cv(snippet.slice(matchAt+simplified(q).length)));
      list.insertAdjacentHTML('beforeend',`<article class="result"><div class="result-meta">${esc(cv(collection(h.section)?.label||''))}</div><a href="${url(h.section,h.block)+'?'+new URLSearchParams({q})}">${esc(cv(sectionInfo.title))}</a><p>${start?'…':''}${snippetHTML}${start+150<normalizedDisplay.length?'…':''}</p></article>`);
    }
    shown=Math.min(shown+40,hits.length);searchLimit=shown;
    if(shown<hits.length){const more=document.createElement('button');more.id='more';more.textContent=cv('加载更多');more.onclick=async()=>{try{await add(true);}catch{if(version!==routeVersion)return;more.textContent=cv('重试加载');out.append(more);$('.search-status').textContent=cv('摘要暂无法载入，请重试。');}};out.append(more);}
    if(manual){const first=list.children[startIndex];first.tabIndex=-1;first.focus({preventScroll:true});$('.search-status').textContent=cv(`已增加 ${shown-startIndex} 条结果`);saveContext();}
  };const wanted=history.state?.view?.searchLimit||40;await add();while(version===routeVersion&&shown<Math.min(wanted,hits.length))await add();
}
function replaceHash(hash) {
  if(hash===location.hash)return;
  const state=history.state?.hash===location.hash?history.state:{};
  history.replaceState({...state,hash},'',hash);
}
function closeMenu(restoreFocus=false) {
  const button=$('#nav-toggle');
  document.querySelectorAll('.nav-group[open]').forEach(group=>group.open=false);
  if(button.getAttribute('aria-expanded')!=='true')return;
  button.setAttribute('aria-expanded','false');
  if(restoreFocus&&button.getClientRects().length)button.focus({preventScroll:true});
}
function updateNavigation(parts) {
  const current=parts[0]==='read'?(section?.kind==='chapter'?'contents':'supplements'):(parts[0]==='timeline'?'events':parts[0]||'');
  const params=new URLSearchParams(location.hash.split('?')[1]||'');
  const view=params.get('view');
  let target='#/'+current;
  if(current==='contents'){
    const selected=parts[0]==='read'?collection(section?.id)?.id:params.get('book');
    if(site.collections.some(c=>c.id===selected))target+='?book='+selected;
  }
  if(current==='events'&&['atlas','highlights'].includes(view))target+='?view='+view;
  if(current==='people'&&parts[1]){
    const queue=[returnSearch,returnList],seen=new Set();let source='';
    while(queue.length&&!source){
      const item=queue.shift();if(!item||seen.has(item))continue;seen.add(item);
      if(item.hash?.startsWith('#/search'))source='#/search';
      else if(/^#\/people(?:\?|$)/.test(item.hash||''))source='#/people';
      else if(/^#\/(events|topics)(?:[/?]|$)/.test(item.hash||''))source='#/events';
      else queue.push(item.parent,item.origin,item.returnList);
    }
    target=source||(site.knowledge.featuredPeople.includes(parts[1])?'#/people':'#/search');
  }
  document.querySelectorAll('#site-nav a').forEach(a=>{
    if(a.hash===target)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  });
  document.querySelectorAll('.nav-group').forEach(group=>{
    const active=!!group.querySelector('[aria-current=page]')||((current==='events'||target==='#/events')&&group.dataset.nav==='era');
    group.classList.toggle('is-current',active);
    const summary=group.querySelector('summary');
    if(active)summary.setAttribute('aria-current','true');else summary.removeAttribute('aria-current');
  });
}
async function route(){
  replaceHash(canonicalAtlasHomeHash(location.hash,mobileLayout.matches));
  replaceHash(legacyKnowledgeHash(location.hash));
  replaceHash(canonicalSearchHash(location.hash));
  if(location.hash.startsWith('#/read/')&&(site.excludedSections||[]).some(id=>location.hash.split('?')[0].split('/')[2]===id))replaceHash('#/supplements');
  closeMenu(document.activeElement?.closest('#site-nav'));
  ready=false;clearTimeout(contextTimer);currentId=null;document.querySelector('.directory-panel')?.close();
  const entry=history.state?.book===storageKey&&history.state?.hash===location.hash?history.state:{};
  let saved=entry.view;returnSearch=entry.returnSearch||null;returnList=entry.returnList||null;searchLimit=40;
  const version=++routeVersion;let knowledgeTitle='';
  const [path,query='']=location.hash.slice(1).split('?');
  let parts;try{parts=(path||'/').split('/').filter(Boolean).map(decodeURIComponent);}catch{parts=[];}
  const qs=new URLSearchParams(query);
  main.dataset.page=parts[0]||'home';
  main.peopleLoadingDispose?.();main.lifeNavigationDispose?.();main.readingControls?.dispose();delete main.readingControls;
  document.documentElement.classList.toggle('reading-page',parts[0]==='read');
  $('.atlas')?.atlasDispose?.();
  main.querySelectorAll('[data-floating-panel]').forEach(panel=>panel.disposeFloating?.());
  main.innerHTML=`<p role="status">${cv('正在载入……')}</p>`;
  try{
    if(parts[0]==='read')await readSection(parts[1],parts[2],version,saved);
    else if(parts[0]==='contents')contents(qs);
    else if(parts[0]==='supplements')supplements();
    else if(parts[0]==='search'){await search(qs,version);knowledgeTitle='检索';}
    else if(parts[0]==='events'&&parts.length===1&&qs.get('view')==='atlas'){
      let atlas=await loadAtlas();if(version!==routeVersion)return;
      if(!atlas)throw Error('时代星图暂时不可用');
      if(['q','person','year'].some(k=>qs.get(k))){
        const [{filteredOverviewItems},catalog,editorial]=await Promise.all([import('./event-editorial.js?v=41167bc9ab1fa07b'),runtimePath?runtime('highlights.json'):json(site.knowledge.file),json(site.knowledge.editorial)]);
        if(version!==routeVersion)return;
        if(catalog.source_sha256!==book.source_sha256||editorial.source_sha256!==catalog.source_sha256||Object.entries(editorial.section_sha256).some(([id,sha])=>catalog.section_sha256[id]!==sha))throw Error('史事资料版本不一致');
        const filters=new URLSearchParams();for(const k of ['q','person','year'])if(qs.get(k))filters.set(k,qs.get(k));
        atlas={...atlas,allowedKeys:filteredOverviewItems(catalog.events,editorial,filters,normalize).map(i=>i.type+':'+i.id)};
      }
      if(mobileLayout.matches){
        const state=atlasState(atlas,qs),target=yearbookHash(state,saved?.atlas?.yearbookLayout);
        const atlasReturn={hash:atlasHash(state),view:saved||null};
        history.replaceState({...history.state,book:storageKey,hash:target,view:{atlasReturn}},'',target);
        return route();
      }
      const filterNotice=['q','person'].some(k=>qs.get(k))?`<p class="meta">${cv('已沿用年表筛选，可返回年表调整。')}</p>`:'';
      main.innerHTML=`<div class="knowledge-page query-view atlas-explore"><nav class="knowledge-tabs" aria-label="${cv('史事视图')}"><a href="#/events?view=atlas" aria-current="page">${cv('时代星图')}</a><a data-yearbook-link href="#/events?view=highlights">${cv('大事年表')}</a></nav>${filterNotice}<section id="full-atlas"></section></div>`;
      // A failed detail tier still leaves the curated lanes fully usable.
      const detail=await loadAtlasRecords().catch(e=>{console.warn(e.message);return null;});
      if(version!==routeVersion)return;
      if(detail)atlas={...atlas,records:detail.records};
      showAtlas($('#full-atlas'),atlas,qs,saved);knowledgeTitle='时代星图';
    }
    else if(['people','events','timeline'].includes(parts[0])){
      if(!site.knowledge)throw Error('查询资料暂时不可用');
      const [{renderKnowledge,canonicalKnowledgeHash},{biographyContext}]=await Promise.all([import('./knowledge.js?v=41167bc9ab1fa07b'),import('./profiles.js?v=41167bc9ab1fa07b')]);
      const projected=runtimePath&&(parts[0]==='people'||(parts[0]==='events'&&(parts[1]||qs.get('view')==='highlights')));
      const resource=parts[0]==='people'?(parts[1]?(qs.get('view')==='sources'?'sources/':'people/')+encodeURIComponent(parts[1])+'.json':'directory.json'):(parts[1]?'events/'+encodeURIComponent(parts[1])+'.json':'highlights.json');
  const [content,presentation,classification,reading]=await Promise.all([
        projected?runtime(resource):json(site.knowledge.file),
        !projected&&site.knowledge.profiles?json(site.knowledge.profiles):null,
        parts[0]==='events'&&site.knowledge.editorial?json(site.knowledge.editorial).catch(loadError=>({loadError})):null,
        loadReading()
      ]);if(version!==routeVersion)return;
      if(projected)attachRuntime(content,runtime);
      if(projected&&qs.get('person')&&!content.persons.some(p=>p.id===qs.get('person'))){
        const chooser=await runtime('chooser.json');if(version!==routeVersion)return;
        const person=chooser.persons.find(p=>p.id===qs.get('person'));if(person)content.persons.push(person);
      }
      if(content.source_sha256!==book.source_sha256)throw Error('查询资料与当前文本版本不一致，暂不可查看');
      if(presentation&&(presentation.source_sha256!==content.source_sha256||Object.entries(presentation.section_sha256).some(([id,sha])=>content.section_sha256[id]!==sha)))throw Error('人物资料与当前文本版本不一致');
      const profiles=content.profiles||presentation?.profiles||{};
      let editorial=null;
      if(parts[0]==='events'&&site.knowledge.editorial){
        try{
          editorial=classification;
          if(editorial.loadError)throw editorial.loadError;
          if(editorial.source_sha256!==content.source_sha256||Object.entries(editorial.section_sha256).some(([id,sha])=>content.section_sha256[id]!==sha))throw Error('史事分类与当前文本版本不一致');
        }catch(error){
          editorial=null;
          if(qs.get('view')==='highlights'||['category','importance','kind','group'].some(key=>qs.has(key)))throw error;
        }
      }
      if(parts[0]==='people'&&qs.get('view')!=='sources')saved=biographyContext(profiles[parts[1]]?.biography,saved);
      replaceHash(canonicalKnowledgeHash(parts,qs,content,profiles,editorial));
      const cleanQS=new URLSearchParams(location.hash.split('?')[1]||'');
      let sections={};
      if(parts[0]==='events'&&parts[1]){
        const event=content.events.find(e=>e.id===parts[1]);
        if(event){
          const refs=new Set([...event.time.evidence,...event.accounts.flatMap(a=>a.evidence),...event.participants.flatMap(p=>p.evidence),...(event.place?.evidence||[])]);
          const ids=[...new Set(content.evidence.filter(r=>refs.has(r.id)).map(r=>r.section))];
          sections=Object.fromEntries(await Promise.all(ids.map(async id=>[id,await data(`sections/${id}.json`)])));
          if(version!==routeVersion)return;
        }
      }
      const yearbookAtlas=cleanQS.get('view')==='highlights'?await loadAtlas():null;if(version!==routeVersion)return;
      knowledgeTitle=renderKnowledge(content,{main,parts,qs:cleanQS,esc,cv,normalize,url,navigate:(hash,filterFocus)=>navigate(hash,{...(filterFocus?{y:window.scrollY,filterFocus}:{}),atlasReturn:$('.yearbook-page')?.atlasReturn||null},returnSearch,returnList),loadSection:id=>data(`sections/${id}.json`),saved,profiles,featuredPeople:site.knowledge.featuredPeople,personListHash:returnList?.hash.startsWith('#/people')?returnList.hash:(parts[0]==='people'&&parts[1]&&!site.knowledge.featuredPeople.includes(parts[1])?'#/search?type=people':'#/people'),eventHasContext:!!(returnList||returnSearch),editorial,reading,atlas:yearbookAtlas,atlasEnabled:!!site.knowledge.atlas,sections,visiblePeople:site.knowledge.people??null,legacySources:parts[0]==='events'&&qs.get('view')==='sources',onChange:saveContext});
      const yearbook=$('.yearbook-page');
      if(yearbook&&saved?.atlasReturn){
        yearbook.atlasReturn=saved.atlasReturn;
        const back=yearbook.querySelector('.knowledge-tabs a[href*="view=atlas"]');
        if(back)back.href=saved.atlasReturn.hash;
      }
      if(parts[0]==='events'&&parts[1]&&editorial?.records[parts[1]]){
        const record=editorial.records[parts[1]];
        const metadata=document.createElement('div');metadata.className='event-classification';
        metadata.innerHTML=[editorial.taxonomy.record_kind[record.record_kind],editorial.taxonomy.importance[record.importance],...record.categories.map(c=>editorial.taxonomy.categories[c])].map(label=>`<span>${esc(cv(label))}</span>`).join('<span aria-hidden="true"> · </span>');
        $('.knowledge-heading',main)?.append(metadata);
      }
    }
    else if(parts[0]==='topics'&&parts.length===1){
      const [{topicDirectory},presentation]=await Promise.all([import('./topics.js?v=41167bc9ab1fa07b'),loadTopicPresentation()]);if(version!==routeVersion)return;
      if(!presentation)throw Error('专题暂时不可用');
      main.innerHTML=topicDirectory(presentation,{esc,cv});knowledgeTitle='专题研究';
    }
    else if(parts[0]==='topics'){
      const [{renderTopic},bundle]=await Promise.all([import('./topics.js?v=41167bc9ab1fa07b'),loadTopics()]);if(version!==routeVersion)return;
      const topic=bundle?.presentation.topics.find(t=>t.id===parts[1]);
      if(!topic||parts.length!==2)throw Error('未找到此专题');
      const ids=Object.keys(bundle.presentation.section_sha256);
      ids.forEach(id=>topicSections.add(id));
      const sections=Object.fromEntries(await Promise.all(ids.map(async id=>[id,await data(`sections/${id}.json`,topicRequestOptions)])));
      if(version!==routeVersion)return;
      knowledgeTitle=renderTopic(topic,bundle.catalog,{main,qs,esc,cv,url,collection,sections,saved,onChange:saveContext});
      $('#topic-smaller').onclick=()=>resize(-1);$('#topic-larger').onclick=()=>resize(1);
    }
    else await home(version,qs,saved);
    if(version!==routeVersion)return;
    const origin=returnSearch||(['people','events'].includes(parts[0])&&parts[1]?returnList:null);
    if(origin)mountSourceReturn(origin,!!returnSearch);
    if(parts[0]!=='read')window.scrollTo(0,0);
    restoreView(saved);
    if(parts[0]==='search'&&saved?.searchFocus)document.getElementById(saved.searchFocus)?.focus({preventScroll:true});
    await $('.knowledge-page')?.restoreInlineReading?.();
    await $('.knowledge-page')?.citationReady?.();
    if(version!==routeVersion)return;
    restoreView(saved);
    if(!saved||saved.y===undefined){const target=main.querySelector('[data-source-target]');if(target){target.scrollIntoView({block:'start'});target.focus({preventScroll:true});}}
    if(parts[0]==='people'){const {bindPeopleLoading,bindLifeNavigation}=await import('./people-reading.js?v=41167bc9ab1fa07b');bindPeopleLoading(main,{text:cv});bindLifeNavigation(main,{onChange:saveContext});}
    updateNavigation(parts);renderedHash=location.hash;ready=true;saveContext();
    document.title=cv(`${parts[0]==='read'?section.title+' · ':knowledgeTitle?knowledgeTitle+' · ':''}${site.title}`);
  }catch(e){if(version===routeVersion){currentId=null;main.innerHTML=`<div class="error" role="alert">${esc(cv(e.message))}<p>${cv('可重新加载；若仍无法打开，请刷新页面重试。')}</p><p><button id="retry">${cv('重试')}</button> <a href="#/contents">${cv('返回目录')}</a></p></div>`;$('#retry').onclick=()=>{if(parts[0]==='topics')resetTopics();route();};}}
}
async function boot(){
  $('.skip').onclick=e=>{e.preventDefault();main.focus();main.scrollIntoView();};
  const config=await json('config.json');root=new URL(config.dataRoot,location.href.split('#')[0]).href;
  runtimePath=config.runtimeRoot||null;anchorsPath=runtimePath+'anchors.json';
  [book,site,zhDisplay]=await Promise.all([config.bookFile?json(config.bookFile):data('book.json'),json('site.json'),json('knowledge/zh-display.json')]);
  if(zhDisplay.source_sha256!==book.source_sha256||!zhDisplay.chars||!zhDisplay.phrases)throw Error('简繁显示资料与当前文本版本不一致');
  adoptZhDisplay(zhDisplay);
  const assigned=site.collections.flatMap(c=>c.chapters);
  if(new Set(assigned).size!==assigned.length||assigned.some(id=>!book.sections.some(s=>s.id===id&&s.kind==='chapter'))||site.featured.some(id=>!assigned.includes(id))||book.sections.filter(s=>s.kind==='chapter').length!==assigned.length)throw Error('目录暂时无法载入');
  const extras=(site.supplements||[]).flatMap(g=>g.sections);
  if(new Set(extras).size!==extras.length||extras.some(id=>!book.sections.some(s=>s.id===id&&s.kind!=='chapter')))throw Error('补充材料暂时无法载入');
  storageKey=`epub-reader:${book.id}:${book.source_sha256}`;
  prefs={theme:'paper',zh:'s',fs:20,mode:'both',showNoteMarkers:true,...safeRead(storageKey+':preferences',{})};
  prefs.noteVisibility=Object.fromEntries(Object.keys(book.note_types).map(type=>[type,prefs.noteVisibility?.[type]??prefs.showNoteMarkers!==false]));
  delete prefs.showNoteMarkers;
  prefs.fs=Math.min(30,Math.max(16,Number(prefs.fs)||20));
  if(prefs.zh==='t')await ensureTraditional().catch(()=>{});
  applyPrefs();
  $('#theme').onclick=()=>{prefs.theme=prefs.theme==='dark'?'paper':'dark';savePrefs();applyPrefs();};
  $('#zh').onclick=async()=>{saveContext();prefs.zh=prefs.zh==='s'?'t':'s';savePrefs();applyPrefs();
    if(prefs.zh==='t')await ensureTraditional().catch(()=>{});
    // Header labels rendered before the converter arrived need one more pass.
    applyPrefs();route();};
  $('#nav-toggle').onclick=()=>{
    const button=$('#nav-toggle');
    if(button.getAttribute('aria-expanded')==='true'){closeMenu(true);return;}
    button.setAttribute('aria-expanded','true');
    const current=$('.nav-group.is-current');if(current)current.open=true;
  };
  document.querySelectorAll('.nav-group').forEach(group=>{
    group.querySelector('summary').addEventListener('click',()=>{
      if(!group.open)document.querySelectorAll('.nav-group').forEach(other=>{if(other!==group)other.open=false;});
    });
  });
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape')return;
    const open=$('.nav-group[open]');
    if(open){e.preventDefault();open.open=false;open.querySelector('summary').focus({preventScroll:true});}
    else if($('#nav-toggle').getAttribute('aria-expanded')==='true'){e.preventDefault();closeMenu(true);}
  });
  document.addEventListener('click',e=>{if(!e.target.closest('.site-head'))closeMenu();});
  document.addEventListener('focusin',e=>{if(!e.target.closest('.site-head'))closeMenu();});
  mobileLayout.addEventListener('change',async()=>{
    if(mobileLayout.matches&&document.activeElement?.closest('#site-nav'))$('#nav-toggle').focus({preventScroll:true});closeMenu();
    saveContext();
    if(main.dataset.page==='home'){
      if(!mobileLayout.matches&&canonicalAtlasHomeHash(location.hash)!==location.hash){await route();return;}
      const anchor=[...main.querySelectorAll('.hero-title,.collection-card,.featured')].find(el=>el.getBoundingClientRect().bottom>120);
      const top=anchor?.getBoundingClientRect().top;
      await syncHomeAtlas(routeVersion,new URLSearchParams(location.hash.split('?')[1]),history.state?.view);
      if(anchor?.isConnected&&top!==undefined)window.scrollBy(0,anchor.getBoundingClientRect().top-top);
      saveContext();
    }else if(mobileLayout.matches&&new URLSearchParams(location.hash.split('?')[1]).get('view')==='atlas')await route();
    else{
      const origin=returnSearch||(/^#\/(people|events)\//.test(location.hash)?returnList:null);
      if(origin)mountSourceReturn(origin,!!returnSearch);
    }
  });
  history.scrollRestoration='manual';
  document.addEventListener('click',e=>{
    const a=e.target.closest('a[href^="#/"]');if(!a||e.defaultPrevented||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
    if(localPosition(a)){e.preventDefault();return;}
    e.preventDefault();
    if(a.getAttribute('aria-current')==='page'&&a.closest('.knowledge-tabs,.yearbook-layout'))return;
    const inNavigation=!!a.closest('#site-nav,.brand'),target=a.getAttribute('href');
    const detail=/^#\/(people|events)\//.test(target);
    let origin=null,list=null;
    if(a.hasAttribute('data-yearbook-layout')){navigate(target,viewSnapshot(),returnSearch,returnList);return;}
    if(a.hasAttribute('data-yearbook-link')){
      navigate(target,{atlasReturn:{hash:location.hash,view:viewSnapshot()}},null,null);return;
    }
    if(a.closest('.yearbook-page')&&target.startsWith('#/events?')&&new URLSearchParams(target.split('?')[1]).get('view')==='atlas'){
      const previous=a.closest('.knowledge-tabs')?$('.yearbook-page').atlasReturn?.view:null;
      navigate(target,{...previous,atlas:{...previous?.atlas,yearbookLayout:new URLSearchParams(location.hash.split('?')[1]).get('layout')}},null,null);return;
    }
    if(!inNavigation){
      const title=$('#main h1')?.textContent||'当前阅读';
      const source=a.closest('.person-detail,.unified-event,.topic-page,.atlas,.result,.chapter-article,.yearbook-item');
      if(main.contains(a)&&a.closest('.directory-list,.supplement-section')&&target.startsWith('#/read/')){
        origin={hash:location.hash,view:viewSnapshot(),label:'返回'+title,parent:returnSearch,returnList};
      }else if(a.closest('.query-view')&&!a.closest('.atlas')&&detail){
        list={hash:location.hash,view:viewSnapshot(),origin:returnSearch,...(a.closest('.people-directory')?{label:'返回'+title}:{})};
      }else if(source&&!a.closest('.knowledge-tabs')&&!(main.dataset.page==='read'&&target.startsWith('#/read/'))){
        const label=source.matches('.atlas')?'返回时代星图':source.matches('.result')?'返回检索结果':'返回'+title;
        origin={hash:location.hash,view:viewSnapshot(),label,parent:returnSearch,returnList};
      }else if(!a.closest('.knowledge-tabs')){origin=returnSearch;list=returnList;}
    }
    if(inNavigation)closeMenu(true);
    navigate(target,null,origin,list);

  });
  // A hash traversal fires both events; one render is enough.
  let scheduled=false;const change=()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;route();});};
  window.addEventListener('popstate',change);
  window.addEventListener('hashchange',()=>{if(renderedHash!==location.hash)change();});
  window.addEventListener('scroll',()=>{clearTimeout(contextTimer);contextTimer=setTimeout(saveContext,100);},{passive:true});
  // Details toggles do not bubble. Save them even when no scrolling occurs.
  main.addEventListener('toggle',saveContext,true);
  main.addEventListener('click',e=>{const summary=e.target.closest('.person-detail summary');if(!summary||e.defaultPrevented)return;e.preventDefault();summary.parentElement.open=!summary.parentElement.open;saveContext();});
  window.addEventListener('pagehide',saveContext);
  await route();
}
boot().catch(e=>{main.innerHTML=`<div class="error" role="alert">${esc(e.message)}。页面暂时无法载入，请稍后重试。<p><button onclick="location.reload()">重试</button></p></div>`;});
