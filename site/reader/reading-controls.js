// Reading controls own transient UI only. Preferences and browser-entry context
// are supplied by the reader; no URL or storage is maintained here.
export function readingSettingsHTML({types,landmarks,fontSize,esc,cv}) {
  return `<button type="button" class="reading-settings-trigger" id="open-reading-settings" aria-label="${cv('阅读设置')}" aria-haspopup="dialog" aria-controls="reading-settings">${cv('设置')}</button>
    <dialog class="reading-settings" id="reading-settings" aria-labelledby="reading-settings-title">
      <header class="settings-head"><h2 id="reading-settings-title">${cv('阅读设置')}</h2><button type="button" id="close-reading-settings" autofocus>${cv('关闭')}</button></header>
      <div class="settings-body"><label class="settings-jump"><span>${cv('定位正文')}</span><select id="jump"><option value="">${cv('定位正文')}</option>${landmarks.map(([id,text])=>`<option value="${esc(id)}">${esc(cv(text))}</option>`).join('')}</select></label>
      ${types.map(([type,label])=>`<label class="note-setting"><input type="checkbox" data-note-toggle="${esc(type)}"><span>${esc(cv(label))}</span><span class="note-setting-state" aria-hidden="true"></span></label>`).join('')}
      <div class="settings-font"><span>${cv('字号')}</span><div><button type="button" id="smaller" aria-label="${cv('减小字号')}">A−</button><output id="font-size">${fontSize}</output><button type="button" id="larger" aria-label="${cv('增大字号')}">A＋</button></div></div></div>
    </dialog>`;
}

export function chapterProgressHTML(cv) {
  return `<button type="button" id="toggle-reading-progress" class="progress-toggle" aria-expanded="false" aria-controls="chapter-progress"><span class="progress-position"></span></button>
    <div class="chapter-progress" id="chapter-progress" role="group" aria-label="${cv('本篇进度')}" hidden><div class="progress-head"><span>${cv('本篇进度')}</span><button type="button" id="close-reading-progress">${cv('收起进度')}</button></div><input type="range" id="chapter-position" min="1" max="1" value="1" step="1" aria-label="${cv('本篇进度')}"><p class="progress-tip" aria-hidden="true" hidden></p></div>`;
}

