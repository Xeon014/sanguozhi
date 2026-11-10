// Mobile note sheet: on narrow layouts a marker opens one annotation in a
// bottom dialog instead of unfolding stacks under the paragraph. The sheet
// is transient UI; the reader never records it in view context.
export function mountNoteSheet({mobileLayout,cv}) {
  const controller=new AbortController(),options={signal:controller.signal};
  const dialog=document.createElement('dialog');
  dialog.className='note-sheet';
  dialog.setAttribute('aria-labelledby','note-sheet-label');
  dialog.innerHTML=`<div class="note-sheet-grab" aria-hidden="true"></div>
    <header class="note-sheet-head"><p class="note-sheet-label" id="note-sheet-label"></p><button type="button" class="note-sheet-close"></button></header>
    <div class="note-sheet-body"></div>`;
  document.body.append(dialog);
  const listen=(el,name,fn)=>el.addEventListener(name,fn,options);
  let origin=null;
  // Cloned annotation blocks carry block and nested-ref ids; strip them so
  // getElementById keeps resolving to the in-place reading DOM only.
  const fill=note=>{
    const source=note.querySelector('.note-body');
    dialog.querySelector('.note-sheet-label').textContent=note.querySelector('summary')?.textContent||'';
    dialog.classList.toggle('note-secondary',note.classList.contains('note-secondary'));
    const body=dialog.querySelector('.note-sheet-body');
    body.textContent='';
    if(!source)return;
    for(const el of source.children){
      if(el.classList.contains('reading-actions'))continue;
      const copy=el.cloneNode(true);
      copy.removeAttribute('id');
      for(const nested of copy.querySelectorAll('[id]'))nested.removeAttribute('id');
      body.append(copy);
    }
  };
  const close=()=>{if(dialog.open)dialog.close();};
  listen(dialog,'click',event=>{
    if(event.target.closest('.note-sheet-close'))close();
  });
  // Dismiss only an actual backdrop click, never an internal focus transition.
  let backdrop=false;
  const outside=event=>{const r=dialog.getBoundingClientRect();return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY<r.bottom;};
  listen(dialog,'pointerdown',event=>{backdrop=event.target===dialog&&outside(event);});
  listen(dialog,'click',event=>{if(backdrop&&event.target===dialog&&outside(event))close();backdrop=false;});
  listen(dialog,'close',()=>{
    document.documentElement.classList.remove('note-sheet-open');
    dialog.querySelector('.note-sheet-body').textContent='';
    if(origin){origin.setAttribute('aria-expanded','false');origin.focus({preventScroll:true});origin=null;}
  });
  listen(mobileLayout,'change',event=>{if(!event.matches)close();});
  return {
    toggle(ref,note){
      if(dialog.open&&origin===ref){close();return;}
      if(origin&&origin!==ref)origin.setAttribute('aria-expanded','false');
      origin=ref;ref.setAttribute('aria-expanded','true');
      dialog.querySelector('.note-sheet-close').textContent=cv('收起');
      fill(note);
      if(!dialog.open){document.documentElement.classList.add('note-sheet-open');dialog.showModal();}
      dialog.querySelector('.note-sheet-close').focus({preventScroll:true});
    },
    dispose(){controller.abort();close();dialog.remove();document.documentElement.classList.remove('note-sheet-open');}
  };
}
