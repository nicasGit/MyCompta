const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function date(text) {
  const match = String(text).trim().match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
  if (!match) return '';
  const result = `${match[3].length === 2 ? '20' + match[3] : match[3]}-${match[2]}-${match[1]}`;
  return Number.isFinite(Date.parse(result)) && new Date(result).toISOString().slice(0, 10) === result ? result : '';
}
function amount(text) {
  const value = String(text).replace(/[\s'’]/g, '');
  return /^-?\d+[.,]\d{2}$/.test(value) ? Number(value.replace(',', '.')) : NaN;
}
function balanceAmount(text){
  const value=String(text).replace(/[\s'’]/g,'').replace(/[−–]/g,'-');
  if(!/^-?\d+(?:[.,]\d{2})?-?$/.test(value)||value.startsWith('-')&&value.endsWith('-'))return NaN;
  return Number((value.endsWith('-')?'-'+value.slice(0,-1):value).replace(',','.'));
}
function groupRows(items) {
  const rows = [];
  for (const item of [...items].filter(item => item.text.trim()).sort((a,b) => b.y-a.y || a.x-b.x)) {
    let row = rows.find(row => Math.abs(row.y-item.y)<2);
    if (!row) { row={y:item.y,items:[]}; rows.push(row); }
    row.items.push(item);
  }
  return rows.map(row=>({...row,text:row.items.map(item=>item.text).join(' ')}));
}
function parseUBSPages(pages, {corrections=[]}={}) {
  const patches=new Map();
  if(!Array.isArray(corrections)||corrections.length>2000)throw Object.assign(new Error('Corrections invalides.'),{status:400});
  for(const patch of corrections){
    if(!patch||typeof patch.rowId!=='string'||patches.has(patch.rowId)||Object.keys(patch).some(key=>!['rowId','date','label','amount','bankDirection','bookingDate','bankBalance'].includes(key)))throw Object.assign(new Error('Correction de ligne invalide.'),{status:400});
    patches.set(patch.rowId,patch);
  }
  const used=new Set(),reviewRows=[];
  const first = groupRows(pages[0]?.items || []).map(row=>row.text).join('\n');
  const accountNumber = /No\s+de\s+compte\s+(\d{3}-\d+\.[A-Z0-9]+)/i.exec(first)?.[1] || '';
  const clientNumber = /No\s+de\s+client\s+(\d{3}-\d+)/i.exec(first)?.[1] || '';
  const period = /(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})\s*\/\s*(Annuelle|Mensuelle)/i.exec(first);
  if (!accountNumber || !period) throw Object.assign(new Error('Ce PDF UBS ne contient pas un relevé de compte mensuel ou annuel identifiable.'), {status:422});
  const periodStart=date(period[1]),periodEnd=date(period[2]);
  if (!periodStart || !periodEnd || periodStart>periodEnd) throw Object.assign(new Error('Période UBS invalide.'),{status:422});
  const currency=/Compte[^\n]*\b(CHF|EUR|USD|GBP)\b/.exec(first)?.[1] || '';
  if (!currency) throw Object.assign(new Error('Devise du compte UBS non reconnue.'),{status:422});
  const orderedFirst=(pages[0]?.items || []).map(item=>item.text).join('\n');
  const explicitHolder=/Titulaire\s+([^\n]+)/i.exec(orderedFirst)?.[1];
  const jointHolder=/Madame\s*\n([^]*?)(?=\n(?:Chemin|Rue|Route|Avenue|Case postale)\b)/i.exec(orderedFirst)?.[1];
  const holder=(explicitHolder || jointHolder || '').replace(/\bMonsieur\b/g,'').replace(/\s+/g,' ').trim().slice(0,150);
  const account='UBS '+accountNumber;
  const metadata={accountId:account,clientNumber,periodStart,periodEnd,statementKind:/annuelle/i.test(period[3])?'annual':'monthly',
    statementMonth:/mensuelle/i.test(period[3])?periodEnd.slice(0,7):'',currency,holder,
    iban:(/IBAN\s+(CH[^\n]+)/.exec(first)?.[1] || '').replace(/\s/g,'')};
  const operations=[],issues=[];
  let rejected=0,block=null;
  const finish=()=>{
    if (!block) return;
    const patch=patches.get(block.rowId);
    if(patch){
      used.add(block.rowId);
      for(const key of ['date','bookingDate'])if(key in patch){if(typeof patch[key]!=='string')throw Object.assign(new Error('Date corrigée invalide.'),{status:400});if((key==='date'||patch[key])&&(!/^\d{4}-\d{2}-\d{2}$/.test(patch[key])||!Number.isFinite(Date.parse(patch[key]))||new Date(patch[key]).toISOString().slice(0,10)!==patch[key]))throw Object.assign(new Error('Date corrigée invalide.'),{status:400});block[key]=patch[key];}
      if('label' in patch){if(typeof patch.label!=='string'||!patch.label.trim()||patch.label.length>500)throw Object.assign(new Error('Libellé corrigé invalide.'),{status:400});block.heading=patch.label.trim();}
      for(const key of ['amount','bankBalance'])if(key in patch){const value=patch[key];if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e9||(key==='amount'&&Math.round(value*100)<1))throw Object.assign(new Error('Montant ou solde corrigé invalide.'),{status:400});block[key]=Math.round(value*100)/100;}
      if('bankDirection' in patch){if(!['debit','credit'].includes(patch.bankDirection))throw Object.assign(new Error('Sens bancaire corrigé invalide.'),{status:400});block.bankDirection=patch.bankDirection;}
    }
    const details=block.details.filter(line=>!/^1 fois /i.test(line));
    const raw=[block.heading,...block.details].join('\n');
    const values={date:block.date,label:block.heading,amount:Number.isFinite(block.amount)?block.amount:null,bankDirection:block.bankDirection,bankBalance:Number.isFinite(block.bankBalance)?block.bankBalance:null,bookingDate:block.bookingDate};
    const review={rowId:block.rowId,page:block.page,date:block.date,label:block.heading,raw:block.original+'\n'+block.details.join('\n'),values};
    reviewRows.push(review);
    if(block.date<periodStart||block.date>periodEnd){issues.push({...review,reason:'Date hors de la période du relevé'});rejected++;block=null;return;}
    if (!Number.isFinite(block.amount) || block.amount<=0 || !block.bankDirection) {
      issues.push({...review,reason:!block.bankDirection?'Colonne débit/crédit absente ou ambiguë':'Montant absent ou invalide'});
      rejected++;block=null;return;
    }
    const text=normalize(raw);
    const paymentNetwork=block.bankDirection==='debit' && /cembra|cumulus/.test(text)?'Cembra':block.bankDirection==='debit' && /top\s*card|supercard/.test(text)?'TopCard':'';
    const transfer=/\bvirement\b|\btransfert\b/.test(text);
    const type=paymentNetwork?'card_payment':transfer?'transfer':block.bankDirection==='debit'?'expense':'income';
    operations.push({date:block.date,label:[block.heading,...details].join(' · ').slice(0,500),amount:block.amount,currency,type,account,holder,
      bankDirection:block.bankDirection,clientNumber,paymentNetwork,bookingDate:block.bookingDate,bankBalance:Number.isFinite(block.bankBalance)?String(block.bankBalance):'',page:block.page,
      raw:`${account}\n${raw}${patch?'\nLigne PDF : '+block.original+'\nCorrection manuelle : '+JSON.stringify(patch):''}`});
    block=null;
  };
  for (const page of pages) {
    const rows=groupRows(page.items);
    const index=rows.findIndex(row=>/^date\s+informations\s+debits\s+credits\s+valeur\s+solde de compte/.test(normalize(row.text)));
    if(index<0){finish();continue;}
    const header=rows[index];
    const col=label=>header.items.find(item=>normalize(item.text)===label);
    const debit=col('debits'),credit=col('credits'),valueDate=col('valeur'),description=col('informations'),day=col('date');
    const balanceParts=valueDate?header.items.filter(item=>item.x>valueDate.x+valueDate.width+1):[];
    const balance=col('solde de compte')||(normalize(balanceParts.map(item=>item.text).join(' '))==='solde de compte'?{x:balanceParts[0].x,width:balanceParts.at(-1).x+balanceParts.at(-1).width-balanceParts[0].x}:null);
    if(!debit||!credit||!balance||!valueDate||!description||!day)continue;
    for(const row of rows.slice(index+1)){
      if(row.y<90)continue;
      const plain=normalize(row.text);
      if(/^mouvement total|^decompte d|^apercu du solde/.test(plain)){finish();break;}
      const start=row.items.find(item=>Math.abs(item.x-day.x)<5&&date(item.text));
      const labelItems=row.items.filter(item=>item.x>=description.x-3&&item.x<debit.x-15);
      const label=labelItems.map(item=>item.text).join(' ');
      if(start){
        finish();
        if(/^solde (initial|final)\b/.test(normalize(label)))continue;
        const numericAt=(column,parse=amount)=>row.items.filter(item=>Number.isFinite(parse(item.text))&&Math.abs(item.x+item.width-column.x-column.width)<5);
        const debits=numericAt(debit),credits=numericAt(credit),balances=numericAt(balance,balanceAmount);
        const hasDebit=debits.length===1&&!credits.length,hasCredit=credits.length===1&&!debits.length;
        const booking=row.items.find(item=>item.x>credit.x+credit.width&&item.x<balance.x&&date(item.text));
        block={rowId:`${page.num}:${row.y.toFixed(2)}`,date:date(start.text),bookingDate:booking?date(booking.text):'',heading:label,details:[],page:page.num,original:row.text,
          amount:hasDebit?amount(debits[0].text):hasCredit?amount(credits[0].text):NaN,
          bankDirection:hasDebit?'debit':hasCredit?'credit':'',bankBalance:balances.length===1?balanceAmount(balances[0].text):NaN};
      }else if(block&&label)block.details.push(label);
    }
  }
  finish();
  if([...patches.keys()].some(key=>!used.has(key)))throw Object.assign(new Error('Une ligne corrigée ne correspond pas à ce PDF. Actualisez le diagnostic.'),{status:400});
  const sums={debit:0,credit:0};
  operations.forEach(operation=>sums[operation.bankDirection]+=Math.round(operation.amount*100));
  const summaryValue=label=>{
    const line=first.split('\n').find(line=>normalize(line).startsWith(label));
    return line?amount(line.replace(/^Total\s+\S+\s+/i,'')):NaN;
  };
  const expectedDebit=summaryValue('total debits'),expectedCredit=summaryValue('total credits');
  const validTotals=Number.isFinite(expectedDebit)&&Math.round(expectedDebit*100)===sums.debit&&Number.isFinite(expectedCredit)&&Math.round(expectedCredit*100)===sums.credit;
  if(rejected||!validTotals)throw Object.assign(new Error(`Contrôle UBS incomplet : ${rejected} ligne(s) ambiguë(s)${issues.length?' (page(s) '+[...new Set(issues.map(issue=>issue.page))].join(', ')+')':''}. Débits extraits ${sums.debit/100} / attendus ${Number.isFinite(expectedDebit)?expectedDebit:'illisibles'} ; crédits extraits ${sums.credit/100} / attendus ${Number.isFinite(expectedCredit)?expectedCredit:'illisibles'} ${currency}. Import non effectué.`),{status:422,diagnostics:{source:'UBS',account,periodStart,periodEnd,currency,issues,rows:reviewRows,totals:{debit:{expected:Number.isFinite(expectedDebit)?expectedDebit:null,actual:sums.debit/100},credit:{expected:Number.isFinite(expectedCredit)?expectedCredit:null,actual:sums.credit/100}}}});
  return {operations,...metadata,reviewRows,debitTotal:sums.debit/100,creditTotal:sums.credit/100,
    suggestedName:`UBS - ${accountNumber} - ${periodStart}_${periodEnd} - ${metadata.statementKind==='annual'?'Annuel':'Mensuel'}.pdf`,
    note:(corrections.length?corrections.length+' ligne(s) avec correction manuelle. ':'')+'UBS : débits/crédits contrôlés. Les paiements de carte et les virements sont exclus des dépenses et proposés au rapprochement.'};
}
async function extractUBS(buffer, options){
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc=await pdfjs.getDocument({data:new Uint8Array(buffer),useSystemFonts:true}).promise;
  try{const pages=[];for(let num=1;num<=doc.numPages;num++){const content=await(await doc.getPage(num)).getTextContent();pages.push({num,items:content.items.filter(item=>typeof item.str==='string').map(item=>({text:item.str,x:item.transform[4],y:item.transform[5],width:item.width}))});}return parseUBSPages(pages, options);}finally{await doc.destroy();}
}
module.exports={extractUBS,parseUBSPages};
