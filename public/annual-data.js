(function (root) {
  function aggregate(operations, year, currency) {
    const groups = new Map();
    for (const operation of operations) {
      if (operation.type !== 'expense' || operation.status === 'ignored' || operation.currency !== currency
        || !operation.date.startsWith(String(year) + '-')) continue;
      const month = Number(operation.date.slice(5, 7)) - 1;
      if (month < 0 || month > 11) continue;
      if (!groups.has(operation.category)) groups.set(operation.category, Array(12).fill(0));
      groups.get(operation.category)[month] += Math.round(operation.amount * 100);
    }
    return [...groups].map(([category, cents]) => ({ category, values: cents.map(value => value / 100), total: cents.reduce((sum, value) => sum + value, 0) / 100 })).sort((a, b) => b.total - a.total);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { aggregate };
  else root.MyComptaAnnualData = { aggregate };
})(globalThis);
