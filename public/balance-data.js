(function(root) {
  function aggregate(operations, year, currency) {
    const months = Array.from({length:12}, (_,index) => ({month:index+1,income:0,expenses:0,count:0}));
    for (const operation of operations) {
      if (operation.isSavings || operation.status === 'ignored' || !['income','expense'].includes(operation.type)
        || operation.currency !== currency || !operation.date.startsWith(String(year)+'-')) continue;
      const index = Number(operation.date.slice(5,7))-1;
      if (!Number.isInteger(index) || index<0 || index>11) continue;
      months[index][operation.type==='income'?'income':'expenses'] += Math.round(operation.amount*100);
      months[index].count++;
    }
    const income=months.reduce((sum,row)=>sum+row.income,0), expenses=months.reduce((sum,row)=>sum+row.expenses,0);
    return {income:income/100,expenses:expenses/100,net:(income-expenses)/100,
      months:months.map(row=>({...row,income:row.income/100,expenses:row.expenses/100,net:(row.income-row.expenses)/100}))};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={aggregate};
  else root.MyComptaBalanceData={aggregate};
})(globalThis);
