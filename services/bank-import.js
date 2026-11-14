const crypto=require('node:crypto');
function bankKey(operation){
  if(!operation.account || !['debit','credit'].includes(operation.bankDirection) || operation.bankBalance==null || operation.bankBalance==='' || !Number.isFinite(Number(operation.bankBalance)))return '';
  return crypto.createHash('sha256').update(JSON.stringify([operation.account,operation.date,operation.currency,
    Math.round(operation.amount*100),operation.bankDirection,operation.bookingDate,Number(operation.bankBalance)])).digest('hex');
}
function mergeUBS(existing, parsed){
  const relevant=existing.filter(operation=>operation.account===parsed.accountId && operation.date>=parsed.periodStart && operation.date<=parsed.periodEnd);
  const remaining=relevant.map(operation=>({operation,key:bankKey(operation)}));
  const fallbackKey=operation=>JSON.stringify([operation.account,operation.date,operation.currency,Math.round(operation.amount*100),operation.bankDirection,operation.bookingDate||'',String(operation.label||'').trim().replace(/\s+/g,' ').toLowerCase()]);
  const operations=[],matched=[];
  for(const operation of parsed.operations){
    const key=bankKey(operation),fallback=fallbackKey(operation);
    let index=key?remaining.findIndex(item=>item.key===key):-1;
    if(index<0)index=remaining.findIndex(item=>(!key||!item.key)&&['debit','credit'].includes(item.operation.bankDirection)&&fallbackKey(item.operation)===fallback);
    if(index>=0)matched.push(remaining.splice(index,1)[0].operation.id);else operations.push(operation);
  }
  return {operations,report:{matched:matched.length,added:operations.length,unmatchedExisting:parsed.statementKind==='annual'?remaining.filter(item=>['debit','credit'].includes(item.operation.bankDirection)).length:0,
    debitTotal:parsed.debitTotal,creditTotal:parsed.creditTotal,account:parsed.accountId,kind:parsed.statementKind}};
}
module.exports={bankKey,mergeUBS,mergeBankStatement:mergeUBS};
