// The atlas positions reviewed dates. Vertical lanes carry no historical meaning.
export const PERIODS = [
  {id:'all',title:'百年全景',from:184,to:280},
  {id:'184-199',title:'184—199',from:184,to:199},
  {id:'200-219',title:'200—219',from:200,to:219},
  {id:'220-249',title:'220—249',from:220,to:249},
  {id:'250-280',title:'250—280',from:250,to:280}
];
export function atlasState(bundle, qs, mobile=false) {
  const period=PERIODS.find(p=>p.id===qs.get('period')) ||
    PERIODS[qs.has('period')?0:mobile?2:0];
  const category=Object.hasOwn(bundle.categories,qs.get('category'))?qs.get('category'):'';
  const nodes=bundle.nodes.filter(n=>n.year>=period.from&&n.year<=period.to&&(!category||n.categories.includes(category)));
  const key=nodes.find(n=>n.key===qs.get('node'))?.key ||
    nodes.find(n=>n.key===bundle.default)?.key || nodes[0]?.key || '';
  return {period:period.id,category,key,nodes};
}
export function atlasHash(state, home=false) {
  const q=new URLSearchParams(home?{}:{view:'atlas'});
  q.set('period',state.period);
  if(state.category)q.set('category',state.category);
  if(state.key)q.set('node',state.key);
  return (home?'#/':'#/events')+'?'+q;
}
export function layoutNodes(nodes, period, width) {
  const lanes=[],points=new Map();
  // Keep the twelve named landmarks legible; all lanes only resolve collisions.
  for(const node of [...nodes.filter(n=>n.label),...nodes.filter(n=>!n.label)]) {
    const x=36+(node.year-period.from)/(period.to-period.from)*(width-176);
    const reach=node.label?Math.max(50,26+node.title.length*14):26;
    const start=x-23,end=x+reach;
    let lane=lanes.findIndex(spans=>spans.every(s=>end+10<=s.start||start>=s.end+10));
    if(lane<0){lane=lanes.length;lanes.push([]);}
    lanes[lane].push({start,end});
    points.set(node.key,{node,x,y:64+lane*52});
  }
  return {points:nodes.map(n=>points.get(n.key)),height:Math.max(240,lanes.length*52+108)};
}

