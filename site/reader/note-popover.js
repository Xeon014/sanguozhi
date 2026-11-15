// Desktop note popover: outside phones a marker shows one annotation in a
// panel anchored beside it while the paragraph-end stacks stay hidden. Like
// the mobile sheet it is transient UI; the reader never records it in view
// context.
export function mountNotePopover({mobileLayout,cv,render,neighbors,onDismiss}) {
  const controller=new AbortController(),options={signal:controller.signal};
  const panel=document.createElement('div');
  panel.className='note-popover';
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-label','注释');
  panel.tabIndex=-1;
  panel.hidden=true;
  panel.innerHTML=`<header class="note-popover-head"><p class="note-popover-label"></p><button type="button" class="note-popover-close"></button></header>
    <div class="note-popover-body"></div>
    <div class="note-popover-nav"><button type="button" class="note-popover-prev"></button><span class="note-popover-count"></span><button type="button" class="note-popover-next"></button></div>`;
  const listen=(el,name,fn,extra={})=>el.addEventListener(name,fn,{...options,...extra});
  let origin=null,currentId=null,openState=false,prevEntry=null,nextEntry=null;
  // The panel is absolutely positioned inside #reading, so it scrolls with
  // the paragraph; only the initial placement has to fit the viewport.
  const place=()=>{
    const base=panel.offsetParent;
    if(!base||!origin)return;
    // A hidden-preference marker has no box; anchor its paragraph instead.
    const anchor=origin.getClientRects().length?origin.getBoundingClientRect():origin.closest('.reading-group')?.getBoundingClientRect();
    if(!anchor)return;
    const root=base.getBoundingClientRect(),gap=10,pad=12;
    panel.style.left='0px';panel.style.top='0px';
    const w=panel.offsetWidth,h=panel.offsetHeight;
    const below=anchor.bottom+gap+h<=innerHeight-pad;
    const top=below?anchor.bottom+gap:Math.max(pad,anchor.top-gap-h);
    let vx=anchor.left+anchor.width/2-w/2;
    vx=Math.max(pad,Math.min(vx,innerWidth-pad-w));
    panel.style.left=Math.round(vx-root.left)+'px';
    panel.style.top=Math.round(top-root.top)+'px';
  };
  const fill=noteId=>{
    const data=render(noteId);
    currentId=noteId;
    panel.classList.toggle('note-secondary',data.secondary);
    panel.querySelector('.note-popover-label').textContent=data.label;
    const body=panel.querySelector('.note-popover-body');
    body.textContent='';
    body.insertAdjacentHTML('afterbegin',data.html);
    body.scrollTop=0;
    const nav=neighbors?.(noteId)||null;
    panel.classList.toggle('has-nav',!!nav);
    const prev=panel.querySelector('.note-popover-prev'),next=panel.querySelector('.note-popover-next'),count=panel.querySelector('.note-popover-count');
    prev.textContent=cv('上一条');next.textContent=cv('下一条');
    prev.hidden=!nav||!nav.prev;next.hidden=!nav||!nav.next;
    count.hidden=!nav;
    if(nav)count.textContent=cv(`第 ${nav.index} 条，共 ${nav.total} 条`);
    prevEntry=nav?.prev||null;nextEntry=nav?.next||null;
  };
  const close=(returnFocus=true)=>{
    if(!openState)return;
    openState=false;panel.hidden=true;
    const dismissed=currentId;currentId=null;
    if(origin){
      origin.setAttribute('aria-expanded','false');
      // Keyboard dismissals return to the marker, or to its paragraph when a
      // hidden preference hides the marker; pointer dismissals leave the
      // reading focus alone, same as the sheet.
      if(returnFocus){const dest=origin.getClientRects().length?origin:origin.closest('.reading-group');dest?.focus({preventScroll:true});}
      else if(panel.contains(document.activeElement))document.activeElement.blur();
      origin=null;
    }
    onDismiss?.(dismissed);
  };
  const open=(ref,noteId)=>{
    if(origin&&origin!==ref)origin.setAttribute('aria-expanded','false');
    origin=ref;ref.setAttribute('aria-expanded','true');
    fill(noteId);
    document.getElementById('reading')?.append(panel);
    panel.hidden=false;openState=true;
    panel.querySelector('.note-popover-close').textContent=cv('收起');
    place();
    panel.querySelector('.note-popover-close').focus({preventScroll:true});
  };
  const jump=entry=>{
    if(!entry)return;
    open(entry.ref,entry.id);
    entry.ref.scrollIntoView({block:'center'});
  };
  listen(panel.querySelector('.note-popover-close'),'click',()=>close());
  listen(panel.querySelector('.note-popover-prev'),'click',()=>jump(prevEntry));
  listen(panel.querySelector('.note-popover-next'),'click',()=>jump(nextEntry));
  // Any pointer outside the panel closes it; the marker itself is left to the
  // click toggle so a second tap reuses the same close path.
  listen(document,'pointerdown',event=>{
    if(!openState||panel.contains(event.target)||event.target===origin||origin?.contains(event.target))return;
    close(false);
  },true);
  listen(document,'keydown',event=>{
    if(openState&&event.key==='Escape'&&!document.querySelector('dialog[open]')){event.preventDefault();close(true);}
  },true);
  // Phones hand the note to the bottom sheet; a resize invalidates placement.
  listen(mobileLayout,'change',event=>{if(event.matches)close(false);});
  listen(window,'resize',()=>{if(openState)close(false);});
  return {toggle(ref,noteId){if(openState&&origin===ref){close();return;}open(ref,noteId);},
    open,close,currentId:()=>currentId,currentRef:()=>origin,
    dispose(){controller.abort();close(false);panel.remove();}};
}
