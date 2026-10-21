// The atlas positions reviewed dates. Vertical lanes carry no historical meaning.
export const PERIODS = [
  {id:'all',title:'全景',from:184,to:280},
  {id:'184-199',title:'184—199',from:184,to:199},
  {id:'200-219',title:'200—219',from:200,to:219},
  {id:'220-249',title:'220—249',from:220,to:249},
  {id:'250-280',title:'250—280',from:250,to:280}
];
export function atlasState(bundle, qs) {
  const period=PERIODS.find(p=>p.id===qs.get('period')) || PERIODS[0];
  const category=Object.hasOwn(bundle.categories,qs.get('category'))?qs.get('category'):'';
  const filters=Object.fromEntries(['q','person','year'].filter(k=>qs.get(k)).map(k=>[k,qs.get(k)]));
  const nodes=bundle.nodes.filter(n=>qs.get('period')!=='undated'&&n.year>=period.from&&n.year<=period.to&&(!category||n.categories.includes(category))&&(!bundle.allowedKeys||bundle.allowedKeys.includes(n.key)));
  const key=nodes.find(n=>n.key===qs.get('node'))?.key ||
    nodes.find(n=>n.key===bundle.default)?.key || nodes[0]?.key || '';
  return {period:qs.get('period')==='undated'?'undated':period.id,category,key,nodes,...(Object.keys(filters).length?{filters}:{})};
}
export function atlasHash(state, home=false) {
  const q=new URLSearchParams(home?{}:{view:'atlas'});
  q.set('period',state.period);
  if(state.category)q.set('category',state.category);
  if(state.key)q.set('node',state.key);
  for(const [k,v] of Object.entries(state.filters||{}))q.set(k,v);
  return (home?'#/':'#/events')+'?'+q;
}
export function yearbookHash(state) {
  const q=new URLSearchParams({view:'highlights'});
  if(state.key)q.set('node',state.key);
  for(const key of ['q','person'])if(state.filters?.[key])q.set(key,state.filters[key]);
  return '#/events?'+q;
}
export function layoutNodes(nodes, period, width, measureTitle=s=>s.length*14) {
  const lanes=[],labelLanes=[],points=new Map();
  const labelled=n=>period.id!=='all'||n.label;
  const sizes=new Map(nodes.filter(labelled).map(n=>[n.key,measureTitle(n.title)]));
  width=Math.max(width,Math.max(0,...sizes.values())+72);
  const yearX=year=>36+(year-period.from)/(period.to-period.from)*(width-72);
  // Point packing is independent of titles: 28px targets, separated by 4px.
  // Rows alternate around the middle and encode no historical property.
  for(const node of nodes) {
    const x=yearX(node.year);
    let lane=lanes.findIndex(xs=>xs.every(other=>Math.abs(x-other)>=32));
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
  host.innerHTML=`<header class="atlas-heading"><div><p class="eyebrow">${text('184—280 · 精选大事')}</p>
    <${home?'h2':'h1'}>${text('时代星图')}</${home?'h2':'h1'}><p>${text('循年看事，循事入卷')}</p></div>
    ${home?'<a class="atlas-enter" href="#/events?view=atlas">'+text('完整星图')+' ↗</a>':''}</header>
    <div class="atlas-controls"><div class="atlas-periods" role="group" aria-label="${text('时间范围')}">
    ${PERIODS.map(p=>`<button type="button" data-period="${p.id}">${text(p.title)}</button>`).join('')}</div>
    <label>${text('类别')}<select aria-label="${text('星图类别')}"><option value="">${text('全部类别')}</option>${Object.entries(bundle.categories).map(([id,label])=>`<option value="${id}">${text(label)}</option>`).join('')}</select></label></div>
    <div class="atlas-layout"><div class="atlas-map"><p class="atlas-position" role="status" aria-live="polite"></p>
    <div class="atlas-scroll" aria-label="${text('时间长卷，可横向浏览')}"><div class="atlas-canvas"></div></div>
    <div class="atlas-guidebar"><ul class="atlas-legend" aria-label="${text('图例')}">
    <li><svg viewBox="-20 -20 40 40" aria-hidden="true"><path d="M0,-6 L6,0 L0,6 L-6,0 Z" class="atlas-dot"/></svg>${text('战事')}</li>
    <li><svg viewBox="-20 -20 40 40" aria-hidden="true"><g class="atlas-star" aria-pressed="true"><rect x="-14" y="-14" width="28" height="28" rx="14" class="atlas-hit"/><circle r="4" class="atlas-dot"/></g></svg>${text('当前选中')}</li></ul></div></div>
    <aside class="atlas-card" aria-label="${text('大事点读')}"></aside></div>
    <details class="atlas-list" id="atlas-year-list"><summary>${text('按年浏览')}</summary><div></div></details>`;
  const canvas=host.querySelector('.atlas-canvas'),scroll=host.querySelector('.atlas-scroll');
  const card=host.querySelector('.atlas-card'),status=host.querySelector('[role=status]');
  const list=host.querySelector('.atlas-list>div'),select=host.querySelector('select');
  let disposed=false,frame=0;
  const selected=()=>state.nodes.find(n=>n.key===state.key);
  const updateDataset=()=>{host.dataset.node=state.key;host.dataset.period=state.period;host.dataset.category=state.category;};
  function draw() {
    if(disposed||!host.isConnected)return;
    const focused=canvas.contains(document.activeElement)?document.activeElement.dataset.node:null;
    const period=PERIODS.find(p=>p.id===state.period)||PERIODS[0];
    const available=Math.max(matchMedia('(max-width:760px)').matches?(state.period==='all'?960:640):500,scroll.clientWidth);
    const measure=document.createElement('canvas').getContext('2d');
    measure.font=`13px ${getComputedStyle(host).fontFamily}`;
    const {points,height,width,yearX:x,bandTop}=layoutNodes(state.nodes,period,available,s=>measure.measureText(cv(s)).width);
    const axis=height-44,ticks=[period.from];
    for(let y=Math.ceil((period.from+1)/10)*10;y<period.to;y+=10)ticks.push(y);
    ticks.push(period.to);
    canvas.innerHTML=`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="${text('大事年份星图，左右方向键切换节点')}">
      <line class="atlas-axis" x1="24" y1="${axis}" x2="${width-24}" y2="${axis}"/>
      <text class="atlas-year" x="${width-20}" y="20" text-anchor="end">${text('公元年')}</text>
      ${ticks.map(y=>`<line class="atlas-guide" x1="${x(y)}" y1="32" x2="${x(y)}" y2="${axis+6}"/><text class="atlas-year" x="${x(y)}" y="${axis+28}" text-anchor="middle">${y}</text>`).join('')}
      ${points.filter(p=>p.label).map(p=>`<line class="atlas-leader" x1="${p.x}" y1="${p.labelY+7}" x2="${p.x}" y2="${p.y-10}" aria-hidden="true"/>`).join('')}
      ${points.map(({node:n,x,y,label,labelX,labelY})=>`<g class="atlas-star" role="button" tabindex="${n.key===state.key?0:-1}" data-node="${esc(n.key)}" aria-pressed="${n.key===state.key}" aria-label="${text(n.year+'年 · '+n.title+(n.warfare?' · 战事':''))}" transform="translate(${x},${y})">
      <title>${text(n.year+'年 · '+n.title+(n.warfare?' · 战事':''))}</title><rect x="-14" y="-14" width="28" height="28" rx="14" class="atlas-hit"/>
      ${n.warfare?'<path d="M0,-6 L6,0 L0,6 L-6,0 Z" class="atlas-dot"/>':'<circle r="4" class="atlas-dot"/>'}
      ${label?`<text x="${labelX-x}" y="${labelY-y}" text-anchor="middle" class="atlas-label">${text(n.title)}</text>`:''}</g>`).join('')}
      </svg>`;
    canvas.querySelectorAll('.atlas-star').forEach(point=>{
      point.onclick=()=>pick(point.dataset.node,'point');
      point.onmouseenter=()=>{const n=state.nodes.find(n=>n.key===point.dataset.node);status.textContent=cv(`${n.year} 年 · ${n.title}`);};
      point.onmouseleave=announce;
      point.onkeydown=e=>{
        const i=state.nodes.findIndex(n=>n.key===point.dataset.node);
        let next;
        if(e.key==='ArrowRight'||e.key==='ArrowDown')next=state.nodes[(i+1)%state.nodes.length];
        if(e.key==='ArrowLeft'||e.key==='ArrowUp')next=state.nodes[(i-1+state.nodes.length)%state.nodes.length];
        if(e.key==='Home')next=state.nodes[0];
        if(e.key==='End')next=state.nodes.at(-1);
        if(next){e.preventDefault();pick(next.key,'point');}
        if(e.key==='Enter'||e.key===' '){e.preventDefault();pick(point.dataset.node,'point');}
      };
    });
    if(focused)[...canvas.querySelectorAll('[data-node]')].find(p=>p.dataset.node===focused)?.focus({preventScroll:true});
  }
  function announce() {
    const n=selected();
    status.textContent=cv(n?`${n.year} 年 · ${n.title}`:'此时段暂无符合类别的大事');
  }
  function cardHTML(n) {
    if(!n)return `<p>${text('换一个时段或类别，继续探索。')}</p>`;
    const grouped=n.key.startsWith('group:'),id=n.key.split(':')[1];
    const href=grouped?'#/events?view=highlights&group='+encodeURIComponent(id):'#/events/'+encodeURIComponent(id);
    const years=[...new Set(n.members.filter(m=>m.year).map(m=>m.year))].sort((a,b)=>a-b);
    const other=n.members.some(m=>!m.year);
    const excerpt=s=>`<figure data-book="${esc(s.collection)}"><figcaption>${text(s.section_title+' · '+(s.layer==='original'?'正文':'裴注')+(s.attribution?' · '+s.attribution:''))}</figcaption>
      <blockquote>${text(s.display_quote??s.quote)}</blockquote><a href="#/read/${encodeURIComponent(s.section)}/${encodeURIComponent(s.block)}">${text('阅读全文')} ↗</a></figure>`;
    const people=n.participants.slice(0,5).map(p=>`<a href="#/people/${encodeURIComponent(p.id)}">${text(p.name)}</a>`).join('');
    const related=n.participants.length>1?`<details class="atlas-related reading-more" id="atlas-related-people"><summary>${text('相关人物')}</summary><div class="atlas-people">${people}</div></details>`:people?`<p class="atlas-people">${text('相关人物：')}${people}</p>`:'';
    return `<div class="atlas-card-overview"><p class="atlas-card-year">${n.year}<small>${text('年')}</small></p><h3>${text(n.title)}</h3>
      <p class="atlas-card-time">${text(n.time)}</p>
      ${grouped?`<details class="atlas-member-dates" id="atlas-member-dates"><summary>${text('组内纪年：'+years.join('、')+'年'+(other?'；另有相对时间或年代未详记载':''))}</summary>
      <ul>${n.members.map(m=>`<li><a href="#/events/${encodeURIComponent(m.id)}">${text(m.title)}</a><span>${text(m.time)}</span></li>`).join('')}</ul></details>`:''}
      <p class="atlas-summary">${text(n.summary)}</p>
      <div class="atlas-card-actions">${n.topic?`<a class="atlas-primary" href="#/topics/${encodeURIComponent(n.topic)}">${text('合读赤壁')} →</a>`:''}
      ${!grouped?`<a href="${esc(href)}">${text('史事详情')} →</a>`:''}</div>
      ${home?`<a class="atlas-yearbook" href="${esc(yearbookHash(state))}">${text('在大事年表中查看')} →</a>`:''}
      ${related}</div>
      <div class="atlas-excerpts">${n.sources.map(excerpt).join('')}</div>`;
  }
  function render() {
    updateDataset();
    for(const button of host.querySelectorAll('[data-period]'))button.setAttribute('aria-pressed',String(button.dataset.period===state.period));
    select.value=state.category;card.innerHTML=cardHTML(selected());announce();draw();
    const years=[...new Set(state.nodes.map(n=>n.year))];
    list.innerHTML=years.length?years.map(y=>`<section><h3>${y} ${text('年')}</h3><ul>${state.nodes.filter(n=>n.year===y).map(n=>`<li><button type="button" data-node="${esc(n.key)}" aria-pressed="${n.key===state.key}">${text(n.title)}${n.warfare?` <small>${text('· 战事')}</small>`:''}</button></li>`).join('')}</ul></section>`).join(''):`<p>${text('没有符合条件的大事')}</p>`;
    list.querySelectorAll('button').forEach(b=>b.onclick=()=>pick(b.dataset.node,'list'));
    const enter=host.querySelector('.atlas-enter');if(enter)enter.href=atlasHash(state);
    const yearbook=host.closest('.query-view')?.querySelector('[data-yearbook-link]');
    if(yearbook)yearbook.href=yearbookHash(state);
  }
  function focusNode(kind) {
    if(kind==='list'){
      const heading=card.querySelector('h3');
      if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});card.scrollIntoView({block:'start'});}
      return;
    }
    const elements=kind==='list'?list.querySelectorAll('[data-node]'):canvas.querySelectorAll('[data-node]');
    const target=[...elements].find(e=>e.dataset.node===state.key);
    if(!target)return;
    target.focus({preventScroll:true});
    if(kind==='point'){
      const rect=target.querySelector('.atlas-hit').getBoundingClientRect(),view=scroll.getBoundingClientRect();
      if(rect.left<view.left||rect.right>view.right)scroll.scrollLeft+=rect.left-view.left-scroll.clientWidth/2;
    }
  }
  function change(next,focus) {
    // Save the preceding view before changing DOM, then commit the new route.
    onState(atlasHash(next,home));state=next;render();
    if(focus)focusNode(focus);
    onChange();
  }
  function pick(key,focus) {
    if(key===state.key){focusNode(focus);return;}
    change({...state,key},focus);
  }
  for(const button of host.querySelectorAll('[data-period]'))button.onclick=()=>{
    const q=new URLSearchParams({...state.filters,period:button.dataset.period,category:state.category,node:state.key});
    change(atlasState(bundle,q));scroll.scrollLeft=0;button.focus({preventScroll:true});onChange();
  };
  select.onchange=()=>{
    const q=new URLSearchParams({...state.filters,period:state.period,category:select.value,node:state.key});
    change(atlasState(bundle,q));select.focus({preventScroll:true});
  };
  scroll.addEventListener('scroll',onChange,{passive:true});
  render();
  scroll.scrollLeft=saved?.scrollLeft||0;
  if(!home&&!saved&&qs.get('node')===state.key)focusNode('point');
  const observer=new ResizeObserver(()=>{
    cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);
  });observer.observe(scroll);
  host.atlasDispose=()=>{disposed=true;observer.disconnect();cancelAnimationFrame(frame);};
  return state;
}
