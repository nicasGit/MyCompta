(() => {
  const $=selector=>document.querySelector(selector);
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const monthNames=['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
  let operations=[];
  function render(next) {
    operations=next;
    const year=$('#balance-year').value||String(new Date().getFullYear()),currency=$('#balance-currency').value||'CHF';
    const years=[...new Set([String(new Date().getFullYear()),...next.map(o=>o.date.slice(0,4))])].sort().reverse();
    const currencies=[...new Set(['CHF',...next.map(o=>o.currency)])].sort();
    $('#balance-year').innerHTML=years.map(value=>`<option>${esc(value)}</option>`).join('');
    $('#balance-year').value=years.includes(year)?year:years[0];
    $('#balance-currency').innerHTML=currencies.map(value=>`<option>${esc(value)}</option>`).join('');
    $('#balance-currency').value=currencies.includes(currency)?currency:'CHF';
    draw();
  }
  function draw() {
    const year=$('#balance-year').value,currency=$('#balance-currency').value;
    const data=MyComptaBalanceData.aggregate(operations,year,currency);
    const money=value=>new Intl.NumberFormat('fr-CH',{style:'currency',currency}).format(value);
    $('#balance-summary').innerHTML=[['Recettes',data.income,'income'],['Dépenses',data.expenses,'expenses'],['Recettes − dépenses',data.net,data.net>=0?'positive':'negative']].map(([label,value,kind])=>`<div class="balance-stat ${kind}"><span>${label}</span><strong>${esc(money(value))}</strong></div>`).join('');
    const max=Math.max(1,...data.months.flatMap(row=>[row.income,row.expenses]));
    const ceiling=Math.ceil(max/5/10)*10*5||5, width=900,height=330,left=90,top=20,bottom=285,plotHeight=bottom-top;
    const grid=Array.from({length:6},(_,i)=>{const value=ceiling*i/5,y=bottom-plotHeight*i/5;return `<line x1="${left}" y1="${y}" x2="890" y2="${y}" stroke="#dce5f2"/><text x="80" y="${y+4}" text-anchor="end">${esc(new Intl.NumberFormat('fr-CH',{maximumFractionDigits:0}).format(value))}</text>`;}).join('');
    const bars=data.months.map((row,index)=>{
      const x=left+index*66+12;
      return `<g><text x="${x+19}" y="310" text-anchor="middle">${monthNames[index]}</text>${[['income',row.income,0,'#258466'],['expenses',row.expenses,22,'#3974c5']].map(([kind,value,offset,color])=>{const h=value/ceiling*plotHeight;return `<rect x="${x+offset}" y="${bottom-h}" width="18" height="${h}" rx="3" fill="${color}"><title>${monthNames[index]} ${year} · ${kind==='income'?'Recettes':'Dépenses'} : ${esc(money(value))}</title></rect>`;}).join('')}</g>`;
    }).join('');
    $('#balance-chart').innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="balance-chart-title balance-chart-description"><title id="balance-chart-title">Recettes et dépenses par mois en ${esc(currency)}, ${esc(year)}</title><desc id="balance-chart-description">Barres vertes pour les recettes, bleues pour les dépenses. Montants détaillés dans le tableau ci-dessous.</desc>${grid}${bars}</svg>`;
    const totalRow=(label,income,expenses,net)=>`<tr><th scope="row">${esc(label)}</th><td class="amount">${esc(money(income))}</td><td class="amount">${esc(money(expenses))}</td><td class="amount ${net<0?'balance-negative':'balance-positive'}">${esc(money(net))}</td></tr>`;
    $('#balance-months').innerHTML=`<table><caption>Bilan mensuel ${esc(year)} · ${esc(currency)}</caption><thead><tr><th>Mois</th><th class="amount">Recettes</th><th class="amount">Dépenses</th><th class="amount">Différence</th></tr></thead><tbody>${data.months.map(row=>totalRow(new Intl.DateTimeFormat('fr-CH',{month:'long'}).format(new Date(Number(year),row.month-1,1)),row.income,row.expenses,row.net)).join('')}</tbody><tfoot>${totalRow('Total annuel',data.income,data.expenses,data.net)}</tfoot></table>`;
    $('#balance-status').textContent=data.months.some(row=>row.count)?`${data.months.filter(row=>row.count).length} mois avec des opérations incluses sur 12.`:'Aucune recette ou dépense enregistrée pour cette année et cette devise.';
  }
  $('#balance-year').onchange=draw;
  $('#balance-currency').onchange=draw;
  window.MyComptaBalance={render};
})();
