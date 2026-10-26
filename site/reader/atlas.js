// The atlas positions reviewed dates. Vertical lanes carry no historical meaning.
export const PERIODS = [
  {id:'all',title:'全景',from:184,to:280},
  {id:'184-199',title:'184—199',from:184,to:199},
  {id:'200-219',title:'200—219',from:200,to:219},
  {id:'220-249',title:'220—249',from:220,to:249},
  {id:'250-280',title:'250—280',from:250,to:280}
];
// Full filters in legacy homepage links belong to the full atlas, not a hidden filter.
export function canonicalAtlasHomeHash(hash, mobile=false) {
  if(mobile)return hash;
  const [path,query='']=hash.split('?');
  if(!['','#','#/'].includes(path))return hash;
  const qs=new URLSearchParams(query);
  if(!['category','q','person','year'].some(key=>qs.get(key))&&qs.get('period')!=='undated')return hash;
  qs.set('view','atlas');return '#/events?'+qs;
}
export function atlasState(bundle, qs) {
  let period=PERIODS.find(p=>p.id===qs.get('period')) || PERIODS[0];
  const from=Number(qs.get('from')),to=Number(qs.get('to'));
  if(qs.has('from')&&qs.has('to')&&Number.isInteger(from)&&Number.isInteger(to)&&from>=184&&to<=280&&from<=to)
    period=PERIODS.find(p=>p.from===from&&p.to===to)||{id:'custom',from,to};
  const category=Object.hasOwn(bundle.categories,qs.get('category'))?qs.get('category'):'';
  const filters=Object.fromEntries(['q','person','year'].filter(k=>qs.get(k)).map(k=>[k,qs.get(k)]));
  const nodes=bundle.nodes.filter(n=>qs.get('period')!=='undated'&&n.year>=period.from&&n.year<=period.to&&(!category||n.categories.includes(category))&&(!bundle.allowedKeys||bundle.allowedKeys.includes(n.key)));
  const key=nodes.find(n=>n.key===qs.get('node'))?.key ||
    nodes.find(n=>n.key===bundle.default)?.key || nodes[0]?.key || '';
  return {period:qs.get('period')==='undated'?'undated':period.id,range:[period.from,period.to],category,key,nodes,...(Object.keys(filters).length?{filters}:{})};
}
export function zoomRange(range,anchor,factor=1,direction=0){
  const span=Math.max(1,Math.min(97,Math.round((range[1]-range[0]+1)*factor)));
  const center=direction?(range[0]+range[1])/2+direction*Math.max(1,Math.floor(span/2)):anchor;
  const from=Math.max(184,Math.min(281-span,Math.round(center-(span-1)/2)));
  return [from,from+span-1];
}
export function atlasHash(state, home=false) {
  const q=new URLSearchParams(home?{}:{view:'atlas'});
  q.set('period',state.period);
  if(state.period==='custom'){q.delete('period');q.set('from',state.range[0]);q.set('to',state.range[1]);}
  if(state.category)q.set('category',state.category);
  if(state.key)q.set('node',state.key);
  for(const [k,v] of Object.entries(state.filters||{}))q.set(k,v);
  return (home?'#/':'#/events')+'?'+q;
}
export function yearbookHash(state,layout='') {
  const q=new URLSearchParams({view:'highlights'});
  if(layout==='compact')q.set('layout','compact');
  if(state.key)q.set('node',state.key);
  for(const key of ['q','person'])if(state.filters?.[key])q.set(key,state.filters[key]);
  return '#/events?'+q;
}
export function layoutNodes(nodes, period, width, measureTitle=s=>s.length*14) {
  const lanes=[],labelLanes=[],points=new Map();
  const labelled=n=>n.label;
  const sizes=new Map(nodes.filter(labelled).map(n=>[n.key,measureTitle(n.title)]));
  width=Math.max(width,Math.max(0,...sizes.values())+72);
  const yearX=year=>period.from===period.to?width/2:36+(year-period.from)/(period.to-period.from)*(width-72);
  const spacing=32;
  // Rows alternate around the middle and encode no historical property.
  for(const node of nodes) {
    const x=yearX(node.year);
    let lane=lanes.findIndex(xs=>xs.every(other=>Math.abs(x-other)>=spacing));
    if(lane<0){lane=lanes.length;lanes.push([]);}
    lanes[lane].push(x);
    const row=lane===0?0:Math.ceil(lane/2)*(lane%2?-1:1);
    points.set(node.key,{node,x,row,label:labelled(node)});
  }
  for(const node of nodes.filter(labelled)) {
    const p=points.get(node.key),size=sizes.get(node.key);
    const start=Math.max(20,Math.min(p.x-size/2,width-20-size)),end=start+size;
    let lane=labelLanes.findIndex(spans=>spans.every(s=>end+12<=s.start||start>=s.end+12));
    if(lane<0){lane=labelLanes.length;labelLanes.push([]);}
    labelLanes[lane].push({start,end});
    Object.assign(p,{labelX:start+size/2,labelY:48+lane*26,labelWidth:size});
  }
  const bandTop=64+labelLanes.length*26;
  const minRow=Math.min(0,...[...points.values()].map(p=>p.row));
  for(const p of points.values())p.y=bandTop+(p.row-minRow)*32;
  const height=Math.max(220,bandTop+Math.max(0,lanes.length-1)*32+64);
  return {points:nodes.map(n=>points.get(n.key)),height,width,yearX,bandTop};
}

