(function (root) {
  function calculate(operations) {
    const totals = new Map();
    for (const operation of operations) {
      if (operation.status === 'ignored' || !['expense', 'income'].includes(operation.type)) continue;
      if (!totals.has(operation.currency)) totals.set(operation.currency, { currency: operation.currency, expenses: 0, income: 0 });
      totals.get(operation.currency)[operation.type === 'expense' ? 'expenses' : 'income'] += Math.round(operation.amount * 100);
    }
    return [...totals.values()].map(total => ({ currency: total.currency, expenses: total.expenses / 100, income: total.income / 100, net: (total.expenses - total.income) / 100 }));
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { calculate };
  else root.MyComptaOperationTotals = { calculate };
})(globalThis);
