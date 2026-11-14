(function(root){
  const icons=['👤','👨','👩','🧑','👦','👧','👶','👥','🏠','💙','🌸','⭐','🐱','🐶','🦊','🐼'];
  const key=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleUpperCase('fr');
  const api={icons,key};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MyComptaHolderIcons=api;
})(globalThis);
