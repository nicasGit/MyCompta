(() => {
  const $=selector=>document.querySelector(selector),{icons,key}=MyComptaHolderIcons;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let profiles=[],holders=[];
  const form=$('#holder-profile-form');
  form.elements.icon.innerHTML=icons.map(icon=>`<option value="${icon}">${icon}</option>`).join('');
  function fill(){
    const holder=form.elements.holder.value,profile=profiles.find(row=>key(row.holder)===key(holder));
    form.elements.name.value=(profile?.name||holder).slice(0,100);form.elements.icon.value=profile?.icon||icons[0];
  }
  function render(data){
    profiles=data.holders||[];
    holders=[...new Map([...data.operations.map(row=>row.holder),...(data.accounts||[]).map(row=>row.holder),...profiles.map(row=>row.holder)].filter(Boolean).map(holder=>[key(holder),holder])).values()].sort((a,b)=>a.localeCompare(b,'fr'));
    const previous=form.elements.holder.value;
    form.elements.holder.innerHTML=holders.map(holder=>`<option>${escape(holder)}</option>`).join('');
    if(holders.includes(previous))form.elements.holder.value=previous;
    form.querySelector('button[type="submit"]').disabled=!holders.length;
    fill();
    $('#holder-profiles-list').innerHTML=holders.map((holder,index)=>{const profile=profiles.find(row=>key(row.holder)===key(holder));return `<button type="button" class="secondary holder-profile-choice" data-holder-profile="${index}"><span aria-hidden="true">${escape(profile?.icon||icons[0])}</span> ${escape(profile?.name||holder)}</button>`;}).join('')||'<p class="muted">Les titulaires apparaîtront après import ou attribution des comptes.</p>';
  }
  form.elements.holder.onchange=fill;
  $('#holder-profiles-list').onclick=event=>{const button=event.target.closest('[data-holder-profile]');if(button){form.elements.holder.value=holders[Number(button.dataset.holderProfile)];fill();form.elements.name.focus();}};
  form.onsubmit=event=>{
    event.preventDefault();if(!requireStorage())return;
    const values=Object.fromEntries(new FormData(form));
    action(async()=>{await api('/api/holders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});await load();message('Icône et libellé du titulaire enregistrés pour le foyer.');});
  };
  function badge(holder){
    const profile=profiles.find(row=>key(row.holder)===key(holder)),label=profile?.name||holder||'Titulaire non renseigné';
    const title=profile&&key(label)!==key(holder)?label+' · '+holder:label;
    return `<span class="holder-icon" role="img" tabindex="0" title="${escape(title)}" aria-label="${escape(title)}">${escape(profile?.icon||icons[0])}</span>`;
  }
  window.MyComptaHolders={render,badge};
})();
