import {quoteText} from './event-reading.js?v=bc51b5632c56d390';
// Read reviewed quotations in place; no summaries, facts or dates are inferred.
export function citationText(record,text,tag='blockquote',className='') {
  return `<${tag} class="${className}" data-quote-ref="${text(record.ids?.[0]||record.id)}"><span role="status">${text('正在载入…')}</span></${tag}>`;
}

export function mountCitationText(root,{data,text,loadSection,onChange=()=>{}}) {
  const records=new Map(data.evidence.map(r=>[r.id,r])),pending=new Map();
  const read=id=>{
    if(!pending.has(id))pending.set(id,(async()=>{
      const record=records.get(id);if(!record)throw Error('未找到对应文献记载');
      const sections=loadSection?{[record.section]:await loadSection(record.section)}:{};
      return quoteText(record,sections);
    })().catch(error=>{pending.delete(id);throw error;}));
    return pending.get(id);
  };
  const fill=async el=>{
    if(el.dataset.quoteState==='loading')return read(el.dataset.quoteRef).catch(()=>{});
    if(el.dataset.quoteState||!el.getClientRects().length)return;
    el.dataset.quoteState='loading';
    try{
      const value=await read(el.dataset.quoteRef);if(!root.contains(el))return;
      el.innerHTML=text(value);el.dataset.quoteState='ready';
    }catch{
      if(!root.contains(el))return;
      el.dataset.quoteState='error';el.innerHTML=`<span role="alert">${text('文献暂无法载入。')} <button type="button" class="retry-citation">${text('重试')}</button></span>`;
    }
    onChange();
  };
  const hydrate=()=>Promise.all([...root.querySelectorAll('[data-quote-ref]')].map(fill));
  root.citationReady=hydrate;
  root.addEventListener('toggle',hydrate,true);
  root.addEventListener('click',event=>{
    const close=event.target.closest('.close-quote');
    if(close){event.preventDefault();const details=close.closest('.source-quote');details.open=false;const summary=details.querySelector('summary');summary.focus({preventScroll:true});summary.scrollIntoView({block:'nearest'});onChange();return;}
    const retry=event.target.closest('.retry-citation');if(!retry)return;
    event.preventDefault();event.stopPropagation();const el=retry.closest('[data-quote-ref]');delete el.dataset.quoteState;fill(el);
  });
  new MutationObserver(hydrate).observe(root,{childList:true,subtree:true});
  hydrate();
}
export function exactCitations(data, ids) {
  const refs=new Map(data.evidence.map(r=>[r.id,r])),seen=new Set(),result=[];
  for(const id of ids){
    const r=refs.get(id);if(!r)throw Error('未找到对应文献记载');
    const key=JSON.stringify([r.source_sha256,r.section,r.block,r.layer,r.attribution||'',r.start,r.end,r.quote]);
    if(!seen.has(key)){seen.add(key);result.push(r);}
  }
  return result;
}

export function eventCitations(data,event) {
  return exactCitations(data,event.accounts.flatMap(a=>a.evidence));
}

export function inlineEventRow(event,{text,esc,dateText,person='',id='event-card-'+event.id,className='person-event'}) {
  const role=person?event.participants.find(p=>p.person===person)?.role:'';
  return `<article class="${className}" id="${esc(id)}" data-context tabindex="-1"><p class="event-date">${text(dateText(event.time))}</p><div>
    <details class="inline-event" id="inline-${esc(id)}" data-inline-event="${esc(event.id)}"><summary>${text(event.title)}</summary>
      <div class="inline-evidence-body" data-inline-content></div>
      <p class="inline-detail-link"><a href="#/events/${encodeURIComponent(event.id)}">${text('史事详情')}</a></p>
      <div class="reading-actions"><button type="button" class="close-inline">${text('收起记载')}</button></div>
    </details>${role?`<p class="event-role">${text(role)}</p>`:''}
    ${event.time.precision==='relative'&&event.time.after?`<p class="relative-context">${text('相对时间；具体年份及与其他史事的先后未详。')}</p>`:''}
  </div></article>`;
}

export function mountInlineReading(root,{data,text,url,sourceLabel,fields=[],loadSection,onChange=()=>{}}) {
  const events=new Map(data.events.map(e=>[e.id,e]));
  const quote=r=>`<figure class="inline-source"><figcaption>${text(sourceLabel(r))}</figcaption>${citationText(r,text)}<a class="evidence-link" href="${url(r.section,r.block)}">${text('阅读全文')}</a></figure>`;
  const fill=details=>{
    if(!details.open||details.dataset.loaded)return;
    const event=events.get(details.dataset.inlineEvent);
    const records=details.hasAttribute('data-inline-identity')?exactCitations(data,fields.flatMap(f=>f.evidence)):event?eventCitations(data,event):[];
    const body=details.querySelector('[data-inline-content]');if(!body)return;
    body.innerHTML=records.map(quote).join('');details.dataset.loaded='true';
  };
  root.addEventListener('toggle',event=>{
    const details=event.target;if(!details.matches?.('[data-inline-event],[data-inline-identity]'))return;
    fill(details);onChange();
  },true);
  root.addEventListener('click',event=>{
    const button=event.target.closest('.close-inline');if(!button)return;
    const details=button.closest('details');details.open=false;
    const summary=details.querySelector('summary');summary.focus({preventScroll:true});summary.scrollIntoView({block:'nearest'});onChange();
  });
  root.restoreInlineReading=()=>root.querySelectorAll('[data-inline-event][open],[data-inline-identity][open]').forEach(fill);
  root.restoreInlineReading();
  mountCitationText(root,{data,text,loadSection,onChange});
}
