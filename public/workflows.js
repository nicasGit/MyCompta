(() => {
  const $=selector=>document.querySelector(selector);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let dropped=[];
  let inboxItems=new Map();
  function updateInboxCount(count){
    const nav=$('.nav[data-view="importerrors"]');
    $('#import-inbox-count').textContent=String(count);
    nav.hidden=count===0;
    nav.setAttribute('aria-label',`Imports en erreur : ${count} PDF en attente`);
  }
  async function refreshInboxCount(){
    if(!state.status.connected){updateInboxCount(0);return;}
    try{const {count}=await api('/api/import-inbox?summary=1');updateInboxCount(count);}catch{}
  }
  function correctionEditor(item,row,reason=''){
    if(!row.rowId||!row.values)return '';
    const values={...row.values,...(item.corrections||[]).find(patch=>patch.rowId===row.rowId)},form='retry-'+item.id;
    const field=(key,label,type,extra='')=>`<label>${label}${values[key]===null?' (à renseigner)':''}<input form="${form}" name="${escape(row.rowId+'-'+key)}" data-correction-field="${key}" type="${type}" value="${escape(values[key]??'')}" ${extra}></label>`;
    return `<fieldset class="correction-row" data-correction-row="${escape(row.rowId)}"><legend>Page ${Number(row.page)||1} · ${escape(row.label||'Ligne à compléter')}</legend>${reason?`<p class="muted">${escape(reason)}</p>`:''}<div class="form-grid">${field('date','Date du mouvement','date',`required min="${escape(item.diagnostics.periodStart)}" max="${escape(item.diagnostics.periodEnd)}"`)}${field('bookingDate','Date de valeur','date')}${field('label','Libellé','text','required maxlength="500"')}${field('amount','Montant positif','number','required min="0.01" max="1000000000" step="0.01"')}<label>Sens du mouvement<select form="${form}" name="${escape(row.rowId+'-bankDirection')}" data-correction-field="bankDirection" required><option value="">À choisir</option><option value="debit"${values.bankDirection==='debit'?' selected':''}>Débit / sortie</option><option value="credit"${values.bankDirection==='credit'?' selected':''}>Crédit / entrée</option></select></label></div></fieldset>`;
  }
  const input=$('#upload-form').elements.pdf,zone=$('#pdf-dropzone');
  function clearFiles(){dropped=[];input.required=true;$('#dropped-files').textContent='';}
  function select(files){
    dropped=Array.from(files);input.required=!dropped.length;
    $('#dropped-files').textContent=dropped.length+' PDF sélectionné(s) : '+dropped.map(file=>file.name).join(', ')+'. Cliquez sur Importer pour démarrer.';
  }
  zone.onclick=()=>input.click();
  zone.onkeydown=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();input.click();}};
  for(const type of ['dragenter','dragover'])zone.addEventListener(type,event=>{event.preventDefault();zone.classList.add('dragging');});
  zone.ondragleave=()=>zone.classList.remove('dragging');
  zone.ondrop=event=>{event.preventDefault();zone.classList.remove('dragging');if(state.busy)return;select(event.dataTransfer.files);};
  input.onchange=()=>select(input.files);
  async function loadInbox(){
    const {items}=await api('/api/import-inbox');
    updateInboxCount(items.length);
    inboxItems=new Map(items.map(item=>[item.id,item]));
    $('#import-inbox-list').innerHTML=items.length?items.map(item=>{
      const diagnostic=item.diagnostics,totals=diagnostic?.totals;
      const checks=totals?'<p>'+Object.entries(totals).map(([key,value])=>`${key==='debit'?'Débits':'Crédits'} : extrait ${escape(value.actual)} / attendu ${escape(value.expected??'illisible')} ${escape(diagnostic.currency)}`).join(' · ')+'</p>':'';
      const issues=(diagnostic?.issues||[]).map(issue=>`<li><a href="/api/import-inbox/${escape(item.id)}/pdf#page=${Number(issue.page)||1}" target="_blank" rel="noopener">Page ${Number(issue.page)||1}</a> · ${escape(issue.date)} · ${escape(issue.label)}<p>${escape(issue.reason)}</p><pre>${escape(issue.raw)}</pre>${correctionEditor(item,issue,issue.reason)}</li>`).join('');
      const issueIds=new Set((diagnostic?.issues||[]).map(issue=>issue.rowId));
      const otherRows=(diagnostic?.rows||[]).filter(row=>!issueIds.has(row.rowId));
      const others=otherRows.length?`<details${issueIds.size?"":" open"}><summary>Vérifier ou corriger les lignes extraites (${otherRows.length})</summary>${otherRows.map(row=>correctionEditor(item,row)).join('')}</details>`:'';
      return `<article class="panel"><h2>${escape(item.name)}</h2><p class="muted">${item.createdAt?"Déposé le "+escape(importDate(item.createdAt)):"Date du dépôt initial non enregistrée"} · Dernière tentative le ${escape(importDate(item.updatedAt))}</p><p class="banner${item.ready?"":" error"}">${escape(item.error)}</p>${checks}${issues?`<details open><summary>Lignes à examiner (${diagnostic.issues.length})</summary><ul class="import-issues">${issues}</ul></details>`:''}${others}<p class="footnote">Les valeurs reconnues sont préremplies. Recopiez les valeurs du PDF : les totaux imprimés seront de nouveau contrôlés avant l’import. Les corrections sont conservées si un autre problème reste à corriger.</p><p><a href="/api/import-inbox/${escape(item.id)}/pdf" target="_blank" rel="noopener">Ouvrir le PDF original ↗</a></p><form id="retry-${escape(item.id)}" class="upload-form" data-retry-import="${escape(item.id)}"><label>Banque<select name="source">${['Auto','UBS','PostFinance','Cembra','TopCard','Autre'].map(source=>`<option value="${source}"${source===item.source?' selected':''}>${source==='Auto'?'Détection automatique':source}</option>`).join('')}</select></label>${diagnostic?.canImportPartial?`<label class="partial-import-choice"><input type="checkbox" name="allowPartial">Ignorer les pages signalées et importer uniquement les ${Number(diagnostic.detectedCount)||0} lignes détectées, sans validation des totaux du relevé.</label>`:""}<label>PDF corrigé (facultatif)<input name="replacement" type="file" accept="application/pdf,.pdf"></label><button class="primary" type="submit">Appliquer les corrections et réessayer</button><button class="secondary" type="button" data-delete-import="${escape(item.id)}">Supprimer de la zone tampon</button></form></article>`;
    }).join(''):'<article class="panel"><p>Aucun PDF en attente. Les imports réussis sont dans Documents.</p></article>';
  }
  $('#refresh-inbox').onclick=()=>action(loadInbox);
  for(const type of ['input','change'])$('#import-inbox-list').addEventListener(type,event=>{const row=event.target.closest('[data-correction-row]');if(row)row.dataset.edited='true';});
  $('#import-inbox-list').addEventListener('change',event=>{
    const form=event.target.form;if(!form?.dataset.retryImport)return;
    const disabled=Boolean(form.elements.replacement.files.length)||!['Auto','UBS'].includes(form.elements.source.value);
    for(const field of form.closest('article').querySelectorAll('[data-correction-field]'))field.disabled=disabled;
  });
  $('#import-inbox-list').addEventListener('click',event=>{
    const button=event.target.closest('[data-delete-import]');
    if(button&&window.confirm('Supprimer ce PDF de la zone tampon ?'))action(async()=>{await api('/api/import-inbox/'+button.dataset.deleteImport,{method:'DELETE'});await loadInbox();});
  });
  $('#import-inbox-list').addEventListener('submit',event=>{
    const form=event.target.closest('[data-retry-import]');if(!form)return;event.preventDefault();if(!requireStorage())return;
    action(async()=>{
      try{
        const id=form.dataset.retryImport,file=form.elements.replacement.files[0],source=form.elements.source.value;
        if(file){
          if(file.size>15*1024*1024)throw new Error('Ce fichier dépasse 15 Mo.');
          await api('/api/documents?'+new URLSearchParams({source,name:file.name}),{method:'POST',headers:{'Content-Type':'application/pdf'},body:file});
          const {items}=await api('/api/import-inbox');if(items.some(item=>item.id===id))await api('/api/import-inbox/'+id,{method:'DELETE'});
        }else{
          const corrections=new Map((inboxItems.get(id)?.corrections||[]).map(patch=>[patch.rowId,patch]));
          for(const row of form.closest('article').querySelectorAll('[data-correction-row][data-edited="true"]')){
            const patch={rowId:row.dataset.correctionRow};
            for(const input of row.querySelectorAll('[data-correction-field]'))patch[input.dataset.correctionField]=input.type==='number'?Number(input.value):input.value;
            corrections.set(patch.rowId,patch);
          }
          await api('/api/import-inbox/'+id+'/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source,allowPartial:form.elements.allowPartial?.checked===true,corrections:source==='UBS'||source==='Auto'?[...corrections.values()]:[]})});
        }
        await load();await loadInbox();message('Import traité. Le PDF est sorti de la zone tampon.');
      }catch(error){await loadInbox();throw error;}
    });
  });
  function renderSavings(){
    const accounts=(state.data.accounts||[]).filter(account=>account.kind==='savings'),selector=$('#savings-account'),previous=selector.value;
    selector.innerHTML='<option value="">Tous les comptes épargne</option>'+accounts.map(account=>`<option value="${escape(account.id)}">${escape(account.name||account.id)}</option>`).join('');
    if(accounts.some(account=>account.id===previous))selector.value=previous;
    const movements=state.data.operations.filter(operation=>operation.isSavings&&operation.status!=='ignored'&&MyComptaPeriod.matches(operation.date,selectedPeriod())&&(!selector.value||operation.savingsAccount===selector.value)).sort((a,b)=>b.date.localeCompare(a.date));
    const totals=accounts.filter(account=>!selector.value||selector.value===account.id).map(account=>{
      const direct=movements.filter(operation=>operation.account===account.id),currencies=[...new Set(direct.map(operation=>operation.currency))];
      return `<article class="panel"><h2>${escape(account.name||account.id)}</h2><p class="muted">${escape(account.id)}</p>${currencies.length?currencies.map(currency=>{
        const sum=direction=>direct.filter(operation=>operation.currency===currency&&operation.bankDirection===direction).reduce((sum,operation)=>sum+Math.round(operation.amount*100),0)/100;
        return `<p>Entrées : <strong>${escape(money(sum('credit'),currency))}</strong> · Sorties : ${escape(money(sum('debit'),currency))} · Variation : <strong>${escape(money(sum('credit')-sum('debit'),currency))}</strong></p>`;
      }).join(''):'<p>Aucun mouvement du relevé de ce compte sur la période. Les contreparties seules figurent ci-dessous.</p>'}<p class="footnote">Flux de la période, pas le solde du compte. Les mouvements sans sens bancaire restent dans le détail.</p></article>`;
    }).join('');
    $('#savings-results').innerHTML=totals+(movements.length?`<article class="panel"><h2>Détail des mouvements (${movements.length})</h2><p class="footnote">Les deux côtés d’un transfert peuvent apparaître ; les totaux ci-dessus utilisent uniquement le côté du compte épargne.</p><div class="table-wrap">${operationTable(movements)}</div></article>`:'<article class="panel"><p>Aucun mouvement épargne sur cette période. Marquez vos comptes dans Paramètres.</p></article>');
  }
  $('#savings-account').onchange=renderSavings;
  window.MyComptaWorkflows={loadInbox,refreshInboxCount,renderSavings,files:()=>dropped.length?dropped:Array.from(input.files),clearFiles};
})();