export function mountReadingControls({host,entries,getPrefs,onNoteChange,onFontChange,onJump,onPositionChange,cv}) {
  const controller=new AbortController(),options={signal:controller.signal};
  const dialog=host.querySelector('#reading-settings'),opener=host.querySelector('#open-reading-settings');
  const toggle=host.querySelector('#toggle-reading-progress'),bar=host.querySelector('#chapter-progress'),range=bar.querySelector('input'),position=toggle.querySelector('.progress-position'),tip=bar.querySelector('.progress-tip');
  const toolbar=host.querySelector('.toolbar'),reading=host.querySelector('#reading'),head=document.querySelector('.site-head');
  const items=entries.map(([el])=>el),labels=entries.map(([,text])=>cv(text));
  let revealed=null,frame=0,observed=1,pointerActive=false,ignoreChange=false,disposed=false;
  let concealed=false,lastY=scrollY,distance=0,direction=0,intentUntil=0,keyboardFocus=false,toolbarPointer=false;
  const listen=(el,name,fn,extra={})=>el.addEventListener(name,fn,{...options,...extra});
  const clamp=value=>Math.min(items.length,Math.max(1,Number(value)||1));
  function resetScrollIntent() {intentUntil=0;distance=0;direction=0;lastY=scrollY;}
  function showToolbar() {
    concealed=false;toolbar.classList.remove('is-concealed');toolbar.inert=false;
    document.documentElement.style.setProperty('--reading-offset',((parseFloat(getComputedStyle(toolbar).top)||0)+toolbar.offsetHeight+12)+'px');
  }
  function locked() {
    return pointerActive||toolbarPointer||!bar.hidden||!!document.querySelector('dialog[open]')||
      keyboardFocus&&toolbar.contains(document.activeElement);
  }
  function scrollIntent(delta) {
    if(!delta||locked())return;
    const next=Math.sign(delta);if(direction!==next){direction=next;distance=0;}
    intentUntil=performance.now()+1200;
  }
  function placeProgress() {
    if(bar.hidden||pointerActive)return;
    const r=toolbar.getBoundingClientRect(),height=bar.offsetHeight;
    bar.classList.toggle('is-above',r.bottom+height>innerHeight-8&&r.top>=height+8);
  }
  function onScroll() {
    const y=Math.max(0,scrollY),delta=y-lastY;lastY=y;
    if(y<=0||toolbar.getBoundingClientRect().top>1){showToolbar();distance=0;}
    else if(!locked()&&performance.now()<intentUntil&&Math.sign(delta)===direction){
      distance+=Math.abs(delta);
      if(direction<0&&distance>=24){showToolbar();distance=0;}
      else if(direction>0&&distance>=56&&!concealed){
        concealed=true;toolbar.classList.add('is-concealed');toolbar.inert=true;
        document.documentElement.style.setProperty('--reading-offset','12px');distance=0;
      }
    }
    placeProgress();refresh();
  }
  function closeProgress(focus=false) {
    if(bar.hidden)return;
    cancelPreview();bar.hidden=true;toggle.setAttribute('aria-expanded','false');resetScrollIntent();
    if(focus)toggle.focus({preventScroll:true});refresh();
  }
  function prepareJump() {resetScrollIntent();showToolbar();closeProgress();}
  listen(toggle,'click',()=>{
    resetScrollIntent();showToolbar();
    if(!bar.hidden){closeProgress();return;}
    bar.hidden=false;toggle.setAttribute('aria-expanded','true');placeProgress();refresh();range.focus({preventScroll:true});
  });
  listen(bar.querySelector('#close-reading-progress'),'click',()=>closeProgress(true));
  listen(window,'pointerdown',event=>{
    resetScrollIntent();keyboardFocus=false;toolbarPointer=toolbar.contains(event.target);
    if(!bar.hidden&&!bar.contains(event.target)&&!toggle.contains(event.target))closeProgress();
  },{capture:true,passive:true});
  listen(window,'pointerup',()=>{toolbarPointer=false;});
  listen(window,'pointercancel',()=>{toolbarPointer=false;});
  listen(window,'wheel',event=>{keyboardFocus=false;if(!event.ctrlKey&&!toolbar.contains(event.target))scrollIntent(event.deltaY);},{passive:true});
  let touchY=null;
  listen(window,'touchstart',event=>{touchY=event.touches.length===1?event.touches[0].clientY:null;},{passive:true});
  listen(window,'touchmove',event=>{
    if(touchY===null||event.touches.length!==1||toolbar.contains(event.target))return;
    const next=event.touches[0].clientY;scrollIntent(touchY-next);touchY=next;
  },{passive:true});
  listen(window,'touchend',()=>{touchY=null;},{passive:true});
  listen(window,'touchcancel',()=>{touchY=null;resetScrollIntent();},{passive:true});
  listen(window,'keydown',event=>{
    if(event.key==='Tab'){
      if(pointerActive){ignoreChange=true;cancelPreview();}
      const recalling=concealed;keyboardFocus=true;resetScrollIntent();
      // Focus cannot enter a visibility transition's initially hidden frame
      // in narrow Chromium. Keyboard recall must be immediately focusable.
      if(recalling)toolbar.style.transition='none';
      showToolbar();
      if(recalling){
        event.preventDefault();(event.shiftKey?opener:toolbar.querySelector('#open-directory')).focus({preventScroll:true});
        toolbar.style.removeProperty('transition');
      }
    }
    if(event.key==='Escape'&&!bar.hidden){event.preventDefault();closeProgress(true);}
    if(event.target.closest('input,select,textarea,button,summary,a,[contenteditable=true]')||event.ctrlKey||event.metaKey||event.altKey)return;
    const delta={ArrowDown:1,PageDown:1,End:1,' ':event.shiftKey?-1:1,ArrowUp:-1,PageUp:-1,Home:-1}[event.key];
    if(delta)scrollIntent(delta);
  },{capture:true});
  listen(toolbar,'focusin',showToolbar);

  function syncSettings() {
    const prefs=getPrefs();
    for(const input of dialog.querySelectorAll('[data-note-toggle]')){
      input.checked=prefs.noteVisibility[input.dataset.noteToggle]!==false;
      input.closest('label').querySelector('.note-setting-state').textContent=cv(input.checked?'显示':'隐藏');
    }
    dialog.querySelector('#font-size').textContent=prefs.fs;
    dialog.querySelector('#smaller').disabled=prefs.fs<=16;
    dialog.querySelector('#larger').disabled=prefs.fs>=30;
  }
  function applyNotes() {
    const visibility=getPrefs().noteVisibility;
    for(const ref of host.querySelectorAll('.note-ref[data-note-type]'))ref.hidden=visibility[ref.dataset.noteType]===false;
    for(const stack of host.querySelectorAll('.note-stack[data-note-type]')){
      const show=visibility[stack.dataset.noteType]!==false;
      for(const note of stack.querySelectorAll(':scope>.note'))note.hidden=!show&&note!==revealed;
      stack.hidden=!show&&![...stack.querySelectorAll(':scope>.note')].some(note=>!note.hidden);
    }
    for(const stacks of host.querySelectorAll('.note-stacks'))stacks.hidden=[...stacks.children].every(stack=>stack.hidden);
    syncSettings();refresh();
  }
  function revealNote(el) {
    const note=el.matches('.note-ref')?host.querySelector('#'+CSS.escape(el.dataset.note)):el.closest('.note')||el.querySelector('.note');
    if(!note?.matches('.note')||!host.contains(note))return null;
    revealed=note;applyNotes();
    return el.matches('.note-ref')?note.querySelector('summary'):el;
  }
  function dismissNote(note) {
    if(note!==revealed)return false;
    revealed=null;applyNotes();return true;
  }
  function closeSettings() {if(dialog.open)dialog.close();}
  listen(opener,'click',()=>{prepareJump();cancelPreview();syncSettings();document.documentElement.classList.add('reading-settings-open');dialog.showModal();});
  listen(dialog.querySelector('#close-reading-settings'),'click',closeSettings);
  // Dismiss only an actual backdrop click, never an internal focus transition.
  let backdrop=false;
  const outside=event=>{const r=dialog.getBoundingClientRect();return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;};
  listen(dialog,'pointerdown',event=>{backdrop=event.target===dialog&&outside(event);});
  listen(dialog,'click',event=>{if(backdrop&&event.target===dialog&&outside(event))closeSettings();backdrop=false;});
  listen(dialog,'close',()=>{document.documentElement.classList.remove('reading-settings-open');if(!disposed&&opener.isConnected)opener.focus({preventScroll:true});});
  for(const input of dialog.querySelectorAll('[data-note-toggle]'))listen(input,'change',()=>{
    if(revealed?.closest('.note-stack').dataset.noteType===input.dataset.noteToggle)revealed=null;
    onNoteChange(input.dataset.noteToggle,input.checked);applyNotes();
  });
  listen(dialog.querySelector('#smaller'),'click',()=>{onFontChange(-1);syncSettings();});
  listen(dialog.querySelector('#larger'),'click',()=>{onFontChange(1);syncSettings();});
  listen(dialog.querySelector('#jump'),'change',event=>{const id=event.target.value;if(id){closeSettings();onJump(id);}});

  function paint(value,preview=false) {
    if(!items.length)return;
    value=clamp(value);range.value=value;
    const ratio=(value-1)/Math.max(1,items.length-1);
    range.style.setProperty('--position',ratio*100+'%');
    range.setAttribute('aria-valuetext',cv(`第 ${value} 段，共 ${items.length} 段`));
    position.textContent=cv(`${value} / ${items.length} 段`);
    toggle.setAttribute('aria-label',cv(`本篇进度：第 ${value} 段，共 ${items.length} 段`));
    tip.hidden=!preview;
    if(preview){
      tip.textContent=`${value} / ${items.length} · ${labels[value-1]}`;
      const r=bar.getBoundingClientRect(),width=tip.getBoundingClientRect().width;
      const left=Math.max(12-r.left,Math.min(r.width*ratio-width/2,innerWidth-12-r.left-width));
      tip.style.left=left+'px';
    }
  }
  function update() {
    if(disposed||pointerActive||items.length<2)return;
    const line=(concealed?0:Math.max(0,toolbar.getBoundingClientRect().bottom,!bar.hidden?bar.getBoundingClientRect().bottom:0))+16;
    let index=0;
    for(let i=1;i<items.length;i++)if(items[i].getBoundingClientRect().top<=line)index=i;else break;
    // The last paragraph cannot always reach the toolbar, but it is fully visible.
    const last=items.at(-1).getBoundingClientRect();
    if(scrollY>0&&(last.bottom<=innerHeight+1||scrollY+innerHeight>=document.documentElement.scrollHeight-1))index=items.length-1;
    observed=index+1;paint(observed);
  }
  function refresh() {if(disposed||frame)return;frame=requestAnimationFrame(()=>{frame=0;update();});}
  function cancelPreview() {pointerActive=false;bar.classList.remove('previewing');paint(observed);refresh();}
  function commit(value) {
    if(items.length<2)return;
    value=clamp(value);pointerActive=false;bar.classList.remove('previewing');
    resetScrollIntent();showToolbar();
    bar.classList.remove('is-above');
    const edge=(parseFloat(getComputedStyle(toolbar).top)||0)+toolbar.offsetHeight+(!bar.hidden?bar.offsetHeight:0)+12;
    const top=items[value-1].getBoundingClientRect().top+scrollY;
    scrollTo({top:Math.max(0,top-edge),behavior:'instant'});
    observed=value;paint(value);onPositionChange();refresh();
  }
  toggle.hidden=items.length<2;bar.hidden=true;range.max=Math.max(1,items.length);
  listen(range,'pointerdown',event=>{if(event.button!==0||event.isPrimary===false)return;ignoreChange=false;pointerActive=true;bar.classList.add('previewing');paint(range.value,true);});
  listen(range,'input',()=>{paint(range.value,true);});
  listen(range,'change',()=>{if(!ignoreChange&&(pointerActive||Number(range.value)!==observed))commit(range.value);});
  listen(window,'pointerup',()=>{if(pointerActive)commit(range.value);});
  listen(range,'pointercancel',()=>{ignoreChange=true;cancelPreview();});
  listen(range,'lostpointercapture',()=>{if(pointerActive){ignoreChange=true;cancelPreview();}});
  // Mobile WebKit moves focus off a range at the start of a mouse/pointer
  // gesture. Keep that live gesture; Tab, pointer cancellation, capture loss
  // and window blur still cancel explicitly without committing a jump.
  listen(range,'blur',()=>{if(pointerActive&&toolbarPointer)return;ignoreChange=true;cancelPreview();});
  listen(range,'focus',()=>{ignoreChange=false;});
  listen(window,'blur',()=>{ignoreChange=true;cancelPreview();});
  listen(range,'keydown',event=>{
    const value=Number(range.value),steps={ArrowRight:1,ArrowUp:1,ArrowLeft:-1,ArrowDown:-1,PageDown:10,PageUp:-10};
    let next=event.key==='Home'?1:event.key==='End'?items.length:steps[event.key]!==undefined?value+steps[event.key]:null;
    if(event.key==='Escape'){event.preventDefault();ignoreChange=true;cancelPreview();return;}
    if(next===null)return;
    event.preventDefault();ignoreChange=false;commit(next);
  });
  listen(window,'scroll',onScroll,{passive:true});listen(window,'resize',()=>{resetScrollIntent();showToolbar();cancelPreview();refresh();});
  listen(reading,'toggle',refresh,{capture:true});listen(reading,'load',refresh,{capture:true});
  const fitToolbar=()=>{if(!concealed)showToolbar();placeProgress();refresh();};
  const observer=new ResizeObserver(fitToolbar);observer.observe(reading);observer.observe(toolbar);if(head)observer.observe(head);
  document.fonts?.ready.then(refresh);
  fitToolbar();applyNotes();update();
  return {applyNotes,syncSettings,refresh,revealNote,dismissNote,prepareJump,resetScrollIntent,
    revealedId:()=>revealed?.id||null,
    isTemporary:note=>note===revealed&&getPrefs().noteVisibility[note.closest('.note-stack').dataset.noteType]===false,
    dispose(){disposed=true;controller.abort();observer.disconnect();cancelAnimationFrame(frame);if(dialog.open)dialog.close();document.documentElement.classList.remove('reading-settings-open','reading-page');document.documentElement.style.removeProperty('--reading-offset');}
  };
}
