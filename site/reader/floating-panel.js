// Keep small reading controls inside the visible viewport, including keyboards.
export function bindFloatingPanel(anchor,panel,{isOpen=()=>!panel.hidden,onDismiss=()=>{}}={}) {
  const controller=new AbortController(),options={signal:controller.signal};let frame=0;
  function fit() {
    if(!anchor.isConnected){dispose();return;}
    if(!isOpen())return;
    panel.style.left='';panel.style.right='';panel.style.top='';panel.style.bottom='';
    const viewport=window.visualViewport,top=Math.max(viewport?.offsetTop||0,document.querySelector('.site-head')?.getBoundingClientRect().bottom||0)+8;
    const bottom=(viewport?.offsetTop||0)+(viewport?.height||innerHeight)-12;
    const left=(viewport?.offsetLeft||0)+12,right=(viewport?.offsetLeft||0)+(viewport?.width||innerWidth)-12;
    const rect=anchor.getBoundingClientRect(),parent=panel.offsetParent.getBoundingClientRect();
    const above=rect.top-top-6,below=bottom-rect.bottom-6;
    const upwards=below<Math.min(panel.scrollHeight,180)&&above>below;
    panel.style.maxHeight=Math.max(44,Math.min(bottom-top,upwards?above:below))+'px';
    if(upwards){panel.style.top='auto';panel.style.bottom=(parent.bottom-rect.top+6)+'px';}
    else{panel.style.bottom='auto';panel.style.top=(rect.bottom-parent.top+6)+'px';}
    const bounds=panel.getBoundingClientRect();
    panel.style.top=(Math.max(top,Math.min(bounds.top,bottom-bounds.height))-parent.top)+'px';panel.style.bottom='auto';
    panel.style.left=(Math.max(left,Math.min(bounds.left,right-bounds.width))-parent.left)+'px';panel.style.right='auto';
  }
  function schedule(event) {
    if(event?.target instanceof Element&&panel.contains(event.target))return;
    cancelAnimationFrame(frame);frame=requestAnimationFrame(fit);
  }
  function dispose(){cancelAnimationFrame(frame);controller.abort();delete panel.disposeFloating;}
  panel.dataset.floatingPanel='';panel.disposeFloating=dispose;
  window.addEventListener('resize',schedule,options);window.addEventListener('scroll',schedule,{...options,capture:true});
  window.visualViewport?.addEventListener('resize',schedule,options);
  window.visualViewport?.addEventListener('scroll',schedule,options);
  document.addEventListener('click',event=>{if(isOpen()&&!anchor.contains(event.target)&&!panel.contains(event.target))onDismiss();},options);
  return {fit:schedule,dispose};
}