export function mountAtlas(host,bundle,{esc,cv,home=false,qs=new URLSearchParams(),saved=null,onState=()=>{},onChange=()=>{}}) {
  const text=s=>esc(cv(String(s)));
  let state=atlasState(bundle,qs);
  host.className='atlas'+(home?' atlas-home':'');
  host.dataset.atlasHome=String(home);
  host.dataset.yearbookLayout=saved?.yearbookLayout==='compact'?'compact':'';
  const heading=home
    ?`<header class="atlas-heading"><h2><a class="atlas-enter" href="${esc(atlasHash(state))}">${text('时代星图')}</a></h2><p class="eyebrow">184—280</p></header>`
    :`<header class="atlas-heading"><div><p class="eyebrow">${text('184—280 · 精选大事')}</p><h1>${text('时代星图')}</h1></div></header>`;
  const categoryControl=home?'':`<label>${text('类别')}<select aria-label="${text('星图类别')}"><option value="">${text('全部类别')}</option>${Object.entries(bundle.categories).map(([id,label])=>`<option value="${id}">${text(label)}</option>`).join('')}</select></label>`;
  host.innerHTML=`${heading}<div class="atlas-controls"><div class="atlas-periods" role="group" aria-label="${text('时间范围')}">
    ${PERIODS.map(p=>`<button type="button" data-period="${p.id}">${text(p.title)}</button>`).join('')}</div>${categoryControl}</div>
    <div class="atlas-zoom" role="group" aria-label="${text('缩放与移动时间范围')}"><button type="button" data-zoom="in">${text('放大')}</button><button type="button" data-zoom="out">${text('缩小')}</button><button type="button" data-zoom="previous">${text('前移')}</button><button type="button" data-zoom="next">${text('后移')}</button><button type="button" data-zoom="reset">${text('复位')}</button><output class="atlas-range"></output></div>
    <div class="atlas-layout"><div class="atlas-map"><p class="atlas-position${home?' sr-only':''}" role="status" aria-live="polite"></p>
    <div class="atlas-scroll" aria-label="${text('时间长卷，可横向浏览')}"><div class="atlas-canvas"></div></div>
    <div class="atlas-tooltip" role="tooltip" hidden></div>
    <div class="atlas-guidebar"><ul class="atlas-legend" aria-label="${text('图例')}">
    <li><svg viewBox="-20 -20 40 40" aria-hidden="true"><path d="M0,-6 L6,0 L0,6 L-6,0 Z" class="atlas-dot"/></svg>${text('战事')}</li>
    <li><svg viewBox="-20 -20 40 40" aria-hidden="true"><g class="atlas-star" aria-pressed="true"><rect x="-14" y="-14" width="28" height="28" rx="14" class="atlas-hit"/><circle r="4" class="atlas-dot"/></g></svg>${text('当前选中')}</li></ul></div></div>
    <aside class="atlas-card" aria-label="${text('大事点读')}"></aside></div>`;
  const canvas=host.querySelector('.atlas-canvas'),scroll=host.querySelector('.atlas-scroll');
  const card=host.querySelector('.atlas-card'),status=host.querySelector('[role=status]'),tooltip=host.querySelector('.atlas-tooltip');
  const select=host.querySelector('select');
  let disposed=false,frame=0,focusKey=state.key,drawnWidth=0;
  const tooltipId=(host.id||'atlas')+'-tooltip';tooltip.id=tooltipId;
  function hidePreview(){tooltip.hidden=true;canvas.querySelectorAll('[aria-describedby]').forEach(el=>el.removeAttribute('aria-describedby'));}
  function preview(point){
    const n=state.nodes.find(n=>n.key===point.dataset.node);if(!n)return;
    hidePreview();tooltip.textContent=cv(`${n.year} 年 · ${n.title}`);tooltip.hidden=false;
    const hit=point.querySelector('.atlas-hit').getBoundingClientRect(),box=host.getBoundingClientRect();
    tooltip.style.left=Math.max(0,Math.min(host.clientWidth-tooltip.offsetWidth,hit.left-box.left+hit.width/2-tooltip.offsetWidth/2))+'px';
    tooltip.style.top=Math.max(0,hit.top-box.top-tooltip.offsetHeight-8)+'px';
    point.setAttribute('aria-describedby',tooltipId);
  }
  function focusPoint(key){
    focusKey=key;
    for(const point of canvas.querySelectorAll('[data-node]'))point.tabIndex=point.dataset.node===key?0:-1;
    const point=[...canvas.querySelectorAll('[data-node]')].find(p=>p.dataset.node===key);
    point?.focus({preventScroll:true});if(point)preview(point);
  }
  const selected=()=>state.nodes.find(n=>n.key===state.key);
  const updateDataset=()=>{host.dataset.node=state.key;host.dataset.period=state.period;host.dataset.category=state.category;};
  function draw() {
    if(disposed||!host.isConnected)return;
    const focused=canvas.contains(document.activeElement)?document.activeElement.dataset.node:null;
    hidePreview();
    if(!state.nodes.some(n=>n.key===focusKey))focusKey=state.key;
    const period={id:state.period,from:state.range[0],to:state.range[1]};
    const available=Math.max(240,scroll.clientWidth);
    drawnWidth=scroll.clientWidth;
    const measure=document.createElement('canvas').getContext('2d');
    measure.font=`13px ${getComputedStyle(host).getPropertyValue('--sans')}`;
    const {points,height,width,yearX:x}=layoutNodes(state.nodes,period,available,s=>measure.measureText(cv(s)).width);
    const axis=height-44,ticks=[period.from];
    const step=[1,2,5,10,20,25,50,100].find(n=>n>=(period.to-period.from)*48/(width-72));
    for(let y=Math.ceil((period.from+1)/step)*step;y<period.to;y+=step)
      if(x(y)-x(ticks.at(-1))>=42&&x(period.to)-x(y)>=42)ticks.push(y);
    if(period.to!==period.from)ticks.push(period.to);
    canvas.innerHTML=`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="${text('大事年份星图，左右方向键切换节点')}">
      <line class="atlas-axis" x1="24" y1="${axis}" x2="${width-24}" y2="${axis}"/>
      <text class="atlas-year" x="${width-20}" y="20" text-anchor="end">${text('公元年')}</text>
      ${ticks.map(y=>`<line class="atlas-guide" x1="${x(y)}" y1="32" x2="${x(y)}" y2="${axis+6}"/><text class="atlas-year" x="${x(y)}" y="${axis+28}" text-anchor="middle">${y}</text>`).join('')}
      ${points.filter(p=>p.label).map(p=>`<line class="atlas-leader" x1="${p.x}" y1="${p.labelY+7}" x2="${p.x}" y2="${p.y-10}" aria-hidden="true"/>`).join('')}
      ${points.map(({node:n,x,y,label,labelX,labelY})=>`<g class="atlas-star" role="button" tabindex="${n.key===focusKey?0:-1}" data-node="${esc(n.key)}" aria-pressed="${n.key===state.key}" aria-label="${text(n.year+'年 · '+n.title+(n.warfare?' · 战事':''))}" transform="translate(${x},${y})">
      <rect x="-14" y="-14" width="28" height="28" rx="14" class="atlas-hit"/>
      ${n.warfare?'<path d="M0,-6 L6,0 L0,6 L-6,0 Z" class="atlas-dot"/>':'<circle r="4" class="atlas-dot"/>'}
      ${label?`<text x="${labelX-x}" y="${labelY-y}" text-anchor="middle" class="atlas-label">${text(n.title)}</text>`:''}</g>`).join('')}
      </svg>`;
    canvas.querySelectorAll('.atlas-star').forEach(point=>{
      point.onclick=()=>pick(point.dataset.node,'point');
      point.onmouseenter=()=>preview(point);point.onmouseleave=hidePreview;
      point.onfocus=()=>preview(point);point.onblur=hidePreview;
      point.onkeydown=e=>{
        const i=state.nodes.findIndex(n=>n.key===point.dataset.node);
        let next;
        if(e.key==='ArrowRight'||e.key==='ArrowDown')next=state.nodes[(i+1)%state.nodes.length];
        if(e.key==='ArrowLeft'||e.key==='ArrowUp')next=state.nodes[(i-1+state.nodes.length)%state.nodes.length];
        if(e.key==='Home')next=state.nodes[0];
        if(e.key==='End')next=state.nodes.at(-1);
        if(next){e.preventDefault();focusPoint(next.key);}
        if(e.key==='Enter'||e.key===' '){e.preventDefault();pick(point.dataset.node,'point');}
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();hidePreview();}
      };
    });
    if(focused){
      const target=[...canvas.querySelectorAll('.atlas-star')].find(p=>p.dataset.node===focused)
        ||[...canvas.querySelectorAll('[data-node]')].find(p=>p.dataset.node===state.key);
      target?.focus({preventScroll:true});
    }
  }
  function announce() {
    const n=selected();
    status.textContent=cv(n?`${n.year} 年 · ${n.title}`:'此时段暂无符合类别的大事');
  }
  function excerpt(s,selection=false) {
    return `<figure data-book="${esc(s.collection)}"><figcaption>${selection?text('文献选读')+' · ':''}<a href="#/read/${encodeURIComponent(s.section)}/${encodeURIComponent(s.block)}">${text(s.section_title)}</a>${text(' · '+(s.layer==='original'?'正文':'裴注')+(s.attribution?' · '+s.attribution:''))}</figcaption><blockquote>${text(s.display_quote??s.quote)}</blockquote></figure>`;
  }
  function homeCardHTML(n) {
    if(!n)return `<p>${text('此时段暂无大事')}</p>`;
    return `<div class="atlas-card-overview"><p class="atlas-card-year">${n.year}<small>${text('年')}</small></p><h3>${text(n.title)}</h3><p class="atlas-card-time">${text(n.time)}</p></div><div class="atlas-excerpts">${n.sources.length?excerpt(n.sources[0],true):''}</div>`;
  }
  function fullCardHTML(n) {
    if(!n)return `<p>${text('换一个时段或类别，继续探索。')}</p>`;
    const grouped=n.key.startsWith('group:'),id=n.key.split(':')[1];
    const href=grouped?'#/events?view=highlights&group='+encodeURIComponent(id):'#/events/'+encodeURIComponent(id);
    const years=[...new Set(n.members.filter(m=>m.year).map(m=>m.year))].sort((a,b)=>a-b);
    const other=n.members.some(m=>!m.year);
    const people=n.participants.map(p=>`<a href="#/people/${encodeURIComponent(p.id)}">${text(p.name)}</a>`).join('');
    const related=people?`<section class="atlas-related"><h4>${text('相关人物')}</h4><div class="atlas-people">${people}</div></section>`:'';
    return `<div class="atlas-card-overview"><p class="atlas-card-year">${n.year}<small>${text('年')}</small></p><h3>${text(n.title)}</h3>
      <p class="atlas-card-time">${text(n.time)}</p>
      ${grouped?`<details class="atlas-member-dates" id="atlas-member-dates"><summary>${text('组内纪年：'+years.join('、')+'年'+(other?'；另有相对时间或年份未定记载':''))}</summary>
      <ul>${n.members.map(m=>`<li><a href="#/events/${encodeURIComponent(m.id)}">${text(m.title)}</a><span>${text(m.time)}</span></li>`).join('')}</ul></details>`:''}
      <p class="atlas-summary">${text(n.summary)}</p>
      </div><div class="atlas-excerpts">${n.sources.map(s=>excerpt(s)).join('')}</div>
      <div class="atlas-supplement">${related}${!grouped||n.topic?`<div class="atlas-card-actions">${!grouped?`<a href="${esc(href)}">${text('史事详情')}</a>`:''}${n.topic?`<a href="#/topics/${encodeURIComponent(n.topic)}">${text('合读赤壁')}</a>`:''}</div>`:''}</div>`;
  }
  function render() {
    updateDataset();
    for(const button of host.querySelectorAll('[data-period]'))button.setAttribute('aria-pressed',String(button.dataset.period===state.period));
    if(select)select.value=state.category;
    host.querySelector('.atlas-range').textContent=cv(state.range[0]===state.range[1]?state.range[0]+' 年':state.range.join('—')+' 年');
    for(const button of host.querySelectorAll('[data-zoom]')){
      const action=button.dataset.zoom;
      button.disabled=action==='in'?state.range[0]===state.range[1]:action==='previous'?state.range[0]===184:action==='next'?state.range[1]===280:state.range[0]===184&&state.range[1]===280;
    }
    card.innerHTML=home?homeCardHTML(selected()):fullCardHTML(selected());announce();draw();
    const enter=host.querySelector('.atlas-enter');if(enter)enter.href=atlasHash(state);
    const yearbook=host.closest('.query-view')?.querySelector('[data-yearbook-link]');
    if(yearbook)yearbook.href=yearbookHash(state,host.dataset.yearbookLayout);
  }
  function focusNode(kind) {
    const elements=canvas.querySelectorAll('[data-node]');
    const target=[...elements].find(e=>e.dataset.node===state.key);
    if(!target)return;
    focusPoint(state.key);hidePreview();
  }
  function change(next,focus) {
    // Save the preceding view before changing DOM, then commit the new route.
    onState(atlasHash(next,home));state=next;focusKey=state.key;render();
    if(focus)focusNode(focus);
    onChange();
  }
  function pick(key,focus) {
    if(key===state.key){focusNode(focus);return;}
    change({...state,key},focus);
  }
  function setRange(range,key=state.key,focus=false){
    const q=new URLSearchParams({...state.filters,category:state.category,node:key,from:range[0],to:range[1]});
    change(atlasState(bundle,q),focus?'point':null);
  }
  for(const button of host.querySelectorAll('[data-zoom]'))button.onclick=()=>{
    const action=button.dataset.zoom;
    const anchor=selected()?.year??(state.range[0]+state.range[1])/2;
    setRange(action==='reset'?[184,280]:zoomRange(state.range,anchor,action==='in'?.5:action==='out'?2:1,action==='previous'?-1:action==='next'?1:0));
    if(button.disabled)host.querySelector('[data-zoom="'+(action==='in'?'out':action==='previous'?'next':'in')+'"]').focus({preventScroll:true});
    else button.focus({preventScroll:true});
  };
  for(const button of host.querySelectorAll('[data-period]'))button.onclick=()=>{
    const q=new URLSearchParams({...state.filters,period:button.dataset.period,category:state.category,node:state.key});
    change(atlasState(bundle,q));scroll.scrollLeft=0;button.focus({preventScroll:true});onChange();
  };
  if(select)select.onchange=()=>{
    const q=new URLSearchParams({...state.filters,from:state.range[0],to:state.range[1],category:select.value,node:state.key});
    change(atlasState(bundle,q));select.focus({preventScroll:true});
  };
  scroll.addEventListener('scroll',()=>{hidePreview();onChange();},{passive:true});
  render();
  scroll.scrollLeft=saved?.scrollLeft||0;
  if(!home&&saved?.scrollLeft===undefined&&qs.get('node')===state.key)focusNode('point');
  const observer=new ResizeObserver(()=>{
    if(scroll.clientWidth===drawnWidth)return;
    cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);
  });observer.observe(scroll);
  host.atlasDispose=()=>{disposed=true;observer.disconnect();cancelAnimationFrame(frame);};
  return state;
}
