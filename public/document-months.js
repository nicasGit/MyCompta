(function (root) {
  const valid = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '');
  function month(document) {
    if (valid(document.statementMonth)) return document.statementMonth;
    const match = /^(Cembra|TopCard) - (\d{4}-(?:0[1-9]|1[0-2]))-\d{2}\.pdf$/i.exec(document.name || '');
    return match && document.source.toLowerCase() === match[1].toLowerCase() ? match[2] : '';
  }
  function coverage(documents, source, start, end) {
    if (!valid(start) || !valid(end) || start > end) return [];
    const result = [];
    let cursor = start;
    while (cursor <= end && result.length < 120) {
      const count = documents.filter(document => document.source === source && month(document) === cursor).length;
      result.push({ month: cursor, count });
      let [year, m] = cursor.split('-').map(Number);
      if (++m > 12) { year++; m = 1; }
      cursor = `${year}-${String(m).padStart(2, '0')}`;
    }
    return result;
  }
  const api = { month, coverage, valid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MyComptaDocumentMonths = api;
})(globalThis);
