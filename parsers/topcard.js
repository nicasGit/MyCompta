const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function date(value) {
  const match = String(value).trim().match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
  if (!match) return null;
  const year = match[3].length === 2 ? '20' + match[3] : match[3];
  const iso = `${year}-${match[2]}-${match[1]}`;
  return Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString().slice(0, 10) === iso ? iso : null;
}
function money(value) {
  let text = String(value).replace(/[\s'’]/g, '');
  if (/^\d+[.,]\d{2}-$/.test(text)) text = '-' + text.slice(0, -1);
  return /^[+-]?\d+[.,]\d{2}$/.test(text) ? Number(text.replace(',', '.')) : NaN;
}
function identity(text) {
  const monthly = text.match(/([^\n,]+),\s*Carte de cr[eé]dit[^,]*,\s*\d{4}\s+[\dX*]+\s+[X*]+\s+(\d{4})/i);
  if (monthly) return { holder: monthly[1].trim(), cardLast4: monthly[2], cardType: 'Supercard Visa' };
  const exported = text.match(/\d{4}\s+[\dX*]+\s+[X*]+\s+(\d{4}),\s*([^\n]+)/i);
  return exported ? { holder: exported[2].trim(), cardLast4: exported[1], cardType: 'Supercard Visa' } : null;
}
function rows(items) {
  const result = [];
  for (const item of [...items].filter(item => item.text.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
    let row = result.find(row => Math.abs(row.y - item.y) < 2);
    if (!row) { row = { y: item.y, items: [] }; result.push(row); }
    row.items.push(item);
  }
  return result.map(row => ({ ...row, text: row.items.map(item => item.text).join(' ') }));
}
function parseTopCardPages(pages) {
  const operations = [];
  let rejected = 0, carryCard = {}, previousPage = 0;
  for (const page of pages) {
    const lines = rows(page.items);
    const headerIndex = lines.findIndex(row => /achat.*texte comptable.*debit.*credit/.test(normalize(row.text)) || /details.*montant chf/.test(normalize(row.text)));
    if (headerIndex < 0) { carryCard = {}; continue; }
    const header = lines[headerIndex], exported = /achat/.test(normalize(header.text));
    if (!exported && !lines.some(row => /^detail de la facture/.test(normalize(row.text)))
      && !(page.num === previousPage + 1 && carryCard.cardLast4)) continue;
    const find = expression => header.items.find(item => expression.test(normalize(item.text)));
    const dateColumn = exported ? find(/^achat$/) : lines.slice(0, headerIndex + 2).flatMap(row => row.items).find(item => /^date$/i.test(item.text));
    const labelColumn = find(exported ? /^texte comptable$/ : /^details$/);
    const debitColumn = find(exported ? /^debit$/ : /^montant chf$/), creditColumn = exported ? find(/^credit$/) : null;
    if (!dateColumn || !labelColumn || !debitColumn) continue;
    let card = page.num === previousPage + 1 ? carryCard : {}, block = null;
    const commit = () => {
      if (!block) return;
      const raw = block.lines.map(row => row.text).join('\n');
      const foundCard = exported ? identity(raw) : block.card;
      const purchaseDates = exported ? [block.date] : block.lines.slice(1).flatMap(row => row.items.filter(item => Math.abs(item.x - labelColumn.x) < 8).map(item => date(item.text))).filter(Boolean);
      if (!foundCard?.cardLast4 || purchaseDates.length !== 1 || !block.label || !Number.isFinite(block.amount) || block.amount === 0) { rejected++; block = null; return; }
      const payment = /votre paiement|paiement recu|versement|reglement/.test(normalize(block.label));
      operations.push({ date: purchaseDates[0], label: block.label, amount: Math.abs(block.amount), currency: 'CHF',
        type: payment ? 'card_payment' : block.amount < 0 ? 'income' : 'expense', page: page.num, ...foundCard,
        raw: `TopCard ${exported ? 'Analyses' : 'Facture'} · Date d'enregistrement ${block.bookingDate || block.date}\n${raw}` });
      block = null;
    };
    for (let index = headerIndex + 1; index < lines.length; index++) {
      const row = lines[index];
      if (/carte de cr[eé]dit/i.test(row.text)) {
        commit();
        card = identity(row.text + ' ' + (lines[index + 1]?.text || '')) || {};
        continue;
      }
      if (/^(report|total de carte|montant de la facture|compte de carte|topcard|.*date de la facture)/i.test(row.text)) { commit(); continue; }
      const first = row.items.find(item => Math.abs(item.x - dateColumn.x) < 8 && date(item.text));
      if (first) {
        commit();
        const amounts = row.items.filter(item => Number.isFinite(money(item.text)) && Math.abs(item.x + item.width - debitColumn.x - debitColumn.width) < 12);
        const credits = creditColumn ? row.items.filter(item => Number.isFinite(money(item.text)) && Math.abs(item.x + item.width - creditColumn.x - creditColumn.width) < 12) : [];
        const label = row.items.filter(item => item.x >= labelColumn.x - 3 && item.x < debitColumn.x - 100).map(item => item.text).join(' ').trim();
        // Export label extends up to the separate original-currency amount column.
        const exportLabel = exported ? row.items.filter(item => item.x >= labelColumn.x - 3 && item.x < (find(/^montant$/)?.x || debitColumn.x - 50)).map(item => item.text).join(' ').trim() : label;
        const booking = exported ? row.items.filter(item => item !== first && date(item.text)).map(item => date(item.text))[0] : date(first.text);
        block = { date: date(first.text), bookingDate: booking, label: exportLabel, card: { ...card }, lines: [row], amount: amounts.length === 1 && !credits.length ? money(amounts[0].text) : credits.length === 1 && !amounts.length ? -Math.abs(money(credits[0].text)) : NaN };
      } else if (block) block.lines.push(row);
    }
    commit(); carryCard = card; previousPage = page.num;
  }
  return { operations, rejected };
}
async function extractTopCard(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  try {
    const pages = [];
    for (let num = 1; num <= document.numPages; num++) {
      const page = await document.getPage(num), content = await page.getTextContent();
      pages.push({ num, items: content.items.filter(item => typeof item.str === 'string').map(item => ({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width })) });
    }
    return parseTopCardPages(pages);
  } finally { await document.destroy(); }
}
module.exports = { parseTopCardPages, extractTopCard };
