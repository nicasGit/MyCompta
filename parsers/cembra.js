// Only the transaction-detail table is eligible; balances and other tables are excluded.
const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
function date(value) {
  const match = String(value || '').trim().match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
  if (!match) return null;
  const result = `${match[3]}-${match[2]}-${match[1]}`;
  return Number.isFinite(Date.parse(result)) && new Date(result).toISOString().slice(0, 10) === result ? result : null;
}
function amount(value) {
  const text = String(value || '').replace(/CHF/gi, '').replace(/[\s'’]/g, '');
  if (!text || text === '-') return 0;
  return /^[+-]?\d+[.,]\d{2}$/.test(text) ? Math.abs(Number(text.replace(',', '.'))) : NaN;
}
function header(row) {
  const labels = row.map(normalize);
  const columns = {
    date: labels.findIndex(s => /date.*trans/.test(s)),
    bookingDate: labels.findIndex(s => /date.*com/.test(s)),
    label: labels.findIndex(s => /description/.test(s)),
    credit: labels.findIndex(s => /credit.*chf/.test(s)),
    debit: labels.findIndex(s => /debit.*chf/.test(s)),
  };
  return Object.values(columns).every(index => index >= 0) ? columns : null;
}
function cardHeadings(text) {
  const pattern = /carte\s+(principale|suppl[ée]mentaire)\b[^\r\n]*?se\s+termine\s+par\s+[xX*•●\s-]*(\d{4})\s+([^\r\n]+)/gi;
  const headings = [];
  for (const match of text.matchAll(pattern)) {
    const holder = match[3].split(/date\s+de\s+trans/i)[0].replace(/\s+/g, ' ').trim();
    if (!holder) continue;
    headings.push({ start: normalize(text.slice(0, match.index)).replace(/\s/g, '').length,
      holder, cardLast4: match[2], cardType: normalize(match[1]) === 'principale' ? 'principale' : 'supplémentaire' });
  }
  return headings;
}
function parseCembraTables(pages, textPages = []) {
  const operations = [];
  let rejected = 0, tableCount = 0, previous = null;
  for (const page of pages) {
    const text = textPages.find(p => p.num === page.num)?.text || '';
    const headings = cardHeadings(text);
    const compactText = normalize(text).replace(/\s/g, '');
    let cursor = 0;
    let continuation = null;
    for (const table of page.tables) {
      let columns = null, last = null;
      let card = {};
      const firstTransaction = table.find(row => date(row[0]) && date(row[1]));
      if (firstTransaction) {
        const anchor = normalize(firstTransaction.slice(0, 3).map(v => String(v).split('\n')[0]).join(' ')).replace(/\s/g, '');
        const position = compactText.indexOf(anchor, cursor);
        if (position >= 0) {
          const heading = headings.filter(h => h.start < position).at(-1);
          if (heading) { const { start, ...identity } = heading; card = identity; }
          cursor = position + anchor.length;
        }
      }
      const first = table.find(row => row.some(cell => String(cell || '').trim()));
      // Some statements repeat column headers; others continue the same table on the next page.
      if (previous && page.num === previous.page + 1 && first?.length === previous.width && date(first[previous.columns.date]) && date(first[previous.columns.bookingDate])) {
        columns = previous.columns;
        if (!card.holder && !headings.length) card = previous.card;
        tableCount++;
      }
      for (const row of table) {
        const detected = header(row);
        if (detected) { columns = detected; tableCount++; last = null; continue; }
        if (!columns) continue;
        const value = key => String(row[columns[key]] || '').trim();
        const label = value('label').replace(/\s+/g, ' ');
        if (/^(total|solde|report|montant (total|a payer))\b/.test(normalize(label))) { columns = null; last = null; continue; }
        const transactionDate = date(value('date'));
        const bookingDate = date(value('bookingDate'));
        if (!value('date') && !value('bookingDate') && !value('credit') && !value('debit')) {
          if (last && label) { last.label += ' ' + label; last.raw += '\n' + row.join(' | '); }
          continue;
        }
        const credit = amount(value('credit')), debit = amount(value('debit'));
        if (!transactionDate || !bookingDate || !label || !Number.isFinite(credit) || !Number.isFinite(debit) || (credit > 0) === (debit > 0)) {
          if (value('date') || value('bookingDate')) rejected++;
          last = null;
          continue;
        }
        const type = debit > 0 ? 'expense' : /paiement recu|versement|reglement|e-banking/.test(normalize(label)) ? 'card_payment' : 'income';
        last = { date: transactionDate, label, amount: debit || credit, currency: 'CHF', type, page: page.num, ...card,
          raw: `${card.holder ? `Carte ${card.cardType} · ${card.cardLast4} · ${card.holder}\n` : ''}Date de trans. | Date de com. | Description | Crédit CHF | Débit CHF\n${row.join(' | ')}` };
        operations.push(last);
      }
      if (columns) continuation = { columns, width: table[0]?.length, page: page.num, card };
    }
    previous = continuation;
  }
  return { operations, rejected, tableCount };
}
module.exports = { parseCembraTables };
