const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const fail = message => { throw Object.assign(new Error(message), { status: 422 }); };
function date(value) {
  const match = String(value).trim().match(/^(\d{2})\.\s*(\d{2})\.\s*(\d{2}|\d{4})$/);
  if (!match) return '';
  const result = `${match[3].length === 2 ? '20' + match[3] : match[3]}-${match[2]}-${match[1]}`;
  return Number.isFinite(Date.parse(result)) && new Date(result).toISOString().slice(0,10) === result ? result : '';
}
function money(value) {
  const text = String(value).replace(/[\s'’]/g, '');
  return /^-?\d+[.,]\d{2}$/.test(text) ? Math.round(Number(text.replace(',', '.')) * 100) : NaN;
}
function text(items) {
  let result = '', right = null;
  for (const item of [...items].sort((a,b) => a.x - b.x)) {
    if (!item.text.trim()) { if (result && !result.endsWith(' ')) result += ' '; continue; }
    if (right !== null && item.x - right > 1.5 && result && !result.endsWith(' ')) result += ' ';
    result += item.text;
    right = item.x + item.width;
  }
  return result.trim();
}
function rows(items) {
  const result = [];
  for (const item of [...items].filter(i => i.x > 40).sort((a,b) => b.y-a.y || a.x-b.x)) {
    let row = result.find(row => Math.abs(row.y-item.y)<1.8);
    if (!row) result.push(row={y:item.y,items:[]});
    row.items.push(item);
  }
  return result;
}
const cell = (row,left,right) => text(row.items.filter(item => item.x>=left && item.x<right));
function ownCounterparty(iban, knownAccounts) {
  return Boolean(iban && knownAccounts.some(account => {
    const id = String(account.accountId || account.id || '').replace(/^(UBS|PostFinance)\s+/, '').replace(/[\s.-]/g,'');
    return String(account.iban || '').replace(/\s/g,'') === iban || (id.length >= 10 && (iban === id || iban.endsWith(id)));
  }));
}
function parsePostFinancePages(pages, {accounts=[],documents=[],allowPartial=false}={}) {
  const firstRows = rows(pages[0]?.items || []);
  const first = firstRows.map(row=>text(row.items)).join('\n');
  const compact = first.replace(/\s/g,'');
  const period = /Extraitdecompte(\d{2}\.\d{2}\.\d{4})-(\d{2}\.\d{2}\.\d{4})/i.exec(compact);
  const iban = /IBAN(CH[0-9A-Z]{19})/.exec(compact)?.[1];
  const currency = /IBANCH[0-9A-Z]{19}(CHF|EUR|USD|GBP)/.exec(compact)?.[1];
  if (!period || !iban || !currency) fail('Relevé PostFinance non reconnu : période, IBAN ou devise manquants.');
  const periodStart=date(period[1]),periodEnd=date(period[2]);
  if (!periodStart || !periodEnd || periodStart>periodEnd) fail('Période PostFinance invalide.');
  const address = firstRows.map(row=>cell(row,280,570));
  const title = address.findIndex(line=>/^(Monsieur|Madame)$/.test(line));
  const holder = title>=0 ? (address[title+1] || '').trim().slice(0,150) : '';
  const holderWords=normalize(holder).split(/\W+/).filter(Boolean);
  const accountId='PostFinance '+iban;
  const operations=[],ignoredPages=[];
  let block=null,lastDate='',balance=null,opening=null,closing=null,totalDebit=null,totalCredit=null;
  function finish() {
    if (!block) return;
    const raw=[block.heading,...block.details].join('\n');
    const normalized=normalize(raw);
    const counterparty=block.details.map(line=>/\bCH\d{2}[0-9A-Z]{17}\b/.exec(line.replace(/\s/g,''))?.[0]).find(Boolean) || '';
    const beneficiary=counterparty ? block.details[block.details.findIndex(line=>line.replace(/\s/g,'').includes(counterparty))+1] || '' : '';
    const words=normalize(beneficiary).split(/\W+/).filter(Boolean);
    const sameHolder=holderWords.length>=2 && words.includes(holderWords[0]) && words.includes(holderWords.at(-1));
    const internal=ownCounterparty(counterparty,[...accounts,...documents]) || (counterparty && sameHolder) || /\b(virement|transfert) interne\b/.test(normalized);
    const paymentNetwork=block.bankDirection==='debit' && /\bcembra\b|\bcumulus\b/.test(normalized)?'Cembra'
      :block.bankDirection==='debit' && /\btop\s*card\b|\bsupercard\b/.test(normalized)?'TopCard':'';
    const type=paymentNetwork?'card_payment':internal?'transfer':block.bankDirection==='debit'?'expense':'income';
    operations.push({...block,details:undefined,heading:undefined,label:[block.heading,...block.details].join(' · ').slice(0,500),raw:`${accountId}\n${raw}`,
      amount:block.amount/100,account:accountId,holder,currency,type,paymentNetwork,clientNumber:''});
    block=null;
  }
  for (const page of pages) {
    const pageRows=rows(page.items);
    const header=pageRows.findIndex(row=>normalize(cell(row,40,115))==='date' && normalize(cell(row,115,305))==='texte'
      && normalize(cell(row,305,370))==='credit' && normalize(cell(row,370,445))==='debit' && normalize(cell(row,445,500))==='valeur' && normalize(cell(row,500,580))==='solde');
    if(header<0){finish();ignoredPages.push(page.num);continue;}
    for(const row of pageRows.slice(header+1)) {
      if(row.y<100)continue;
      const dateText=cell(row,40,115),day=date(dateText),label=cell(row,115,305),normalized=normalize(label).replace(/\s/g,'');
      const credit=money(cell(row,305,370)),debit=money(cell(row,370,445)),valueDate=date(cell(row,445,500)),displayedBalance=money(cell(row,500,580));
      if(normalized==='total') {
        finish();
        if(totalCredit!==null || !Number.isFinite(credit) || !Number.isFinite(debit)) fail('Totaux PostFinance ambigus.');
        totalCredit=credit;totalDebit=debit;continue;
      }
      if(normalized==='etatdecompte') {
        finish();
        if(!Number.isFinite(displayedBalance))fail('Solde PostFinance illisible.');
        if(opening===null && !operations.length){opening=displayedBalance;balance=opening;}
        else {if(displayedBalance!==balance)fail('Le solde final PostFinance ne correspond pas aux mouvements.');closing=displayedBalance;}
        continue;
      }
      if(Number.isFinite(credit) || Number.isFinite(debit)) {
        finish();
        if((Number.isFinite(credit) === Number.isFinite(debit)) || !valueDate || balance===null || (dateText && !day)) fail(`Mouvement PostFinance ambigu en page ${page.num}.`);
        if(day)lastDate=day;
        const amount=Number.isFinite(debit)?debit:credit;
        if(!lastDate || lastDate<periodStart || lastDate>periodEnd || amount<=0 || !label)fail('Date ou montant PostFinance invalide.');
        const bankDirection=Number.isFinite(debit)?'debit':'credit';
        balance += bankDirection==='debit'?-amount:amount;
        if(Number.isFinite(displayedBalance) && displayedBalance!==balance)fail(`Solde PostFinance incohérent en page ${page.num}.`);
        block={date:lastDate,bookingDate:valueDate,amount,bankDirection,bankBalance:String(balance/100),page:page.num,heading:label,details:[]};
      } else if(block) {
        const detail=cell(row,115,580);
        if(detail)block.details.push(detail);
      }
      if(closing!==null)break;
    }
  }
  finish();
  const debit=operations.filter(o=>o.bankDirection==='debit').reduce((sum,o)=>sum+Math.round(o.amount*100),0);
  const credit=operations.filter(o=>o.bankDirection==='credit').reduce((sum,o)=>sum+Math.round(o.amount*100),0);
  const complete=totalDebit===debit && totalCredit===credit && opening!==null && closing!==null && opening+credit-debit===closing;
  if(!complete&&!(allowPartial===true&&ignoredPages.length&&operations.length)){
    const error=Object.assign(new Error('Contrôle PostFinance incomplet : totaux ou soldes non concordants.'+(ignoredPages.length?' Page(s) sans tableau : '+ignoredPages.join(', ')+'. Vous pouvez autoriser un import partiel des lignes détectées.':'')+' Import non effectué.'),{status:422});
    error.diagnostics={source:'PostFinance',currency,canImportPartial:Boolean(ignoredPages.length&&operations.length),detectedCount:operations.length,issues:ignoredPages.map(page=>({page,reason:'Page sans tableau de mouvements reconnu',raw:''})),totals:{debit:{expected:totalDebit===null?null:totalDebit/100,actual:debit/100},credit:{expected:totalCredit===null?null:totalCredit/100,actual:credit/100}}};
    throw error;
  }
  const statementKind=periodStart.slice(0,4)===periodEnd.slice(0,4)&&periodStart.endsWith('-01-01')&&periodEnd.endsWith('-12-31')?'annual':'monthly';
  return {operations,accountId,iban,holder,currency,partial:!complete,ignoredPages,clientNumber:'',periodStart,periodEnd,statementKind,statementMonth:statementKind==='monthly'?periodEnd.slice(0,7):'',debitTotal:debit/100,creditTotal:credit/100,
    suggestedName:`PostFinance - ${iban} - ${periodStart}_${periodEnd}.pdf`,
    note:(!complete?'IMPORT PARTIEL : seuls les '+operations.length+' mouvements détectés sont importés ; totaux du relevé non validés. ':'')+(ignoredPages.length?'Page(s) sans tableau ignorée(s) : '+ignoredPages.join(', ')+'. ':'')+'PostFinance : dates et débits/crédits contrôlés.'+(complete?' Totaux et soldes concordants.':'')+' Les transferts vers les comptes connus du foyer ou au même titulaire sont exclus des dépenses ; les paiements à des tiers restent des dépenses.'};
}
async function extractPostFinance(buffer, options) {
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  let document;
  try {
    document=await pdfjs.getDocument({data:new Uint8Array(buffer),useSystemFonts:true}).promise;
    const pages=[];
    for(let num=1;num<=document.numPages;num++){
      const content=await(await document.getPage(num)).getTextContent();
      pages.push({num,items:content.items.filter(item=>typeof item.str==='string').map(item=>({text:item.str,x:item.transform[4],y:item.transform[5],width:item.width}))});
    }
    return parsePostFinancePages(pages,options);
  } catch(error) {
    if(error.status)throw error;
    throw Object.assign(new Error('PDF PostFinance illisible ou protégé. Utilisez un PDF déverrouillé contenant du texte.'),{status:400});
  } finally {if(document)await document.destroy();}
}
module.exports={extractPostFinance,parsePostFinancePages};
