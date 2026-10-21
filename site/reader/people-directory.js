// Directory categories are reviewed reading choices, separate from identity facts.
export function directoryPeople(data, visible, profiles, qs, normalize=s=>String(s).toLowerCase()) {
  const byId=new Map(data.persons.map(p=>[p.id,p]));
  const listed=visible===null?data.persons:visible.map(entry=>byId.get(entry.id));
  if(listed.some(p=>!p)||new Set(listed.map(p=>p.id)).size!==listed.length)throw Error('人物展示名单无效');
  const faction=qs.get('faction')||'',needle=normalize(qs.get('q')||'');
  return listed.filter(p=>(!faction||profiles[p.id]?.directory?.faction===faction)&&
    [p.name,...p.facts.filter(f=>f.label==='字').map(f=>f.text),...(p.aliases||[]).map(a=>a.text)]
      .some(value=>normalize(value).includes(needle)));
}
