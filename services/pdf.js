// Candidates only: each extracted line requires human validation.
function parsePages(pages) {
  const operations = [];
  for (const page of pages) {
    for (const line of page.text.split(/\r?\n/)) {
      const match = line.trim().match(/^(\d{2})[./](\d{2})[./](\d{4})\s+(.+?)\s+([+-]?(?:\d{1,3}(?:['’\u00a0 ]\d{3})+|\d+)[.,]\d{2})\s*(CHF|EUR|USD|GBP)?\s*$/);
      if (!match) continue;
      const [, day, month, year, label, value, currency] = match;
      if (/\b(solde|balance|total|report|à nouveau)\b/i.test(label)) continue;
      if (/\d+[.,]\d{2}|\d{2}[./]\d{2}/.test(label)) continue;
      const date = `${year}-${month}-${day}`;
      if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) continue;
      const amount = Math.abs(Number(value.replace(/['’\u00a0 ]/g, '').replace(',', '.')));
      if (!amount) continue;
      operations.push({ date, label: label.trim(), amount, currency: currency || 'CHF', page: page.num, raw: line.trim() });
    }
  }
  return operations;
}
async function extractPdf(buffer) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const operations = parsePages(result.pages);
    if (operations.length > 2000) throw Object.assign(new Error('Ce document contient trop de lignes. Importez un relevé plus court.'), { status: 400 });
    return { operations, note: operations.length
      ? 'Extraction indicative : vérifiez les dates, montants, devises et le sens de chaque opération dans le PDF. Les formats bancaires ne sont pas encore certifiés.'
      : 'Aucune ligne reconnue. Le PDF est archivé ; saisissez les opérations manuellement. Les scans nécessitent un OCR, non inclus dans cette V1.' };
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('PDF illisible ou protégé. Utilisez un PDF déverrouillé contenant du texte.'), { status: 400 });
  } finally { await parser.destroy(); }
}
module.exports = { parsePages, extractPdf };