export function mountAtlas(host,bundle,{esc,cv,home=false,qs=new URLSearchParams(),saved=null,onState=()=>{},onChange=()=>{}}) {
  const text=s=>esc(cv(String(s))),mobile=matchMedia('(max-width:760px)').matches;
  let state=atlasState(bundle,qs,mobile);
  host.className='atlas'+(home?' atlas-home':'');
  host.dataset.atlasHome=String(home);
  host.innerHTML=`<header class="atlas-heading"><div><p class="eyebrow">${text('184—280 · 精选大事')}</p>
    <${home?'h2':'h1'}>${text(home?'百年大事':'时间星图')}</${home?'h2':'h1'}><p>${text('循年看事，循事入卷')}</p></div>
    ${home?'<a class="atlas-enter" href="#/events?view=atlas">'+text('展开时间星图')+' ↗</a>':''}</header>
    <div class="atlas-controls"><div class="atlas-periods" role="group" aria-label="${text('时间范围')}">
    ${PERIODS.map(p=>`<button type="button" data-period="${p.id}">${text(p.title)}</button>`).join('')}</div>
    <label>${text('类别')}<select aria-label="${text('星图类别')}"><option value="">${text('全部类别')}</option>${Object.entries(bundle.categories).map(([id,label])=>`<option value="${id}">${text(label)}</option>`).join('')}</select></label></div>
    <div class="atlas-layout"><div class="atlas-map"><p class="atlas-position" role="status" aria-live="polite"></p>
    <div class="atlas-scroll" aria-label="${text('时间长卷，可横向浏览')}"><div class="atlas-canvas"></div></div>
    <p class="atlas-caption">${text('横轴为年份，上下错开仅为排布；双环为大事组，按锚点年份定位。')}</p></div>
    <aside class="atlas-card" aria-label="${text('大事点读')}"></aside></div>
    <details class="atlas-list" id="atlas-year-list"><summary>${text('按年浏览')} <span></span></summary><div></div></details>`;
  const canvas=host.querySelector('.atlas-canvas'),scroll=host.querySelector('.atlas-scroll');
  const card=host.querySelector('.atlas-card'),status=host.querySelector('[role=status]');
  const list=host.querySelector('.atlas-list>div'),select=host.querySelector('select');
  let disposed=false,frame=0;
  const selected=()=>state.nodes.find(n=>n.key===state.key);
  const updateDataset=()=>{host.dataset.node=state.key;host.dataset.period=state.period;host.dataset.category=state.category;};
  function draw() {
    if(disposed||!host.isConnected)return;
    const focused=canvas.contains(document.activeElement)?document.activeElement.dataset.node:null;
    const period=PERIODS.find(p=>p.id===state.period);
    const width=Math.max(matchMedia('(max-width:760px)').matches?(state.period==='all'?960:640):500,scroll.clientWidth);
    const {points,height}=layoutNodes(state.nodes,period,width);
    const axis=height-44,ticks=[period.from];
    for(let y=Math.ceil((period.from+1)/10)*10;y<period.to;y+=10)ticks.push(y);
    ticks.push(period.to);
    const x=y=>36+(y-period.from)/(period.to-period.from)*(width-176);
    canvas.innerHTML=`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="${text('大事年份星图，左右方向键切换节点')}">
      <line class="atlas-axis" x1="24" y1="${axis}" x2="${width-24}" y2="${axis}"/>
      ${ticks.map(y=>`<line class="atlas-guide" x1="${x(y)}" y1="32" x2="${x(y)}" y2="${axis+6}"/><text class="atlas-year" x="${x(y)}" y="20" text-anchor="middle">${y}</text><text class="atlas-year" x="${x(y)}" y="${axis+28}" text-anchor="middle" aria-hidden="true">${y}</text>`).join('')}
      ${points.map(({node:n,x,y})=>`<g class="atlas-star" role="button" tabindex="${n.key===state.key?0:-1}" data-node="${esc(n.key)}" aria-pressed="${n.key===state.key}" aria-label="${text(n.year+'年 · '+n.title)}" transform="translate(${x},${y})">
      <title>${text(n.year+'年 · '+n.title)}</title><rect x="-23" y="-23" width="46" height="46" rx="23" class="atlas-hit"/>
      ${n.key.startsWith('group:')?'<circle r="9" class="atlas-ring"/>':''}<circle r="4" class="atlas-dot"/>
      ${n.label?`<text x="15" y="5" class="atlas-label">${text(n.title)}</text>`:''}</g>`).join('')}
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
    status.textContent=cv(n?`${n.year} 年 · ${n.title} · 本段 ${state.nodes.length} 项`:'此时段暂无符合类别的大事');
  }
  function cardHTML(n) {
    if(!n)return `<p>${text('换一个时段或类别，继续探索。')}</p>`;
    const grouped=n.key.startsWith('group:'),id=n.key.split(':')[1];
    const href=grouped?'#/events?view=highlights&group='+encodeURIComponent(id):'#/events/'+encodeURIComponent(id);
    const years=[...new Set(n.members.filter(m=>m.year).map(m=>m.year))].sort((a,b)=>a-b);
    const other=n.members.some(m=>!m.year);
    const excerpt=s=>`<figure data-book="${esc(s.collection)}"><figcaption>${text(s.section_title+' · '+(s.layer==='original'?'正文':'裴注')+(s.attribution?' · '+s.attribution:''))}</figcaption>
      <blockquote>${text(s.quote)}</blockquote><a href="#/read/${encodeURIComponent(s.section)}/${encodeURIComponent(s.block)}">${text('阅读全文')} ↗</a></figure>`;
    return `<p class="atlas-card-year">${n.year}<small>${text('年')}</small></p><h3>${text(n.title)}</h3>
      <p class="atlas-card-time">${text(n.time)}</p>
      ${grouped?`<details class="atlas-member-dates" id="atlas-member-dates"><summary>${text('组内纪年：'+years.join('、')+'年'+(other?'；另有相对时间或年代未详记载':''))}</summary>
      <ul>${n.members.map(m=>`<li><a href="#/events/${encodeURIComponent(m.id)}">${text(m.title)}</a><span>${text(m.time)}</span></li>`).join('')}</ul></details>`:''}
      <p class="atlas-summary">${text(n.summary)}</p>
      <div class="atlas-card-actions">${n.topic?`<a class="atlas-primary" href="#/topics/${encodeURIComponent(n.topic)}">${text('合读赤壁')} →</a>`:''}
      <a href="${esc(href)}">${text('大事记载')} →</a></div>
      <div class="atlas-people">${n.participants.slice(0,5).map(p=>`<a href="#/people/${encodeURIComponent(p.id)}">${text(p.name)}</a>`).join('')}</div>
      <div class="atlas-excerpts">${n.sources.map(excerpt).join('')}</div>`;
  }
  function render() {
    updateDataset();
    for(const button of host.querySelectorAll('[data-period]'))button.setAttribute('aria-pressed',String(button.dataset.period===state.period));
    select.value=state.category;card.innerHTML=cardHTML(selected());announce();draw();
    const years=[...new Set(state.nodes.map(n=>n.year))];
    host.querySelector('.atlas-list summary span').textContent=cv('· '+state.nodes.length+' 项');
    list.innerHTML=years.length?years.map(y=>`<section><h3>${y} ${text('年')}</h3><ul>${state.nodes.filter(n=>n.year===y).map(n=>`<li><button type="button" data-node="${esc(n.key)}" aria-pressed="${n.key===state.key}">${text(n.title)}</button></li>`).join('')}</ul></section>`).join(''):`<p>${text('没有符合条件的大事')}</p>`;
    list.querySelectorAll('button').forEach(b=>b.onclick=()=>pick(b.dataset.node,'list'));
    const enter=host.querySelector('.atlas-enter');if(enter)enter.href=atlasHash(state);
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
      const rect=target.getBoundingClientRect(),view=scroll.getBoundingClientRect();
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
    const q=new URLSearchParams({period:button.dataset.period,category:state.category,node:state.key});
    change(atlasState(bundle,q));scroll.scrollLeft=0;button.focus({preventScroll:true});onChange();
  };
  select.onchange=()=>{
    const q=new URLSearchParams({period:state.period,category:select.value,node:state.key});
    change(atlasState(bundle,q));select.focus({preventScroll:true});
  };
  scroll.addEventListener('scroll',onChange,{passive:true});
  render();
  scroll.scrollLeft=saved?.scrollLeft||0;
  const observer=new ResizeObserver(()=>{
    cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);
  });observer.observe(scroll);
  host.atlasDispose=()=>{disposed=true;observer.disconnect();cancelAnimationFrame(frame);};
  return state;
}
