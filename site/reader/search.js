export function searchHash(type, query='') {
  const qs=new URLSearchParams();
  if(type==='people')qs.set('type','people');
  if(query.trim())qs.set('q',query.trim());
  return '#/search'+(qs.size?'?'+qs:'');
}

export function canonicalSearchHash(hash) {
  const [path,query='']=hash.split('?'),qs=new URLSearchParams(query);
  if(path==='#/people'&&(qs.get('view')==='all'||qs.has('faction')))return searchHash('people',qs.get('q')||'');
  if(path==='#/search')return searchHash(qs.get('type'),qs.get('q')||'');
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
