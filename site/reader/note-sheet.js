// Mobile note sheet: on narrow layouts a marker opens one annotation in a
// bottom dialog instead of unfolding stacks under the paragraph. The sheet
// is transient UI; the reader never records it in view context.
export function mountNoteSheet({mobileLayout,cv,render,onDismiss}) {
  const controller=new AbortController(),options={signal:controller.signal};
  const dialog=document.createElement('dialog');
  dialog.className='note-sheet';
  dialog.setAttribute('aria-labelledby','note-sheet-label');
  dialog.innerHTML=`<div class="note-sheet-grab" aria-hidden="true"></div>
    <header class="note-sheet-head"><p class="note-sheet-label" id="note-sheet-label"></p><button type="button" class="note-sheet-close"></button></header>
    <div class="note-sheet-clip"><div class="note-sheet-body"></div><div class="note-sheet-fade" aria-hidden="true"></div></div>
    <button type="button" class="note-sheet-more" aria-expanded="false"></button>`;
  document.body.append(dialog);
  const listen=(el,name,fn)=>el.addEventListener(name,fn,options);
  let origin=null,currentId=null,pointerClose=false;
  // Long notes start capped near two fifths of the screen; the reader expands
  // on request. Switching notes resets the height, same as closing.
  const fitHeight=()=>{
    const body=dialog.querySelector('.note-sheet-body'),more=dialog.querySelector('.note-sheet-more');
    dialog.classList.remove('tall');
    more.setAttribute('aria-expanded','false');
    more.textContent=cv('展开全部');
    requestAnimationFrame(()=>{dialog.classList.toggle('capped',body.scrollHeight>body.clientHeight+2);});
  };
  // The body renders from note data in plain mode, so no reading-DOM ids ever
  // enter the sheet.
  const fill=noteId=>{
    const data=render(noteId);
    currentId=noteId;
    dialog.querySelector('.note-sheet-label').textContent=data.label;
    dialog.classList.toggle('note-secondary',data.secondary);
    const body=dialog.querySelector('.note-sheet-body');
    body.textContent='';
    body.insertAdjacentHTML('afterbegin',data.html);
  };
  const close=()=>{if(dialog.open)dialog.close();};
  // Keyboard activations carry detail 0 and keep returning to the marker;
  // pointer closes leave no selection so the next marker is a single tap.
  const requestClose=event=>{pointerClose=event?.detail!==0;close();};
  listen(dialog,'click',event=>{
    if(event.target.closest('.note-sheet-close')){requestClose(event);return;}
    const more=event.target.closest('.note-sheet-more');
    if(more){
      const tall=dialog.classList.toggle('tall');
      more.setAttribute('aria-expanded',String(tall));
      more.textContent=cv(tall?'收起长文':'展开全部');
      if(!tall)dialog.classList.add('capped');
    }
  });
  // Dismiss only an actual backdrop click, never an internal focus transition.
  let backdrop=false;
  const outside=event=>{const r=dialog.getBoundingClientRect();return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY<r.bottom;};
  listen(dialog,'pointerdown',event=>{backdrop=event.target===dialog&&outside(event);});
  listen(dialog,'click',event=>{if(backdrop&&event.target===dialog&&outside(event))requestClose(event);backdrop=false;});
  listen(dialog,'close',()=>{
    document.documentElement.classList.remove('note-sheet-open');
    dialog.querySelector('.note-sheet-body').textContent='';
    dialog.classList.remove('capped','tall');
    const dismissed=currentId;currentId=null;
    if(origin){
      origin.setAttribute('aria-expanded','false');
      if(pointerClose){if(document.activeElement===origin)origin.blur();}
      else{const dest=origin.getClientRects().length?origin:origin.closest('.reading-group');dest?.focus({preventScroll:true});}
      origin=null;
    }
    pointerClose=false;
    onDismiss?.(dismissed);
  });
  listen(mobileLayout,'change',event=>{if(!event.matches)close();});
  const open=(ref,noteId)=>{
    if(origin&&origin!==ref)origin.setAttribute('aria-expanded','false');
    origin=ref;ref.setAttribute('aria-expanded','true');
    dialog.querySelector('.note-sheet-close').textContent=cv('收起');
    fill(noteId);
    fitHeight();
    if(!dialog.open){document.documentElement.classList.add('note-sheet-open');dialog.showModal();}
    dialog.querySelector('.note-sheet-close').focus({preventScroll:true});
  };
  return {
    toggle(ref,noteId){
      if(dialog.open&&origin===ref){close();return;}
      open(ref,noteId);
    },
    open,close,currentId:()=>currentId,currentRef:()=>origin,
    dispose(){controller.abort();close();dialog.remove();document.documentElement.classList.remove('note-sheet-open');}
  };
}
