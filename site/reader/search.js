export function searchHash(type, query='', book='') {
  const qs=new URLSearchParams();
  if(type==='people')qs.set('type','people');
  if(query.trim())qs.set('q',query.trim());
  if(type!=='people'&&book)qs.set('book',book);
  return '#/search'+(qs.size?'?'+qs:'');
}

// Match displayed text while retaining its original characters and offsets.
export function highlightText(value, query, normalize, escape) {
  const needle=normalize(query);if(!needle)return escape(value);
  const chars=[...value],folded=chars.map(normalize),offsets=[];let size=0;
  for(let i=0;i<chars.length;i++){offsets.push(size);size+=folded[i].length;}
  const haystack=folded.join('');let at=0,end=0,html='';
  while((at=haystack.indexOf(needle,at))>=0){
    const first=offsets.findIndex((p,i)=>p+folded[i].length>at);
    let last=first;while(last<chars.length&&offsets[last]<at+needle.length)last++;
    if(first<end){at+=needle.length;continue;}
    html+=escape(chars.slice(end,first).join(''))+'<mark class="search-match">'+escape(chars.slice(first,last).join(''))+'</mark>';
    end=last;at+=needle.length;
  }
  return html+escape(chars.slice(end).join(''));
}

export function canonicalSearchHash(hash) {
  const [path,query='']=hash.split('?'),qs=new URLSearchParams(query);
  // Unknown book ids are dropped by the search page against site collections.
  if(path==='#/people'&&(qs.get('view')==='all'||qs.has('faction')))return searchHash('people',qs.get('q')||'');
  if(path==='#/search')return searchHash(qs.get('type'),qs.get('q')||'',qs.get('book')||'');
  return hash;
}

export function searchPeople(persons, query, normalize=s=>s.normalize('NFKC').toLowerCase()) {
  const q=normalize(query.trim());if(!q)return [];
  const collator=new Intl.Collator('zh-Hans-CN-u-co-pinyin');
  return persons.map(p=>{
    const name=normalize(p.name),terms=[...p.courtesy,...p.aliases].map(normalize);
    const rank=name===q?0:terms.includes(q)?1:name.includes(q)||terms.some(t=>t.includes(q))?2:3;
    return {p,rank};
  }).filter(r=>r.rank<3).sort((a,b)=>a.rank-b.rank||collator.compare(normalize(a.p.name),normalize(b.p.name))||(a.p.id<b.p.id?-1:a.p.id>b.p.id?1:0)).map(r=>r.p);
}
