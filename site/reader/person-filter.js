import {bindFloatingPanel} from './floating-panel.js?v=bc51b5632c56d390';
// Suggestions use explicit participation, never mentions or name inference.
export function eventPeople(data, visiblePeople, normalize) {
  const participants=new Set(data.events.flatMap(e=>e.participants.map(p=>p.person)));
  const preferred=new Set((visiblePeople||[]).map(p=>p.id));
  const evidence=new Map(data.evidence.map(e=>[e.id,e]));
  const names=new Map();
  for(const p of data.persons)names.set(normalize(p.name),(names.get(normalize(p.name))||0)+1);
  return data.persons.map(p=>{
    const courtesy=p.facts.filter(f=>f.label==='字').map(f=>f.text);
    const ref=evidence.get(p.evidence?.[0]);
    const detail=[...courtesy.map(s=>'字'+s),...(names.get(normalize(p.name))>1&&ref?[ref.section_title,ref.quote.slice(0,38)+'…']:[])].join(' · ');
    return {id:p.id,name:p.name,detail,eligible:participants.has(p.id),preferred:preferred.has(p.id),
      search:[p.name,...courtesy,...(p.aliases||[]).map(a=>a.text)].map(normalize)};
  });
}
export function personMatches(people, query, normalize) {
  const needle=normalize(query.trim());
  return people.filter(p=>p.eligible&&(needle?p.search.some(s=>s.includes(needle)):p.preferred));
}
export function mountPersonFilter(host,people,{selected,esc,cv,normalize,onSelect,restoreFocus=false}) {
  const text=s=>esc(cv(s));
  const chosen=()=>people.find(p=>p.id===selected);
  host.innerHTML=`<label for="person-filter">${text('人物')}</label><div class="person-combo-input">
    <input id="person-filter" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="person-options" aria-describedby="person-feedback" autocomplete="off" placeholder="${text('输入姓名或字')}" value="${text(chosen()?.name||'')}">
    <button type="button" class="person-clear" aria-label="${text('清除人物筛选')}">×</button></div>
    <input type="hidden" name="person" value="${esc(selected)}"><div class="person-popup" hidden><div id="person-options" role="listbox" aria-label="${text('人物候选')}"></div>
    <p id="person-feedback" role="status"></p></div>`;
  const input=host.querySelector('[role=combobox]'),popup=host.querySelector('.person-popup'),list=host.querySelector('[role=listbox]'),status=host.querySelector('[role=status]');
  const clear=host.querySelector('.person-clear');
  const floating=bindFloatingPanel(host.querySelector('.person-combo-input'),popup,{onDismiss:()=>close()});
  let options=[],active=-1,skipFocus=restoreFocus,composing=false;
  const updateClear=()=>{clear.hidden=!selected&&!input.value;clear.setAttribute('aria-label',cv(selected?'清除人物筛选':'清除人物输入'));};
  function close(restore=true){
    popup.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;
    if(restore)input.value=cv(chosen()?.name||'');
    updateClear();
  }
  function highlight(index) {
    active=index;
    [...list.children].forEach((el,i)=>el.setAttribute('aria-selected',String(i===active)));
    if(active>=0){input.setAttribute('aria-activedescendant',list.children[active].id);list.children[active].scrollIntoView({block:'nearest'});}
    else input.removeAttribute('aria-activedescendant');
  }
  function open(query='') {
    const matches=personMatches(people,query,normalize);
    options=query.trim()?matches.slice(0,60):[{id:'',name:'全部人物',detail:''},...matches];
    if(!query.trim()&&selected&&!options.some(p=>p.id===selected)&&chosen())options.splice(1,0,chosen());
    list.innerHTML=options.map((p,i)=>`<div role="option" id="person-option-${i}" aria-selected="false" data-index="${i}"><span>${text(p.name)}</span>${p.detail?`<small>${text(p.detail)}</small>`:''}</div>`).join('');
    status.textContent=cv(query.trim()?(matches.length?`找到 ${matches.length} 位人物${matches.length>60?'，显示前 60 位，请继续输入以缩小范围':''}`:'未找到人物，可尝试姓名、字或其他称谓。'):'常用人物；输入可查找更多人物。');
    popup.hidden=false;input.setAttribute('aria-expanded','true');highlight(-1);updateClear();floating.fit();
  }
  function choose(person) {
    selected=person.id;host.querySelector('[name=person]').value=selected;close();
    onSelect();
  }
  input.onfocus=()=>{if(skipFocus){skipFocus=false;return;}open();};
  input.onclick=()=>{if(popup.hidden)open();};
  input.oninput=()=>{if(!composing)open(input.value);};
  input.oncompositionstart=()=>{composing=true;};
  input.oncompositionend=()=>{composing=false;open(input.value);};
  input.onkeydown=e=>{
    if(e.isComposing||composing){if(e.key==='Enter')e.preventDefault();return;}
    if(['ArrowDown','ArrowUp'].includes(e.key)){
      e.preventDefault();if(popup.hidden)open();
      if(options.length)highlight(active<0?(e.key==='ArrowDown'?0:options.length-1):(active+(e.key==='ArrowDown'?1:-1)+options.length)%options.length);
    }else if(e.key==='Enter'){
      e.preventDefault();if(!popup.hidden&&active>=0)choose(options[active]);
      else if(!popup.hidden&&options.length===1)choose(options[0]);
      else if(popup.hidden)open();else status.textContent=cv('请用方向键或点击选择具体人物。');
    }else if(e.key==='Escape'){e.preventDefault();close();}
  };
  list.onmousedown=e=>e.preventDefault();
  list.onclick=e=>{const option=e.target.closest('[data-index]');if(option)choose(options[Number(option.dataset.index)]);};
  clear.onclick=()=>{if(selected)choose({id:''});else{input.value='';close(false);input.focus({preventScroll:true});}};
  host.addEventListener('focusout',e=>{if(!host.contains(e.relatedTarget))close();});
  updateClear();
}
