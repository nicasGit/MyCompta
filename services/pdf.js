// Recognized operations are included immediately; the original line remains editable.
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
async function extractPdf(buffer, source = 'Autre') {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const textPages = (await parser.getText(source === 'Cembra' ? { lineEnforce: true, cellSeparator: ' ', itemJoiner: ' ' } : {})).pages;
    const cembra = source === 'Cembra'
      ? require('../parsers/cembra').parseCembraTables((await parser.getTable()).pages,
        textPages)
      : null;
    const operations = cembra ? cembra.operations : parsePages(textPages);
    const suggestedName = cembra ? require('./document-name').cembraDocumentName(textPages) : null;
    if (operations.length > 2000) throw Object.assign(new Error('Ce document contient trop de lignes. Importez un relevé plus court.'), { status: 400 });
    if (cembra) return { operations, suggestedName, note: (suggestedName ? '' : 'Date de facture absente ou ambiguë : nom actuel conservé. ') + (operations.length
      ? `Cembra : détail des transactions uniquement, sur toutes les pages. Date de transaction retenue ; date de comptabilisation et colonnes crédit/débit conservées dans la ligne d’origine. ${cembra.rejected} ligne(s) ambiguë(s) non importée(s). Opérations prises en compte immédiatement ; catégorisation facultative.`
      : `Aucun détail Cembra exploitable trouvé. Seul le tableau Date de trans. / Date de com. / Description / Crédit CHF / Débit CHF est accepté. ${cembra.rejected} ligne(s) ambiguë(s) non importée(s). Le PDF est archivé, sans reprise des soldes ou récapitulatifs. Les scans nécessitent un OCR.`) };
    return { operations, note: operations.length
      ? 'Extraction automatique. Les opérations sont prises en compte immédiatement et restent modifiables. Les formats bancaires génériques ne sont pas encore certifiés.'
      : 'Aucune ligne reconnue. Le PDF est archivé ; saisissez les opérations manuellement. Les scans nécessitent un OCR, non inclus dans cette V1.' };
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('PDF illisible ou protégé. Utilisez un PDF déverrouillé contenant du texte.'), { status: 400 });
  } finally { await parser.destroy(); }
}
async function suggestPdfName(buffer) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText({ lineEnforce: true, cellSeparator: ' ', itemJoiner: ' ' });
    return require('./document-name').cembraDocumentName(result.pages);
  } catch {
    throw Object.assign(new Error('Impossible de lire la date de facture dans ce PDF.'), { status: 400 });
  } finally { await parser.destroy(); }
}
module.exports = { parsePages, extractPdf, suggestPdfName };
