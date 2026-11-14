(() => {
  const $=selector=>document.querySelector(selector);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=(value,currency='CHF')=>new Intl.NumberFormat('fr-CH',{style:'currency',currency}).format(value);
  const table=(headers,rows)=>`<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  let accounts=[];
  function render(data){
    const known=new Map((data.accounts||[]).map(account=>[account.id,account]));
    for(const document of data.documents||[])if(document.accountId&&!known.has(document.accountId))known.set(document.accountId,{id:document.accountId,clientNumber:document.clientNumber,currency:(data.operations||[]).find(operation=>operation.account===document.accountId)?.currency||'CHF'});
    accounts=[...known.values()];
    const clients=[...new Set(accounts.map(account=>account.clientNumber).filter(Boolean))];
    $('#known-bank-accounts').innerHTML=[...accounts.map(account=>`<option value="${escape(account.id)}">${escape(account.name||account.id)}</option>`),...clients.map(client=>`<option value="client:${escape(client)}">Client ${escape(client)}</option>`)].join('');
    $('#bank-accounts-list').innerHTML=accounts.length?`<table><thead><tr><th>Compte / client</th><th>Nom</th><th>Titulaire attribué</th><th></th></tr></thead><tbody>${accounts.map((account,index)=>`<tr><td>${escape(account.id)}</td><td>${escape((account.name||'')+(account.kind==='savings'?' · Épargne':''))}</td><td>${escape(account.holder||'Non attribué')}</td><td><button type="button" class="secondary" data-edit-account="${index}">Modifier</button></td></tr>`).join('')}</tbody></table>`:'<p class="muted">Les comptes apparaîtront ici après import. Vous pouvez aussi saisir une attribution client dès maintenant.</p>';
  }
  $('#bank-accounts-list').addEventListener('click',event=>{
    const button=event.target.closest('[data-edit-account]');if(!button)return;
    const account=accounts[Number(button.dataset.editAccount)],form=$('#account-form');
    for(const field of ['id','name','holder','currency','kind','iban'])form.elements[field].value=account[field]||(field==='currency'?'CHF':field==='kind'?'current':'');
    form.elements.holder.focus();
  });
  $('#account-form').onsubmit=event=>{
    event.preventDefault();if(!requireStorage())return;
    const values=Object.fromEntries(new FormData(event.target));
    action(async()=>{await api('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});await load();message('Attribution enregistrée : les titulaires des opérations sont actualisés.');});
  };
  $('#reconciliation-end').value=MyComptaPeriod.previousMonth();
  $('#reconciliation-start').value=$('#reconciliation-end').value.slice(0,4)+'-01';
  async function loadReconciliation(){
    if(!state.status.connected||!state.status.ready){$('#reconciliation-results').innerHTML='<p class="banner">Connectez votre espace Google pour rapprocher les opérations.</p>';return;}
    const start=$('#reconciliation-start').value,end=$('#reconciliation-end').value;
    const data=await api('/api/reconciliation?'+new URLSearchParams({start,end}));
    const cards=data.cards.map(card=>`<article class="panel"><h2>${escape(card.network)} : règlements bancaires et relevés de carte</h2><p>${card.documentCount} relevé(s) de carte sur la période, ${card.unknownMonths} sans mois identifié.</p>${card.totals.length?table(['Devise','Règlements bancaires','Achats − remboursements des relevés','Écart','Contrôle'],card.totals.map(total=>[total.currency,money(total.paid,total.currency),money(total.billed,total.currency),money(total.difference,total.currency),!total.comparable?'Pièces / paiements manquants':Math.abs(total.difference)<.005?'Montants concordants':'Écart à expliquer'])):'<p class="muted">Aucune donnée de paiement ou de relevé sur la période.</p>'}<p class="footnote">Comparaison des paiements datés dans la période et des opérations des factures du même mois. Un paiement peut régler une facture du mois précédent, être partiel ou couvrir plusieurs factures : un écart n’est pas automatiquement une erreur. Les frais/soldes non repris dans le détail peuvent aussi créer un écart.</p></article>`).join('');
    const annual=`<article class="panel"><h2>Annuel et mensuels UBS</h2>${data.annual.length?data.annual.map(item=>`<div class="bank-annual"><strong>${escape(accountName(item.account))} · ${escape(item.periodStart)} → ${escape(item.periodEnd)}</strong><p>${item.monthlyCount} relevé(s) mensuel(s) disponible(s). Mois manquants : ${escape(item.missingMonths.join(", ")||"aucun")}. À l’import annuel : ${item.report.matched||0} ligne(s) retrouvée(s), ${item.report.added||0} ajoutée(s), ${item.report.unmatchedExisting||0} ligne(s) existante(s) absente(s) de l’annuel et conservée(s).</p>${table(['Contrôle','Débits','Crédits'],[['Annuel',money(item.report.debitTotal||0,item.currency||'CHF'),money(item.report.creditTotal||0,item.currency||'CHF')],['Mensuels disponibles',money(item.monthlyDebit,item.currency||'CHF'),money(item.monthlyCredit,item.currency||'CHF')]])}<p class="footnote">La comparaison des totaux ne valide une année que si tous ses mois sont disponibles. L’annuel complète les opérations manquantes sans supprimer les lignes existantes.</p></div>`).join(''):'<p class="muted">Aucun relevé annuel UBS dans cette période.</p>'}</article>`;
    const transfers=`<article class="panel"><h2>Virements entre comptes : propositions uniques</h2><p class="footnote">Même montant et devise, comptes différents, sens opposés et dates à 5 jours maximum. Ce sont des propositions à contrôler ; aucune suppression ni fusion automatique. Les virements sans contrepartie restent exclus des dépenses : corrigez leur type s’il s’agit d’un revenu ou d’une dépense externe.</p>${data.pairs.length?table(['Date débit','Depuis','Vers','Date crédit','Montant'],data.pairs.map(pair=>[pair.debit.date,accountName(pair.debit.account),accountName(pair.credit.account),pair.credit.date,money(pair.debit.amount,pair.debit.currency)])):'<p>Aucune paire unique proposée.</p>'}<h3>Sans contrepartie unique (${data.unmatched.length})</h3>${table(['Date','Compte','Sens','Montant','Correspondances possibles'],data.unmatched.map(operation=>[operation.date,accountName(operation.account),operation.bankDirection==='debit'?'Sortie':operation.bankDirection==='credit'?'Entrée':'Sens à préciser',money(operation.amount,operation.currency),operation.candidateCount]))}</article>`;
    $('#reconciliation-results').innerHTML=annual+cards+transfers;
  }
  $('#reconciliation-form').onsubmit=event=>{event.preventDefault();action(loadReconciliation);};
  for(const id of ['reconciliation-start','reconciliation-end'])$('#'+id).onchange=()=>action(loadReconciliation);
  window.MyComptaBank={render,load:loadReconciliation};
})();
