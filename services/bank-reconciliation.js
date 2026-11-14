const cents=operation=>Math.round(operation.amount*100);
function buildReconciliation(data,start,end){
  const documents=data.documents||[],all=(data.operations||[]).filter(operation=>operation.status!=='ignored');
  const included=date=>date&&date.slice(0,7)>=start&&date.slice(0,7)<=end;
  const transfers=all.filter(operation=>operation.type==='transfer'&&included(operation.date));
  const candidateMap=new Map();
  for(const operation of transfers){
    const candidates=all.filter(other=>other.type==='transfer'&&other.id!==operation.id&&other.account!==operation.account&&other.currency===operation.currency
      &&cents(other)===cents(operation)&&operation.bankDirection&&other.bankDirection&&other.bankDirection!==operation.bankDirection
      &&Math.abs(Date.parse(operation.date)-Date.parse(other.date))<=5*86400000);
    candidateMap.set(operation.id,candidates);
  }
  const consumed=new Set(),pairs=[],unmatched=[];
  for(const operation of transfers){
    if(consumed.has(operation.id))continue;
    const candidates=candidateMap.get(operation.id),other=candidates[0];
    // Only a unique match in both directions is proposed; never reuse a movement.
    const reciprocal=other?all.filter(item=>item.type==='transfer'&&item.id!==other.id&&item.account!==other.account&&item.currency===other.currency&&cents(item)===cents(other)
      &&item.bankDirection&&item.bankDirection!==other.bankDirection&&Math.abs(Date.parse(item.date)-Date.parse(other.date))<=5*86400000):[];
    if(candidates.length===1&&reciprocal.length===1&&!consumed.has(other.id)){pairs.push({debit:operation.bankDirection==='debit'?operation:other,credit:operation.bankDirection==='credit'?operation:other});consumed.add(operation.id);consumed.add(other.id);}
    else unmatched.push({...operation,candidateCount:candidates.length});
  }
  const cards=['Cembra','TopCard'].map(network=>{
    const payments=all.filter(operation=>operation.type==='card_payment'&&operation.paymentNetwork===network&&included(operation.date));
    const cardDocs=documents.filter(document=>document.source===network&&included(document.statementMonth||require('../public/document-months').month(document)));
    const documentIds=new Set(cardDocs.map(document=>document.id));
    const cardOperations=all.filter(operation=>documentIds.has(operation.documentId)&&['expense','income'].includes(operation.type));
    const currencies=[...new Set([...payments,...cardOperations].map(operation=>operation.currency))];
    return {network,documentCount:cardDocs.length,unknownMonths:documents.filter(document=>document.source===network&&!require('../public/document-months').month(document)).length,
      totals:currencies.map(currency=>{const paid=payments.filter(operation=>operation.currency===currency).reduce((sum,operation)=>sum+cents(operation),0);
        const billed=cardOperations.filter(operation=>operation.currency===currency).reduce((sum,operation)=>sum+(operation.type==='income'?-1:1)*cents(operation),0);
        return {currency,paid:paid/100,billed:billed/100,difference:(paid-billed)/100,comparable:cardOperations.some(operation=>operation.currency===currency)&&payments.some(operation=>operation.currency===currency)};}),payments};
  });
  const annual=documents.filter(document=>document.statementKind==='annual'&&document.source==='UBS'&&document.periodEnd.slice(0,7)>=start&&document.periodStart.slice(0,7)<=end).map(document=>{
    let report={};try{report=JSON.parse(document.importReport||'{}');}catch{}
    const monthly=[...new Map(documents.filter(other=>other.source==='UBS'&&other.accountId===document.accountId&&other.statementKind==='monthly'&&other.periodStart>=document.periodStart&&other.periodEnd<=document.periodEnd).map(other=>[other.periodStart+'_'+other.periodEnd,other])).values()];
    let monthlyDebit=0,monthlyCredit=0;
    for(const item of monthly){try{const value=JSON.parse(item.importReport||'{}');monthlyDebit+=Math.round((value.debitTotal||0)*100);monthlyCredit+=Math.round((value.creditTotal||0)*100);}catch{}}
    const missingMonths=require('../public/document-months').coverage(monthly,'UBS',document.periodStart.slice(0,7),document.periodEnd.slice(0,7)).filter(month=>!month.count).map(month=>month.month);
    return {id:document.id,name:document.name,account:document.accountId,currency:all.find(operation=>operation.account===document.accountId)?.currency||(data.accounts||[]).find(account=>account.id===document.accountId)?.currency||'CHF',periodStart:document.periodStart,periodEnd:document.periodEnd,report,monthlyCount:monthly.length,missingMonths,
      monthlyDebit:monthlyDebit/100,monthlyCredit:monthlyCredit/100};
  });
  return {pairs,unmatched,cards,annual};
}
module.exports={buildReconciliation};
