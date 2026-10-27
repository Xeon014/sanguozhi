// The atlas lanes group reviewed dates by category; within a lane the vertical
// position only prevents overlap. The detail tier plots every remaining
// reviewed-year record and fades in as the time window narrows.
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
  // The detail tier is category-neutral, so filters and category views keep it hidden.
  const records=!category&&!Object.keys(filters).length&&qs.get('period')!=='undated'&&Array.isArray(bundle.records)
    ?bundle.records.filter(r=>r.year>=period.from&&r.year<=period.to):[];
  const key=nodes.find(n=>n.key===qs.get('node'))?.key ||
    nodes.find(n=>n.key===bundle.default)?.key || nodes[0]?.key || '';
  return {period:qs.get('period')==='undated'?'undated':period.id,range:[period.from,period.to],category,key,nodes,records,...(Object.keys(filters).length?{filters}:{})};
}
export function zoomRange(range,anchor,factor=1,direction=0){
  const span=Math.max(1,Math.min(97,Math.round((range[1]-range[0]+1)*factor)));
  const center=direction?(range[0]+range[1])/2+direction*Math.max(1,Math.floor(span/2)):anchor;
  // Magnifying a window must never reveal years outside that window.
  const bounds=!direction&&factor<1?range:[184,280];
  const from=Math.max(bounds[0],Math.min(bounds[1]+1-span,Math.round(center-(span-1)/2)));
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
// The detail tier is always plotted; wide spans pack it as a dense star field.
const LANE_MIN=44,STACK=30,HIT=14,LABEL_GAP=16,MIN_PITCH=32;
export function layoutNodes(nodes, period, width, categoryOrder, measureTitle=s=>s.length*14, records=[]) {
  const laneOf=n=>categoryOrder.includes(n.categories?.[0])?n.categories[0]:categoryOrder[0];
  const groups=new Map();
  for(const node of nodes){
    const id=laneOf(node);
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(node);
  }
  const widest=Math.max(72,...nodes.map(n=>measureTitle(n.title)+72));
  width=Math.max(width,widest);
  const yearX=year=>period.from===period.to?width/2:36+(year-period.from)/(period.to-period.from)*(width-72);
  const span=period.to-period.from+1;
  // Wide spans name only groups and reviewed landmarks; full naming opens by forty years.
  const nameTier=span>60?1:2,maxStrips=span>40?2:3;
  const lanes=[];
  let top=18;
  const STRIP=20;
  // Groups and reviewed labels keep their name first when space runs out.
  const priority=n=>n.key.startsWith('group:')?0:n.label?1:2;
  for(const id of categoryOrder){
    if(!groups.has(id))continue;
    const members=[...groups.get(id)].sort((a,b)=>a.year-b.year||(a.key<b.key?-1:1));
    // Neighbouring stars closer than a full hit target stack onto extra tracks.
    const tracks=[];
    const trackOf=node=>{
      const x=yearX(node.year);
      let t=tracks.findIndex(lastX=>Math.abs(x-lastX)>=MIN_PITCH);
      if(t<0){t=tracks.length;}
      tracks[t]=x;
      return t;
    };
    const placed=members.map(node=>({node,track:trackOf(node)}));
    // Titles live on dedicated strips under the dot band, anchored beside their dot.
    const strips=[],labelOf=new Map();
    const ordered=[...placed].map(p=>p.node).filter(n=>priority(n)<=nameTier).sort((a,b)=>priority(a)-priority(b)||a.year-b.year||(a.key<b.key?-1:1));
    for(const node of ordered){
      const size=measureTitle(node.title),x=yearX(node.year);
      const options=[{start:x+LABEL_GAP,end:x+LABEL_GAP+size,anchor:'start',ax:x+LABEL_GAP},
        {start:x-LABEL_GAP-size,end:x-LABEL_GAP,anchor:'end',ax:x-LABEL_GAP}];
      let fit=null;
      for(let s=0;s<maxStrips&&!fit;s++){
        if(s>strips.length)break;
        if(s===strips.length)strips.push([]);
        const spans=strips[s];
        fit=options.find(o=>o.start>=16&&o.end<=width-16&&spans.every(r=>o.start>r.end+6||o.end<r.start-6));
        if(fit){strips[s].push(fit);labelOf.set(node.key,{...fit,strip:s});}
      }
    }
    const dotBand=Math.max(STACK,tracks.length*STACK);
    const lane={id,top,dotBand,strips:strips.length,placed,labelOf,
      height:Math.max(LANE_MIN,dotBand+strips.length*STRIP+12)};
    lanes.push(lane);
    top+=lane.height;
  }
  const lanesBottom=top;
  const axisY=lanesBottom+16;
  const points=new Map();
  for(const lane of lanes){
    const centre=lane.top+lane.dotBand/2,count=Math.max(...lane.placed.map(p=>p.track))+1;
    for(const {node,track} of lane.placed){
      const label=lane.labelOf.get(node.key);
      points.set(node.key,{node,lane:lane.id,x:yearX(node.year),
        y:centre+(track-(count-1)/2)*STACK,
        ...(label?{labelX:label.ax,labelY:lane.top+lane.dotBand+16+label.strip*STRIP,labelAnchor:label.anchor}:{})});
    }
  }
  // Detail tiles pack each year's remaining records inside that year's slot;
  // wide spans fall back to a finer, denser star field.
  let band=null;
  if(records.length){
    const pitch=span>1?yearX(period.from+1)-yearX(period.from):width-72;
    const dense=pitch<18,step=dense?Math.max(3,Math.min(5,Math.floor(pitch/2.5))):9;
    const byYear=new Map();
    for(const record of records){if(!byYear.has(record.year))byYear.set(record.year,[]);byYear.get(record.year).push(record);}
    let maxRows=1;
    const tiles=new Map();
    for(const [year,list] of byYear){
      const start=yearX(year)-(dense?1:3),perRow=Math.max(1,Math.floor(Math.max(step,pitch-(dense?2:6))/step));
      tiles.set(year,list.map((record,i)=>({record,x:start+(i%perRow)*step,row:Math.floor(i/perRow)})));
      maxRows=Math.max(maxRows,Math.ceil(list.length/perRow));
    }
    const bandTop=axisY+42;
    band={top:bandTop,height:maxRows*step+8,rows:maxRows,tiles,step,
      radius:dense?step*.45:2.4,opacity:dense?.75:1};
  }
  const height=Math.max(220,band?band.top+band.height+14:axisY+50);
  return {points:[...points.values()],lanes,height,width,yearX,axisY,band,lanesBottom,padTop:18};
}

export function mountAtlas(host,bundle,{esc,cv,home=false,qs=new URLSearchParams(),saved=null,onState=()=>{},onChange=()=>{}}) {
  const text=s=>esc(cv(String(s)));
  const categoryOrder=Object.keys(bundle.categories);
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
    <div class="atlas-lanes"><div class="atlas-lane-labels" role="group" aria-label="${text('类别泳道')}"></div>
    <div class="atlas-scroll" aria-label="${text('时间长卷，可横向浏览')}"><div class="atlas-canvas"></div></div></div>
    <div class="atlas-overview"${home?' hidden':''}></div>
    <div class="atlas-tooltip" role="tooltip" hidden></div>
    <div class="atlas-guidebar"><ul class="atlas-legend" aria-label="${text('图例')}">
    <li><svg viewBox="-20 -20 40 40" aria-hidden="true"><path d="M0,-6 L6,0 L0,6 L-6,0 Z" class="atlas-dot"/></svg>${text('战事')}</li>
    <li><svg viewBox="-20 -20 40 40" aria-hidden="true"><g class="atlas-star" aria-pressed="true"><rect x="-14" y="-14" width="28" height="28" rx="14" class="atlas-hit"/><circle r="4" class="atlas-dot"/></g></svg>${text('当前选中')}</li>
    <li class="atlas-legend-records" hidden><svg viewBox="-20 -20 40 40" aria-hidden="true"><circle r="3" class="atlas-record-dot"/></svg>${text('其余纪年史事')}</li></ul></div></div>
    <aside class="atlas-card" aria-label="${text('大事点读')}"></aside></div>`;
  const canvas=host.querySelector('.atlas-canvas'),scroll=host.querySelector('.atlas-scroll');
  const laneLabels=host.querySelector('.atlas-lane-labels'),overview=host.querySelector('.atlas-overview');
  const card=host.querySelector('.atlas-card'),status=host.querySelector('[role=status]'),tooltip=host.querySelector('.atlas-tooltip');
  const legendRecords=host.querySelector('.atlas-legend-records');
  const select=host.querySelector('select');
  let disposed=false,frame=0,focusKey=state.key,focusRecord='',drawnWidth=0;
  const tooltipId=(host.id||'atlas')+'-tooltip';tooltip.id=tooltipId;
  if(!home){
    overview.innerHTML=`<svg role="img"></svg>`;
    overview.querySelector('svg').setAttribute('aria-label',text('全时段概览'));
  }
  function hidePreview(){tooltip.hidden=true;canvas.querySelectorAll('[aria-describedby]').forEach(el=>el.removeAttribute('aria-describedby'));}
  function preview(point){
    const node=point.dataset.node?state.nodes.find(n=>n.key===point.dataset.node):null;
    const record=point.dataset.record?state.records.find(r=>r.id===point.dataset.record):null;
    if(!node&&!record)return;
    hidePreview();
    tooltip.textContent=cv(node?`${node.year} 年 · ${node.title}`:`${record.year} 年 · ${record.title}`);
    tooltip.hidden=false;
    const box=point.getBoundingClientRect(),hostBox=host.getBoundingClientRect();
    tooltip.style.left=Math.max(0,Math.min(host.clientWidth-tooltip.offsetWidth,box.left-hostBox.left+box.width/2-tooltip.offsetWidth/2))+'px';
    tooltip.style.top=Math.max(0,box.top-hostBox.top-tooltip.offsetHeight-8)+'px';
    point.setAttribute('aria-describedby',tooltipId);
  }
  // Arrow keys walk one sequence: per year the curated stars, then that year's records.
  function sequence(){
    const seq=[];
    for(const node of state.nodes)seq.push({kind:'node',year:node.year,id:node.key});
    for(const record of state.records)seq.push({kind:'record',year:record.year,id:record.id});
    return seq.sort((a,b)=>a.year-b.year||(a.kind===b.kind?(a.id<b.id?-1:1):a.kind==='node'?-1:1));
  }
  const elementFor=item=>item?canvas.querySelector(`[data-${item.kind}="${CSS.escape(item.id)}"]`):null;
  function focusItem(item){
    if(!item)return;
    if(item.kind==='node')focusKey=item.id;else focusRecord=item.id;
    for(const point of canvas.querySelectorAll('[data-node]'))point.tabIndex=point.dataset.node===focusKey?0:-1;
    for(const link of canvas.querySelectorAll('[data-record]'))link.tabIndex=link.dataset.record===focusRecord?0:-1;
    elementFor(item)?.focus({preventScroll:true});
    const el=elementFor(item);if(el)preview(el);
  }
  function moveFocus(from,step){
    const seq=sequence(),index=seq.findIndex(item=>item.id===(from.dataset.node||from.dataset.record)&&item.kind===(from.dataset.node?'node':'record'));
    if(index<0)return;
    const next=seq[(index+step+seq.length)%seq.length];
    if(next)focusItem(next);
  }
  const selected=()=>state.nodes.find(n=>n.key===state.key);
  const updateDataset=()=>{host.dataset.node=state.key;host.dataset.period=state.period;host.dataset.category=state.category;};
  function draw() {
    if(disposed||!host.isConnected)return;
    const active=document.activeElement;
    const focused={node:canvas.contains(active)?active.dataset.node:null,
      record:canvas.contains(active)?active.dataset.record:null,
      lane:laneLabels.contains(active)?active.dataset.lane:null};
    hidePreview();
    if(!state.nodes.some(n=>n.key===focusKey))focusKey=state.key;
    if(!state.records.some(r=>r.id===focusRecord))focusRecord=state.records[0]?.id||'';
    const period={id:state.period,from:state.range[0],to:state.range[1]};
    const available=Math.max(240,scroll.clientWidth);
    drawnWidth=scroll.clientWidth;
    const measure=document.createElement('canvas').getContext('2d');
    measure.font=`13px ${getComputedStyle(host).getPropertyValue('--sans')}`;
    const {points,lanes,height,width,yearX:x,axisY,band,padTop}=layoutNodes(state.nodes,period,available,categoryOrder,s=>measure.measureText(cv(s)).width,state.records);
    const axis=axisY,ticks=[period.from];
    const step=[1,2,5,10,20,25,50,100].find(n=>n>=(period.to-period.from)*48/(width-72));
    for(let y=Math.ceil((period.from+1)/step)*step;y<period.to;y+=step)
      if(x(y)-x(ticks.at(-1))>=42&&x(period.to)-x(y)>=42)ticks.push(y);
    if(period.to!==period.from)ticks.push(period.to);
    laneLabels.innerHTML=`<div class="atlas-lane-pad" style="height:${padTop}px" aria-hidden="true"></div>`+lanes.map(lane=>home
      ?`<p class="atlas-lane" style="height:${lane.height}px"><span>${text(bundle.categories[lane.id])}</span></p>`
      :`<button type="button" class="atlas-lane" data-lane="${esc(lane.id)}" aria-pressed="${state.category===lane.id}" style="height:${lane.height}px"><span>${text(bundle.categories[lane.id])}</span></button>`).join('');
    canvas.innerHTML=`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="${text('大事年份星图，左右方向键切换节点')}">
      ${lanes.map((lane,i)=>i%2?`<rect class="atlas-lane-band" x="24" y="${lane.top}" width="${width-48}" height="${lane.height}"/>`:'').join('')}
      ${lanes.map(lane=>`<line class="atlas-lane-line" x1="24" y1="${lane.top+lane.height}" x2="${width-24}" y2="${lane.top+lane.height}"/>`).join('')}
      <line class="atlas-axis" x1="24" y1="${axis}" x2="${width-24}" y2="${axis}"/>
      <text class="atlas-year" x="${width-20}" y="16" text-anchor="end">${text('公元年')}</text>
      ${ticks.map(y=>`<line class="atlas-guide" x1="${x(y)}" y1="18" x2="${x(y)}" y2="${axis+6}"/><text class="atlas-year" x="${x(y)}" y="${axis+28}" text-anchor="middle">${y}</text>`).join('')}
      ${points.map(({node:n,x,y,labelX,labelY,labelAnchor})=>`<g class="atlas-star" role="button" tabindex="${n.key===focusKey?0:-1}" data-node="${esc(n.key)}" aria-pressed="${n.key===state.key}" aria-label="${text(n.year+'年 · '+n.title+(n.warfare?' · 战事':''))}" transform="translate(${x},${y})">
      <rect x="-14" y="-14" width="28" height="28" rx="14" class="atlas-hit"/>
      ${n.warfare?'<path d="M0,-6 L6,0 L0,6 L-6,0 Z" class="atlas-dot"/>':'<circle r="4" class="atlas-dot"/>'}
      ${labelX!==undefined?`<text x="${labelX-x}" y="${labelY-y}" text-anchor="${labelAnchor}" class="atlas-label">${text(n.title)}</text>`:''}</g>`).join('')}
      ${band?`<g class="atlas-records" role="group" aria-label="${text('其余纪年史事')}" opacity="${band.opacity}">
      ${[...band.tiles.entries()].map(([year,tiles])=>tiles.map(({record,x:cx,row})=>`<a class="atlas-record" href="#/events/${encodeURIComponent(record.id)}" tabindex="${record.id===focusRecord?0:-1}" data-record="${esc(record.id)}" aria-label="${text(year+'年 · '+record.title)}" transform="translate(${cx},${band.top+7+row*band.step})"><rect x="-4.5" y="-4.5" width="9" height="9" class="atlas-record-hit"/><circle r="${band.radius}" class="atlas-record-dot"/></a>`).join('')).join('')}</g>`:''}
      </svg>`;
    for(const point of canvas.querySelectorAll('.atlas-star')){
      point.onclick=()=>pick(point.dataset.node,'point');
      point.onmouseenter=()=>preview(point);point.onmouseleave=hidePreview;
      point.onfocus=()=>preview(point);point.onblur=hidePreview;
      point.onkeydown=e=>{
        if(e.key==='ArrowRight'||e.key==='ArrowDown'){e.preventDefault();moveFocus(point,1);}
        if(e.key==='ArrowLeft'||e.key==='ArrowUp'){e.preventDefault();moveFocus(point,-1);}
        if(e.key==='Home'){e.preventDefault();focusItem(sequence()[0]);}
        if(e.key==='End'){e.preventDefault();focusItem(sequence().at(-1));}
        if(e.key==='Enter'||e.key===' '){e.preventDefault();pick(point.dataset.node,'point');}
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();hidePreview();}
      };
    }
    for(const link of canvas.querySelectorAll('.atlas-record')){
      link.onmouseenter=()=>preview(link);link.onmouseleave=hidePreview;
      link.onfocus=()=>preview(link);link.onblur=hidePreview;
      link.onkeydown=e=>{
        if(e.key==='ArrowRight'||e.key==='ArrowDown'){e.preventDefault();moveFocus(link,1);}
        if(e.key==='ArrowLeft'||e.key==='ArrowUp'){e.preventDefault();moveFocus(link,-1);}
        if(e.key==='Home'){e.preventDefault();focusItem(sequence()[0]);}
        if(e.key==='End'){e.preventDefault();focusItem(sequence().at(-1));}
        if(e.key===' '){e.preventDefault();link.click();}
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();hidePreview();}
      };
    }
    for(const button of laneLabels.querySelectorAll('[data-lane]')){
      button.onclick=()=>{
        const next=button.dataset.lane===state.category?'':button.dataset.lane;
        const q=new URLSearchParams({...state.filters,from:state.range[0],to:state.range[1],category:next,node:state.key});
        change(atlasState(bundle,q));
        const target=laneLabels.querySelector(next?`[data-lane="${CSS.escape(next)}"]`:'');
        target?.focus({preventScroll:true});
      };
    }
    legendRecords.hidden=!(band&&state.records.length);
    if(!home)drawOverview();
    if(focused.node){
      const target=canvas.querySelector(`[data-node="${CSS.escape(focused.node)}"]`);
      if(target)target.focus({preventScroll:true});
      else elementFor({kind:'node',id:state.key})?.focus({preventScroll:true});
    }else if(focused.record){
      const target=canvas.querySelector(`[data-record="${CSS.escape(focused.record)}"]`);
      target?.focus({preventScroll:true});
    }
    if(focused.lane)laneLabels.querySelector(`[data-lane="${CSS.escape(focused.lane)}"]`)?.focus({preventScroll:true});
  }
  // The overview strip always spans 184—280; dragging its window pans the range.
  function drawOverview(){
    const svg=overview.querySelector('svg');
    const width=overview.clientWidth||Math.max(240,scroll.clientWidth);
    const [fullFrom,fullTo]=[184,280];
    const map=year=>24+(year-fullFrom)/(fullTo-fullFrom)*(width-48);
    svg.setAttribute('width',width);svg.setAttribute('height',44);svg.setAttribute('viewBox',`0 0 ${width} 44`);
    svg.setAttribute('aria-label',text(`全时段概览 184—280 年，当前 ${state.range[0]}—${state.range[1]} 年`));
    svg.innerHTML=`<line class="atlas-axis" x1="24" y1="20" x2="${width-24}" y2="20"/>
      ${[200,220,250].map(y=>`<line class="atlas-guide" x1="${map(y)}" y1="12" x2="${map(y)}" y2="28"/><text class="atlas-year" x="${map(y)}" y="40" text-anchor="middle">${y}</text>`).join('')}
      ${bundle.nodes.map(n=>n.warfare
        ?`<path d="M${map(n.year)},17 L${map(n.year)+3},20 L${map(n.year)},23 L${map(n.year)-3},20 Z" class="atlas-overview-dot"/>`
        :`<circle cx="${map(n.year)}" cy="20" r="2" class="atlas-overview-dot"/>`).join('')}
      <rect class="atlas-window" x="${map(state.range[0])-1.5}" y="4" width="${Math.max(3,map(state.range[1])-map(state.range[0])+3)}" height="36"/>`;
  }
  function panOverview(event){
    const svg=overview.querySelector('svg');
    const rect=svg.getBoundingClientRect();
    const year=184+Math.max(0,Math.min(1,(event.clientX-rect.left-24)/(rect.width-48)))*96;
    const next=zoomRange(state.range,Math.round(year),1,0);
    if(next[0]!==state.range[0]||next[1]!==state.range[1])setRange(next);
  }
  if(!home){
    const svg=overview.querySelector('svg');
    let dragging=false;
    svg.addEventListener('pointerdown',e=>{
      if(e.button)return;
      dragging=true;svg.setPointerCapture(e.pointerId);panOverview(e);e.preventDefault();
    });
    svg.addEventListener('pointermove',e=>{if(dragging)panOverview(e);});
    const release=e=>{
      if(!dragging)return;
      dragging=false;
      try{svg.releasePointerCapture(e.pointerId);}catch{}
      onChange();
    };
    svg.addEventListener('pointerup',release);
    svg.addEventListener('pointercancel',release);
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
    focusItem({kind:'node',id:state.key});hidePreview();
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
