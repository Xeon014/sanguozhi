import {renderKnowledge, legacyKnowledgeHash, canonicalKnowledgeHash} from './knowledge.js';
import {biographyContext} from './profiles.js';
import {topicHome, renderTopic} from './topics.js';
import {mountAtlas, atlasHash} from './atlas.js';
const $ = (q, el = document) => el.querySelector(q);
const main = $('#main');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeRead = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const safeWrite = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let book, site, root, prefs, storageKey, section, blockMap, groupForBlock, routeVersion = 0, currentId = null;
let contextTimer, searchRows, searchNormalized, activeMode = 'both';
let renderedHash = '', ready = false, searchLimit = 40, returnSearch = null, returnList = null;
let topicBundle, topicPresentation, topicRequestOptions;
const topicSections = new Set();
let atlasPresentation;
const normalize = s => simplified(String(s)).normalize('NFKC').toLowerCase();
const cache = new Map();
const simplified = window.OpenCC?.Converter({from:'t',to:'cn'}) || (s => s);
const traditional = window.OpenCC?.Converter({from:'cn',to:'t'}) || (s => s);
const cv = s => prefs?.zh === 't' ? traditional(String(s)) : simplified(String(s));
const label = kind => site.noteLabels?.[kind] || book.note_types[kind]?.label || ({original:'原文',translation:'译文',source:'附录',heading:'标题',unclassified:'附录'})[kind] || kind;
const collection = id => site.collections.find(c=>c.chapters.includes(id));
const chapterName = s => s.title.replace(/第[一二三四五六七八九十百]+$/,'');
const numeral = n => n<10?'〇一二三四五六七八九'[n]:n<20?'十'+(n%10?numeral(n%10):''):numeral(Math.floor(n/10))+'十'+(n%10?numeral(n%10):'');
const chapterCaption = s => {const c=collection(s.id);return c?`${c.label} · 卷${numeral(c.chapters.indexOf(s.id)+1)}`:'';};
const noteClass = kind => Object.keys(book.note_types).indexOf(kind) % 2 === 1 ? 'note-secondary' : 'note-primary';
const url = (id, target = '') => `#/read/${encodeURIComponent(id)}${target ? '/' + encodeURIComponent(target) : ''}`;
const resourceURL = path => root + 'resources/' + path.split('/').map(encodeURIComponent).join('/');
async function json(path, options) { const r = await fetch(path, options); if (!r.ok) throw Error(`读取失败（${r.status}）`); return r.json(); }
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
  $('#theme').textContent = cv(prefs.theme === 'dark' ? '日间' : '夜间');
  $('#brand').textContent = cv(site.title);
  const names = ['首页','全书目录','人物','史事','原文检索','补充材料'];
  document.querySelectorAll('.site-head nav a').forEach((a,i) => a.textContent = cv(names[i]));
  $('#nav-toggle').textContent=cv('菜单');
  $('#footer').textContent = cv(`${site.title} · ${site.credit}`);
}
function tokenHTML(tokens, {backlinks = false, source = false, prefix = ''} = {}) {
  return tokens.map((t, i) => {
    if (t.type === 'text') return esc(cv(t.text));
    if (t.type === 'image') return book.assets.includes(t.path)
      ? `<img src="${esc(resourceURL(t.path))}" alt="${esc(t.alt || '原书图版') }" loading="lazy">`
      : '';
    if (t.type === 'link') {
      const content = tokenHTML(t.children, {source});
      if (t.note_id && !source) {
        const n = section.notes[t.note_id];
        return `<button class="note-ref ${noteClass(n.type)}" id="ref-${esc(prefix)}-${i}" data-note="${esc(n.id)}" aria-controls="${esc(n.id)}" aria-expanded="false" aria-label="${esc(cv(label(n.type)))} ${esc(cv(t.children.map(x=>x.text||'').join('')))}">${content}</button>`;
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
  return `<div class="block kind-${esc(b.kind)} ${book.note_types[b.kind]?'annotation-block':''}" id="${b.id}" tabindex="-1">${tokenHTML(b.tokens, {...options,prefix:b.id})}</div>`;
}
function sectionItems(items) {
  return `<ul class="contents">${items.map(s=>`<li><a href="${url(s.id)}" ${s.id===currentId?'aria-current="page"':''}><span class="chapter-number">${esc(cv(chapterCaption(s)))}</span><span>${esc(cv(chapterName(s)))}</span><span class="entry-arrow" aria-hidden="true">↗</span></a></li>`).join('')}</ul>`;
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
  if(!atlasPresentation)atlasPresentation=json(site.knowledge.atlas).then(p=>{
    if(p.source_sha256!==book.source_sha256||p.schema_version!==1||!p.nodes?.length)throw Error('时间星图与当前文本版本不一致');
    return p;
  }).catch(e=>{atlasPresentation=null;throw e;});
  return atlasPresentation;
}
function atlasCommit(hash) {
  saveContext();
  history.pushState({book:storageKey,hash,returnSearch,returnList},'',hash);
  renderedHash=hash;
}
function showAtlas(host,bundle,qs,saved,home=false) {
  const state=mountAtlas(host,bundle,{esc,cv,qs,home,saved:saved?.atlas,onState:atlasCommit,onChange:saveContext});
  replaceHash(atlasHash(state,home));
}
async function home(version,qs,saved) {
  // Core reading entrances are available while optional visual data is loading.
  main.innerHTML=`<section class="hero"><p class="eyebrow">${esc(cv(site.credit))}</p><h1>${esc(cv(site.title))}</h1><form class="home-search" role="search"><input aria-label="关键词" name="q" type="search"><button aria-label="检索">${cv('检索')} <span aria-hidden="true">→</span></button></form></section>
  ${site.knowledge?.atlas?'<section id="home-atlas" hidden></section>':''}
  <div id="home-topic"></div>
  <section class="collection-grid" aria-label="${cv('分书目录')}">${site.collections.map((c,i)=>`<a class="collection-card collection-${i}" href="#/contents?book=${c.id}"><span class="eyebrow">${cv(`${numeral(c.chapters.length)}卷`)}</span><h2>${esc(cv(c.label))}</h2><p>${esc(cv(c.subtitle))}</p><span class="collection-link">${cv('浏览目录')} <span aria-hidden="true">→</span></span><span class="collection-letter" aria-hidden="true">${esc(cv(c.label[0]))}</span></a>`).join('')}</section>
  <section class="featured"><div class="section-heading"><h2>${cv('篇目选读')}</h2><a href="#/contents">${cv('全书目录')} →</a></div><div class="featured-books">${site.collections.map(c=>`<section><h3>${esc(cv(c.label))}</h3>${sectionItems(site.featured.filter(id=>c.chapters.includes(id)).map(id=>book.sections.find(s=>s.id===id)))}</section>`).join('')}</div></section>`;
  main.insertAdjacentHTML('beforeend',`<nav class="home-queries" aria-label="${cv('资料查询')}"><a href="#/people">${cv('人物')} →</a><a href="#/events">${cv('史事')} →</a></nav>`);
  $('.home-search').onsubmit=e=>{e.preventDefault();navigate('#/search?q='+encodeURIComponent(e.target.q.value.trim()));};
  const [topicResult,atlasResult]=await Promise.allSettled([loadTopicPresentation(),loadAtlas()]);
  if(version!==routeVersion)return;
  const presentation=topicResult.status==='fulfilled'?topicResult.value:null;
  const atlas=atlasResult.status==='fulfilled'?atlasResult.value:null;
  const topic=presentation?.topics.find(t=>t.id===site.topics.featured);
  if(topic)$('#home-topic').outerHTML=topicHome(topic,{evidence:presentation.preview_sources},{esc,cv,collection});
  if(atlas){$('#home-atlas').hidden=false;showAtlas($('#home-atlas'),atlas,qs,saved,true);}
}
function directoryHTML(selected='') {
  return `<div class="directory-controls"><label class="sr-only" for="directory-book">${cv('分书')}</label><select id="directory-book" aria-label="${cv('分书')}"><option value="">${cv('全书')}</option>${site.collections.map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${esc(cv(c.label))}</option>`).join('')}</select><input class="directory-filter" type="search" aria-label="${cv('按卷名筛选')}"></div><p class="directory-status meta" role="status"></p><div class="directory-list">${site.collections.map(c=>`<section class="directory-section" data-collection="${c.id}"><h2>${esc(cv(c.label))}<small>${cv(`${numeral(c.chapters.length)}卷`)}</small></h2>${sectionItems(c.chapters.map(id=>book.sections.find(s=>s.id===id)))}</section>`).join('')}</div>`;
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
  const input=$('.directory-filter',container),select=$('select',container),status=$('.directory-status',container);
  const update=()=>{let count=0;for(const part of container.querySelectorAll('.directory-section')){
    const included=!select.value||part.dataset.collection===select.value;let visible=0;
    for(const li of part.querySelectorAll('li')){li.hidden=!included||!normalize(li.querySelector('a').textContent).includes(normalize(input.value.trim()));if(!li.hidden){count++;visible++;}}
    part.hidden=!visible;
  }status.textContent=count?'':cv('没有匹配的篇目');};
  input.oninput=update;
  select.onchange=()=>{if(routeFilter){const q=new URLSearchParams();if(select.value)q.set('book',select.value);navigate('#/contents'+(q.size?'?'+q:''),{...viewSnapshot(),y:0,anchor:null});}else update();};update();
}
function openDirectory() {
  const dialog=document.createElement('dialog');dialog.className='directory-panel';dialog.setAttribute('aria-labelledby','directory-title');
  dialog.innerHTML=`<div class="panel-head"><h2 id="directory-title">${cv('全书目录')}</h2><button autofocus>${cv('关闭目录')}</button></div>${directoryHTML(collection(currentId)?.id||'')}`;
  document.body.append(dialog);dialog.querySelector('button').onclick=()=>dialog.close();directoryFilter(dialog);
  dialog.addEventListener('close',()=>{dialog.remove();$('#open-directory')?.focus({preventScroll:true});});dialog.showModal();
  dialog.querySelector('[aria-current=page]')?.scrollIntoView({block:'center'});
}
function sidebarHTML() {
  if(!collection(currentId))return `<aside class="chapter-sidebar"><details open id="chapter-navigation"><summary>${cv('补充材料')}</summary>${(site.supplements||[]).map(g=>`<h2 class="supplement-label">${esc(cv(g.title))}</h2>${sectionItems(g.sections.map(id=>book.sections.find(s=>s.id===id)))}`).join('')}<a class="all-contents" href="#/supplements">${cv('全部补充材料')} →</a></details></aside>`;
  return `<aside class="chapter-sidebar"><details open id="chapter-navigation"><summary>${cv('本书目录')}</summary>${site.collections.map(c=>`<details class="sidebar-book" id="sidebar-${c.id}" ${c===collection(currentId)?'open':''}><summary>${esc(cv(c.label))}</summary>${sectionItems(c.chapters.map(id=>book.sections.find(s=>s.id===id)))}</details>`).join('')}<a class="all-contents" href="#/contents">${cv('全书目录')} →</a></details></aside>`;
}
function notesHTML(group) {
  const ids=[...new Set(group.original.flatMap(id=>blockMap.get(id).tokens.filter(t=>t.note_id).map(t=>t.note_id)))];
  return `<div class="note-stacks">${Object.keys(book.note_types).filter(k=>ids.some(id=>section.notes[id].type===k)).map(k=>`<details class="note-stack ${noteClass(k)}" id="notes-${group.id}-${k}"><summary>${esc(cv(label(k)))}</summary>${ids.filter(id=>section.notes[id].type===k).map(id=>{
    const n=section.notes[id],ref=group.original.find(bid=>blockMap.get(bid).tokens.some(t=>t.note_id===id));
    return `<details class="note ${noteClass(n.type)}" id="${n.id}"><summary>${esc(cv(label(n.type)))} ${esc(cv(n.label))}</summary><div class="note-body">${n.blocks.map(b=>blockHTML(b)).join('')}<div class="reading-actions"><a class="return-link" data-return="${esc(ref)}" href="${url(section.id,ref)}">${cv('收起并返回引用')} ↑</a></div></div></details>`;
  }).join('')}</details>`).join('')}</div>`;
}
function setMode(mode) {
  if (!['both','original','translation'].includes(mode)) mode='both';
  activeMode=mode; prefs.mode=mode; savePrefs();
  $('#reading')?.setAttribute('class', 'mode-'+mode);
  applyNoteMarkers();
  document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
}
function applyNoteMarkers() {
  $('#reading')?.classList.toggle('hide-note-markers', !prefs.showNoteMarkers);
  $('#note-markers')?.setAttribute('aria-pressed',String(prefs.showNoteMarkers));
}
// Browser-entry context, never per-chapter persistent progress.
function viewSnapshot() {
  const top=$('.toolbar')?.getBoundingClientRect().bottom || 120;
  const nodes=[...main.querySelectorAll('.reading-group,.source-reading .block,[data-context]')];
  const el=nodes.find(el=>!el.closest('details:not([open])')&&el.getClientRects().length&&el.getBoundingClientRect().bottom>top);
  return {y:window.scrollY,anchor:el?.id,offset:el?.getBoundingClientRect().top,
    topic:$('.topic-page')?{mode:$('.topic-page').dataset.topicMode,a:$('.topic-page').dataset.topicA,b:$('.topic-page').dataset.topicB}:null,
    atlas:$('.atlas')?{scrollLeft:$('.atlas-scroll').scrollLeft}:null,
    lifeLimits:Object.fromEntries([...main.querySelectorAll('[data-life-list]')].map(e=>[e.dataset.lifeList,Number(e.dataset.limit)||20])),
    knowledgeLimit:Number($('.knowledge-page')?.dataset.limit)||0,
    open:[...main.querySelectorAll('details[open]')].map(el=>el.id || el.closest('.reading-group')?.id).filter(Boolean),
    returns:[...main.querySelectorAll('.note[data-return-id]')].map(el=>[el.id,el.dataset.returnId]),
    closed:[...main.querySelectorAll('.chapter-sidebar details:not([open])')].map(el=>el.id),searchLimit,filter:$('.directory-filter',main)?.value || ''};
}
function restoreView(saved) {
  if(!saved)return;
  for(const id of saved.closed||[]){const el=document.getElementById(id);if(el)el.open=false;}
  for(const id of saved.open||[]){const el=document.getElementById(id);if(el?.matches('details'))el.open=true;
    else if(el?.matches('.reading-group')&&el.querySelector('.note-stack'))el.querySelector('.note-stack').open=true;}
  for(const [id,ref] of saved.returns||[]){const el=document.getElementById(id);if(el)el.dataset.returnId=ref;}
  const filter=$('.directory-filter',main);if(filter){filter.value=saved.filter||'';filter.dispatchEvent(new Event('input'));}
  const anchor=saved.anchor && document.getElementById(saved.anchor);
  if(anchor?.getClientRects().length && saved.y>0)window.scrollBy(0,anchor.getBoundingClientRect().top-saved.offset);
  else window.scrollTo(0,saved.y||0);
  if(saved.filterFocus)document.getElementById(saved.filterFocus)?.focus({preventScroll:true});
}
function saveContext() {
  if(!ready || renderedHash!==location.hash)return;
  history.replaceState({...history.state,book:storageKey,hash:renderedHash,view:viewSnapshot(),returnSearch,returnList},'');
}
function navigate(hash, saved=null, origin=null, list=null) {
  saveContext();document.querySelector('.directory-panel')?.close();
  history.pushState({book:storageKey,hash,view:saved,returnSearch:origin,returnList:list},'',hash);
  route();
}
function focusTarget(id) {
  let el=document.getElementById(id);
  if (!el || !main.contains(el)) return false;
  if (section.status==='aligned' && el.closest('.original,.note-stack') && activeMode==='translation') setMode('both');
  if (section.status==='aligned' && el.closest('.translation') && activeMode==='original') setMode('both');
  let parent=el.parentElement;
  while(parent && parent!==main){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}
  el.scrollIntoView({block:'start'}); el.focus({preventScroll:true}); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  return true;
}
async function readSection(id,target,version) {
  const info=book.sections.find(x=>x.id===id);
  if(!info)throw Error('目录中没有这一章节');
  const loaded=await data(`sections/${id}.json`);
  if(version!==routeVersion)return;
  section=loaded;currentId=id;blockMap=new Map(section.blocks.map(b=>[b.id,b]));groupForBlock=new Map();
  for(const g of section.groups)for(const bid of [...g.original,...g.translation])groupForBlock.set(bid,g.id);
  const aligned=section.status==='aligned';
  const toolbar=`<div class="toolbar" aria-label="浏览工具"><button id="open-directory">${cv('目录')}</button>${info.kind==='chapter'?`<a class="search-volume" href="#/search?section=${encodeURIComponent(id)}">${cv('检索本卷')}</a>`:''}${aligned?['both','original','translation'].map((m,i)=>`<button data-mode="${m}" aria-pressed="${prefs.mode===m}">${cv(['对照','原文','译文'][i])}</button>`).join(''):''}<label><span class="sr-only">${cv('定位正文')}</span><select id="jump" aria-label="${cv('定位正文')}"><option value="">${cv('定位正文')}</option>${(aligned?section.groups:section.blocks.filter(b=>b.kind==='heading'||b.kind==='original'||b.tokens.some(t=>t.type==='image'))).map((g,i)=>`<option value="${g.id}">${esc(cv(aligned?blockMap.get(g.original[0]).text.slice(0,18):g.text.slice(0,18)||'原书图版'))}</option>`).join('')}</select></label>${aligned?`<button id="note-markers" aria-pressed="${prefs.showNoteMarkers}">${cv('显示注标')}</button>`:''}<div class="tools-end"><button id="smaller" aria-label="减小字号">A−</button><button id="larger" aria-label="增大字号">A＋</button></div></div>`;
  const body=aligned?section.groups.map(g=>`<section class="reading-group" id="${g.id}" tabindex="-1"><a class="passage-link" href="${url(id,g.id)}" aria-label="${cv('此处链接')}" title="${cv('此处链接')}">⌁</a><div class="parallel"><div class="column original">${g.original.map(b=>blockHTML(b)).join('')}</div><div class="column translation">${g.translation.map(b=>blockHTML(b)).join('')}</div></div>${notesHTML(g)}</section>`).join(''):`<div class="source-reading">${section.blocks.map(b=>blockHTML(b.id,{source:true,backlinks:true})).join('')}</div>`;
  const peers=info.kind==='chapter'?book.sections.filter(s=>s.kind==='chapter'):(site.supplements||[]).flatMap(g=>g.sections).map(sid=>book.sections.find(s=>s.id===sid));
  const idx=peers.findIndex(s=>s.id===id),prev=idx>=0?peers[idx-1]:null,next=idx>=0?peers[idx+1]:null,col=collection(id);
  main.innerHTML=`<div class="chapter-layout">${sidebarHTML()}<article class="chapter-article"><header class="chapter-heading"><p class="crumb"><a href="${info.kind==='chapter'?'#/contents':'#/supplements'}">${cv(info.kind==='chapter'?'全书目录':'补充材料')}</a>${col?` / <a href="#/contents?book=${col.id}">${esc(cv(col.label))}</a>`:''}</p><p class="eyebrow">${esc(cv(chapterCaption(info)))}</p><h1>${esc(cv(section.title))}</h1></header>${toolbar}<div id="reading">${body}</div><nav class="pager" aria-label="${cv('相邻篇目')}">${prev?`<a href="${url(prev.id)}">← ${esc(cv(prev.title))}</a>`:'<span></span>'}${next?`<a href="${url(next.id)}">${esc(cv(next.title))} →</a>`:''}</nav></article></div>`;
  if(aligned)setMode(prefs.mode);else activeMode='source';
  $('#open-directory').onclick=openDirectory;
  if($('#note-markers'))$('#note-markers').onclick=()=>{const saved=viewSnapshot();prefs.showNoteMarkers=!prefs.showNoteMarkers;savePrefs();applyNoteMarkers();restoreView(saved);saveContext();};
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{const saved=viewSnapshot();setMode(b.dataset.mode);restoreView(saved);saveContext();});
  $('#jump').onchange=e=>{if(e.target.value)navigate(url(id,e.target.value));};
  $('#smaller').onclick=()=>resize(-1);$('#larger').onclick=()=>resize(1);
  document.querySelectorAll('[data-note]').forEach(b=>b.onclick=()=>{
    const note=document.getElementById(b.dataset.note);
    if(note.open){note.open=false;b.setAttribute('aria-expanded','false');b.focus({preventScroll:true});saveContext();return;}
    note.parentElement.open=true;note.open=true;
    b.setAttribute('aria-expanded','true');note.dataset.returnId=b.id;
    note.scrollIntoView({block:'nearest'});note.querySelector('summary').focus({preventScroll:true});saveContext();
  });
  document.querySelectorAll('.note').forEach(n=>n.addEventListener('toggle',()=>document.querySelectorAll(`[data-note="${n.id}"]`).forEach(b=>b.setAttribute('aria-expanded',String(n.open)))));
  document.querySelectorAll('[data-return]').forEach(a=>a.onclick=e=>{e.preventDefault();const n=a.closest('.note');const ref=document.getElementById(n.dataset.returnId);const dest=ref?.getClientRects().length?ref:(ref?.closest('.block')||document.getElementById(a.dataset.return));n.open=false;dest?.scrollIntoView({block:'center'});dest?.focus({preventScroll:true});saveContext();});
  if(target){if(!focusTarget(target))main.insertAdjacentHTML('afterbegin',`<p role="status">${cv('未找到指定段落，已显示本章。')}</p>`);}
  else window.scrollTo(0,0);
  if(returnSearch){const back=document.createElement('a');back.className='back-search';back.href=returnSearch.hash;
    back.textContent=cv(returnSearch.label||'← 返回检索结果');back.onclick=e=>{if(e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();e.stopPropagation();navigate(returnSearch.hash,returnSearch.view,returnSearch.parent||null,returnSearch.returnList||null);};$('.chapter-article').prepend(back);}
}
function resize(delta){const saved=viewSnapshot();prefs.showNoteMarkers=prefs.showNoteMarkers!==false;
  prefs.fs=Math.min(30,Math.max(16,prefs.fs+delta));savePrefs();applyPrefs();restoreView(saved);saveContext();}
async function search(qs,version){
  const q=qs.get('q')||'';
  const scope=book.sections.some(s=>s.kind==='chapter'&&s.id===qs.get('section'))?qs.get('section'):'';
  if(qs.has('kind')||(qs.has('section')&&!scope)){qs.delete('kind');if(!scope)qs.delete('section');const hash='#/search'+(qs.size?'?'+qs:'');history.replaceState({...history.state,hash},'',hash);}
  main.innerHTML=`<p class="eyebrow">${esc(cv(site.title))}</p><h1>${cv('检索全书')}</h1><form class="search-form"><input id="query" aria-label="关键词" value="${esc(q)}"><select id="scope" aria-label="检索范围"><option value="">${cv('全书')}</option>${book.sections.filter(s=>s.kind==='chapter').map(s=>`<option value="${s.id}" ${scope===s.id?'selected':''}>${esc(cv(s.title))}</option>`).join('')}</select><button>${cv('检索')}</button></form><div id="results" aria-live="polite"></div>`;
  $('.search-form').onsubmit=e=>{e.preventDefault();navigate(`#/search?q=${encodeURIComponent($('#query').value.trim())}${$('#scope').value?'&section='+encodeURIComponent($('#scope').value):''}`);};
  $('.search-form').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.isComposing)e.preventDefault();});
  if(!q.trim())return;
  const out=$('#results');out.textContent=cv('正在检索……');
  if(!searchRows)searchRows=await data('search.json');
  if(version!==routeVersion)return;
  if(!searchNormalized)searchNormalized=searchRows.map(r=>simplified(r.text).normalize('NFKC').toLowerCase());
  const needle=simplified(q).normalize('NFKC').toLowerCase();
  const hits=searchRows.map((r,i)=>({...r,at:searchNormalized[i].indexOf(needle)})).filter(r=>r.at>=0 && r.kind==='original'&&book.sections.some(s=>s.id===r.section&&s.kind==='chapter')&&(!scope||r.section===scope));
  let shown=0;
  out.innerHTML=`<p>${cv('命中')} ${hits.length} ${cv('段')}</p>${hits.length?'':`<p class="query-empty">${cv(scope?'未命中，可尝试其他用词，或将检索范围扩大至全书。':'未命中，可尝试其他用词。')}</p>`}<div id="hit-list"></div>`;
  const list=$('#hit-list');
  const add=()=>{
    $('#more')?.remove();
    for(const h of hits.slice(shown,shown+40)){
      const sectionInfo=book.sections.find(s=>s.id===h.section);
      const normalizedDisplay=simplified(h.text);const pos=normalizedDisplay.indexOf(simplified(q));
      const start=Math.max(0,(pos>=0?pos:h.at)-28),snippet=normalizedDisplay.slice(start,start+150);
      const matchAt=snippet.indexOf(simplified(q));
      const snippetHTML=matchAt<0?esc(cv(snippet)):esc(cv(snippet.slice(0,matchAt)))+'<mark>'+esc(cv(snippet.slice(matchAt,matchAt+simplified(q).length)))+'</mark>'+esc(cv(snippet.slice(matchAt+simplified(q).length)));
      list.insertAdjacentHTML('beforeend',`<article class="result"><div class="result-meta">${esc(cv(collection(h.section)?.label||''))}</div><a href="${url(h.section,h.block)}">${esc(cv(sectionInfo.title))}</a><p>${start?'…':''}${snippetHTML}${start+150<h.text.length?'…':''}</p></article>`);
    }
    shown+=40;searchLimit=shown;
    if(shown<hits.length){const more=document.createElement('button');more.id='more';more.textContent=cv('加载更多');more.onclick=add;out.append(more);}
  };const wanted=history.state?.view?.searchLimit||40;add();while(shown<Math.min(wanted,hits.length))add();
}
function replaceHash(hash) {
  if(hash===location.hash)return;
  const state=history.state?.hash===location.hash?history.state:{};
  history.replaceState({...state,hash},'',hash);
}
function closeMenu(restoreFocus=false) {
  const button=$('#nav-toggle');
  if(button.getAttribute('aria-expanded')!=='true')return;
  button.setAttribute('aria-expanded','false');
  if(restoreFocus&&button.getClientRects().length)button.focus({preventScroll:true});
}
function updateNavigation(parts) {
  const current=parts[0]==='read'?(section?.kind==='chapter'?'contents':'supplements'):(parts[0]==='timeline'?'events':parts[0]||'');
  document.querySelectorAll('#site-nav a').forEach(a=>{
    if(a.hash==='#/'+current)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  });
}
async function route(){
  replaceHash(legacyKnowledgeHash(location.hash));
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
  $('.atlas')?.atlasDispose?.();
  main.innerHTML=`<p role="status">${cv('正在载入……')}</p>`;
  try{
    if(parts[0]==='read')await readSection(parts[1],parts[2],version);
    else if(parts[0]==='contents')contents(qs);
    else if(parts[0]==='supplements')supplements();
    else if(parts[0]==='search')await search(qs,version);
    else if(parts[0]==='events'&&parts.length===1&&qs.get('view')==='atlas'){
      const atlas=await loadAtlas();if(version!==routeVersion)return;
      if(!atlas)throw Error('时间星图暂时不可用');
      main.innerHTML=`<div class="knowledge-page query-view atlas-explore"><nav class="knowledge-tabs" aria-label="${cv('史事视图')}"><a href="#/events?view=atlas" aria-current="page">${cv('时间星图')}</a><a href="#/events?view=highlights">${cv('大事概览')}</a><a href="#/events">${cv('全部记载')}</a></nav><section id="full-atlas"></section></div>`;
      showAtlas($('#full-atlas'),atlas,qs,saved);knowledgeTitle='时间星图';
    }
    else if(['people','events','timeline'].includes(parts[0])){
      if(!site.knowledge)throw Error('查询资料暂时不可用');
      const content=await json(site.knowledge.file);if(version!==routeVersion)return;
      if(content.source_sha256!==book.source_sha256)throw Error('查询资料与当前文本版本不一致，暂不可查看');
      const presentation=site.knowledge.profiles?await json(site.knowledge.profiles):null;if(version!==routeVersion)return;
      if(presentation&&(presentation.source_sha256!==content.source_sha256||Object.entries(presentation.section_sha256).some(([id,sha])=>content.section_sha256[id]!==sha)))throw Error('人物资料与当前文本版本不一致');
      const profiles=presentation?.profiles||{};
      let editorial=null;
      if(parts[0]==='events'&&site.knowledge.editorial){
        try{
          editorial=await json(site.knowledge.editorial);if(version!==routeVersion)return;
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
      knowledgeTitle=renderKnowledge(content,{main,parts,qs:cleanQS,esc,cv,normalize,url,navigate:(hash,filterFocus)=>navigate(hash,filterFocus?{y:window.scrollY,filterFocus}:null,returnSearch?.atlas?returnSearch:null,returnList),saved,profiles,editorial,atlasEnabled:!!site.knowledge.atlas,sections,visiblePeople:site.knowledge.people??null,legacySources:parts[0]==='events'&&qs.get('view')==='sources',onChange:saveContext});
      if(parts[0]==='events'&&parts[1]&&editorial?.records[parts[1]]){
        const record=editorial.records[parts[1]],group=editorial.groups.find(g=>g.id===record.primary_group);
        const metadata=document.createElement('div');metadata.className='event-classification';
        metadata.innerHTML=[editorial.taxonomy.record_kind[record.record_kind],editorial.taxonomy.importance[record.importance],...record.categories.map(c=>editorial.taxonomy.categories[c])].map(label=>`<span>${esc(cv(label))}</span>`).join('')+
          (group?`<a href="#/events?view=highlights&group=${encodeURIComponent(group.id)}">${esc(cv('所属大事：'+group.title))} →</a>`:'');
        $('.knowledge-heading',main)?.append(metadata);
      }
      if(parts[0]==='events'&&parts[1]&&returnList){
        const back=document.createElement('a');back.className='knowledge-back';back.href=returnList.hash;back.textContent=cv('← 返回查询结果');
        back.onclick=e=>{e.preventDefault();navigate(returnList.hash,returnList.view,returnSearch?.atlas?returnSearch:null);};$('.knowledge-page').prepend(back);
      }
    }
    else if(parts[0]==='topics'){
      const bundle=await loadTopics();if(version!==routeVersion)return;
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
    if((parts[0]!=='topics'&&returnSearch?.topic)||returnSearch?.atlas){
      const back=document.createElement('a');back.className='back-search';back.href=returnSearch.hash;back.textContent=cv(returnSearch.label);
      back.onclick=e=>{if(e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();e.stopPropagation();navigate(returnSearch.hash,returnSearch.view);};
      if(parts[0]!=='read')main.prepend(back);
    }
    if(parts[0]!=='read')window.scrollTo(0,0);
    restoreView(saved);
    if(!saved||saved.y===undefined){const target=main.querySelector('[data-source-target]');if(target){target.scrollIntoView({block:'start'});target.focus({preventScroll:true});}}
    updateNavigation(parts);renderedHash=location.hash;ready=true;saveContext();
    document.title=cv(`${parts[0]==='read'?section.title+' · ':knowledgeTitle?knowledgeTitle+' · ':''}${site.title}`);
  }catch(e){if(version===routeVersion){currentId=null;main.innerHTML=`<div class="error" role="alert">${esc(cv(e.message))}<p>${cv('可重新加载；若仍无法打开，请刷新页面重试。')}</p><p><button id="retry">${cv('重试')}</button> <a href="#/contents">${cv('返回目录')}</a></p></div>`;$('#retry').onclick=()=>{if(parts[0]==='topics')resetTopics();route();};}}
}
async function boot(){
  $('.skip').onclick=e=>{e.preventDefault();main.focus();main.scrollIntoView();};
  const config=await json('config.json');root=new URL(config.dataRoot,location.href.split('#')[0]).href;
  [book,site]=await Promise.all([data('book.json'),json('site.json')]);
  const assigned=site.collections.flatMap(c=>c.chapters);
  if(new Set(assigned).size!==assigned.length||assigned.some(id=>!book.sections.some(s=>s.id===id&&s.kind==='chapter'))||site.featured.some(id=>!assigned.includes(id))||book.sections.filter(s=>s.kind==='chapter').length!==assigned.length)throw Error('目录暂时无法载入');
  const extras=(site.supplements||[]).flatMap(g=>g.sections);
  if(new Set(extras).size!==extras.length||extras.some(id=>!book.sections.some(s=>s.id===id&&s.kind!=='chapter')))throw Error('补充材料暂时无法载入');
  storageKey=`epub-reader:${book.id}:${book.source_sha256}`;
  prefs={theme:'paper',zh:'s',fs:20,mode:'both',showNoteMarkers:true,...safeRead(storageKey+':preferences',{})};
  prefs.showNoteMarkers=prefs.showNoteMarkers!==false;
  prefs.fs=Math.min(30,Math.max(16,Number(prefs.fs)||20));applyPrefs();
  $('#theme').onclick=()=>{prefs.theme=prefs.theme==='dark'?'paper':'dark';savePrefs();applyPrefs();};
  $('#zh').onclick=()=>{saveContext();prefs.zh=prefs.zh==='s'?'t':'s';savePrefs();applyPrefs();route();};
  $('#nav-toggle').onclick=()=>{const button=$('#nav-toggle');button.setAttribute('aria-expanded',String(button.getAttribute('aria-expanded')!=='true'));};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#nav-toggle').getAttribute('aria-expanded')==='true'){e.preventDefault();closeMenu(true);}});
  const mobile=matchMedia('(max-width:760px)');
  mobile.addEventListener('change',()=>{if(mobile.matches&&document.activeElement?.closest('#site-nav'))$('#nav-toggle').focus({preventScroll:true});closeMenu();});
  history.scrollRestoration='manual';
  document.addEventListener('click',e=>{
    const a=e.target.closest('a[href^="#/"]');if(!a||e.defaultPrevented||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
    e.preventDefault();const origin=a.closest('.atlas')&&!a.matches('.atlas-enter')?{hash:location.hash,view:viewSnapshot(),label:'← 返回时间星图',atlas:true}:a.closest('.topic-page')&&!a.hash.startsWith('#/topics/')?{hash:location.hash,view:viewSnapshot(),label:'← 返回赤壁专题',topic:true}:a.closest('.result')?{hash:location.hash,view:viewSnapshot()}:a.matches('.evidence-link')?{hash:location.hash,view:viewSnapshot(),label:'← 返回人物与史事',returnList,parent:returnSearch}:returnSearch?.atlas&&!a.closest('#site-nav')?returnSearch:null;
    const list=a.closest('.atlas')?null:a.closest('.query-view')&&/^#\/(people|events)\//.test(a.hash)?{hash:location.hash,view:viewSnapshot()}:returnList;
    if(a.closest('#site-nav'))closeMenu(true);
    const topicState=a.closest('.topic-page')&&a.hash.startsWith('#/topics/')?{...viewSnapshot(),y:undefined,anchor:null}:null;
    navigate(a.getAttribute('href'),topicState,origin,/^#\/(people|events)\//.test(a.hash)?list:null);
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
