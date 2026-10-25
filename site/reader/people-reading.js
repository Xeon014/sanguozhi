// Retain a keyboard user's position even if automatic loading consumes the last button.
export function retainMoreFocus(button,container,text) {
  let next=container.querySelector(':scope>.load-more');
  if(!next){
    next=button;next.className='load-finished';next.removeAttribute('id');next.removeAttribute('data-people-more');
    next.setAttribute('aria-disabled','true');next.onclick=null;delete next.peopleLoad;next.textContent=text('已全部加载');container.append(next);
  }
  next.focus({preventScroll:true});
}

// Loading follows a reader's downward input, never a layout change or restored scroll.
export function bindPeopleLoading(main,{text=s=>s}={}) {
  const controller=new AbortController(),signal=controller.signal;
  const status=document.createElement('p');status.className='sr-only';status.role='status';status.setAttribute('aria-live','polite');
  (main.querySelector('.knowledge-page')||main).append(status);
  let consumed=false,lastWheel=-Infinity,touchY=null,frame=0;
  function insideScroller(target){
    for(let el=target instanceof Element?target:null;el&&el!==main;el=el.parentElement){
      if(el.matches('.life-navigation')&&el.open)return true;
      if(/auto|scroll/.test(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight+1)return true;
    }
    return false;
  }
  function request(event){
    if(consumed||insideScroller(event.target))return;
    const candidates=[...main.querySelectorAll('[data-people-more]')].filter(button=>{
      // Chromium can retain layout rectangles for the contents of closed details.
      if(button.closest('details:not([open]),[hidden],[inert]'))return false;
      const rect=button.getBoundingClientRect();
      return button.getClientRects().length&&rect.top>=innerHeight*.4&&rect.bottom<=innerHeight+2&&!button.disabled;
    }).sort((a,b)=>b.getBoundingClientRect().bottom-a.getBoundingClientRect().bottom);
    const button=candidates[0];if(!button?.peopleLoad)return;
    consumed=true;
    frame=requestAnimationFrame(()=>{
      if(!button.isConnected)return;
      const count=button.peopleLoad();
      if(count)status.textContent=text(`已加载 ${count} 条`);
    });
  }
  window.addEventListener('wheel',event=>{
    if(event.ctrlKey||event.deltaY<=0)return;
    const now=performance.now();if(now-lastWheel>240)consumed=false;lastWheel=now;
    request(event);
  },{signal,passive:true});
  window.addEventListener('touchstart',event=>{touchY=event.touches.length===1?event.touches[0].clientY:null;consumed=false;},{signal,passive:true});
  window.addEventListener('touchmove',event=>{
    if(touchY===null||event.touches.length!==1)return;
    const next=event.touches[0].clientY;if(touchY-next>8){request(event);touchY=next;}else if(next>touchY)touchY=next;
  },{signal,passive:true});
  window.addEventListener('touchend',()=>{touchY=null;},{signal,passive:true});
  window.addEventListener('touchcancel',()=>{touchY=null;},{signal,passive:true});
  function dispose(){controller.abort();cancelAnimationFrame(frame);status.remove();delete main.peopleLoadingDispose;}
  main.peopleLoadingDispose=dispose;
  return dispose;
}

export function bindLifeNavigation(main,{onChange=()=>{}}={}) {
  const nav=main.querySelector('.life-navigation');if(!nav)return;
  const controller=new AbortController(),signal=controller.signal,summary=nav.querySelector('summary');
  const mobile=matchMedia('(max-width:760px)'),head=document.querySelector('.site-head');
  const links=[...nav.querySelectorAll('a[data-stage-target]')];
  const targets=links.map(link=>document.getElementById(link.dataset.stageTarget));
  const place=document.createComment('life-navigation');nav.before(place);
  function position(){
    if(mobile.matches)main.querySelector('.person-biography').before(nav);
    else place.after(nav);
  }
  position();
  let frame=0;
  function update(){
    const header=Math.max(0,head?.getBoundingClientRect().bottom||0);
    main.style.setProperty('--life-head',header+'px');
    nav.style.setProperty('--life-menu-height',Math.max(44,(window.visualViewport?.height||innerHeight)-header-summary.offsetHeight-16)+'px');
    const edge=Math.max(parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)||0,header+(mobile.matches?summary.offsetHeight:0)+24)+3;
    let active=0;targets.forEach((target,i)=>{if(target&&target.getBoundingClientRect().top<=edge)active=i;});
    links.forEach((link,i)=>{if(i===active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});
    nav.querySelector('.life-current').textContent=links[active]?.textContent||'';
  }
  function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(update);}
  function close(focus=false){if(mobile.matches&&nav.open){nav.open=false;if(focus)summary.focus({preventScroll:true});onChange();}}
  nav.addEventListener('click',event=>{if(event.target.closest('a')&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey)close();},{signal});
  nav.addEventListener('keydown',event=>{if(event.key==='Escape'&&nav.open&&mobile.matches){event.preventDefault();event.stopPropagation();close(true);}},{signal});
  nav.addEventListener('focusout',event=>{if(event.relatedTarget&&!nav.contains(event.relatedTarget))close();},{signal});
  document.addEventListener('click',event=>{if(!nav.contains(event.target))close();},{signal});
  mobile.addEventListener('change',()=>{position();nav.open=!mobile.matches;schedule();},{signal});
  window.addEventListener('scroll',schedule,{signal,passive:true});window.addEventListener('resize',schedule,{signal});
  window.visualViewport?.addEventListener('resize',schedule,{signal});
  const observer=new ResizeObserver(schedule);if(head)observer.observe(head);
  nav.addEventListener('toggle',schedule,{signal});
  function dispose(){controller.abort();observer.disconnect();cancelAnimationFrame(frame);place.remove();main.style.removeProperty('--life-head');delete main.lifeNavigationDispose;}
  main.lifeNavigationDispose=dispose;update();
  return dispose;
}
