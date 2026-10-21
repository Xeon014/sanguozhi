// Read reviewed quotations in place; no summaries, facts or dates are inferred.
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
      <details class="reading-more" id="inline-more-${esc(id)}"><summary>${text('进一步查阅')}</summary><a href="#/events/${encodeURIComponent(event.id)}">${text('史事详情')} →</a></details>
      <div class="reading-actions"><button type="button" class="close-inline">${text('收起记载')}</button></div>
    </details>${role?`<p class="event-role">${text(role)}</p>`:''}
    ${event.time.precision==='relative'&&event.time.after?`<p class="relative-context">${text('相对时间；具体年份及与其他史事的先后未详。')}</p>`:''}
  </div></article>`;
}

export function mountInlineReading(root,{data,text,url,sourceLabel,fields=[],onChange=()=>{}}) {
  const events=new Map(data.events.map(e=>[e.id,e]));
  const quote=r=>`<figure class="inline-source"><figcaption>${text(sourceLabel(r))}</figcaption><blockquote>${text(r.quote)}</blockquote><a class="evidence-link" href="${url(r.section,r.block)}">${text('阅读全文')} ↗</a></figure>`;
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
}
