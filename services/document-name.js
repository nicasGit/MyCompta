const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

function invoiceDate(pages) {
  const dates = new Set();
  for (const page of pages) {
    const text = page.text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const pattern = /\b(?:date\s+de\s+(?:la\s+)?facture|date\s+de\s+facturation|facture\s+du|date\s+du\s+releve|releve\s+du)\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{1,2}\s+[a-z]+\s+\d{4})\b/g;
    for (const match of text.matchAll(pattern)) {
      const value = match[1];
      let iso;
      if (/^\d{4}-/.test(value)) iso = value;
      else {
        const parts = value.split(/[./\s-]+/);
        const month = /^\d+$/.test(parts[1]) ? Number(parts[1]) : MONTHS.indexOf(parts[1]) + 1;
        iso = `${parts[2]}-${String(month).padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
      if (Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString().slice(0, 10) === iso) dates.add(iso);
    }
  }
  // Never replace an invoice date with a transaction date, deadline or import date.
  return dates.size === 1 ? [...dates][0] : null;
}
function cembraDocumentName(pages) {
  const date = invoiceDate(pages);
  return date ? `Cembra - ${date}.pdf` : null;
}
module.exports = { invoiceDate, cembraDocumentName };
