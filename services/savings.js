function matchesAccount(iban,account){
  const id=String(account.id||'').replace(/^(UBS|PostFinance)\s+/,'').replace(/[\s.-]/g,'');
  return String(account.iban||'').replace(/\s/g,'')===iban || (id.length>=10&&(id===iban||iban.endsWith(id)));
}
function markSavings(operations,accounts=[]){
  const savings=accounts.filter(account=>account.kind==='savings'&&!account.id.startsWith('client:'));
  return operations.map(operation=>{
    const direct=savings.find(account=>account.id===operation.account);
    const ibans=String(operation.raw||'').match(/CH\d{2}(?:[ \t]*[0-9A-Z]){17}\b/g)||[];
    const raw=String(operation.raw||'').replace(/[\s.-]/g,'');
    const counterpart=operation.bankDirection||operation.type==='transfer'?savings.find(account=>{
      if(account.id===operation.account)return false;
      const code=account.id.replace(/^(UBS|PostFinance)\s+/,'').replace(/[\s.-]/g,'');
      return ibans.some(iban=>matchesAccount(iban.replace(/\s/g,''),account)) || code.length>=10&&raw.includes(code);
    }):null;
    return {...operation,isSavings:Boolean(direct||counterpart),savingsAccount:direct?.id||counterpart?.id||''};
  });
}
module.exports={markSavings,matchesAccount};
