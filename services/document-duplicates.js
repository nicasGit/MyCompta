const crypto = require('node:crypto');
const normalize = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
function contentHash(source, operations) {
  if (!operations.length) return '';
  const rows = operations.map(operation => JSON.stringify([
    operation.date, Math.round(Number(operation.amount) * 100), operation.currency,
    operation.type || 'expense', normalize(source) === 'topcard' ? '' : normalize(operation.label), normalize(operation.cardLast4), normalize(operation.holder)
  ])).sort();
  // Keep repeated rows: two identical purchases are two distinct entries.
  return crypto.createHash('sha256').update(JSON.stringify([normalize(source), rows])).digest('hex');
}
function matchingDocument(data, source, fingerprint) {
  if (!fingerprint) return null;
  return data.documents.find(document => document.contentHash === fingerprint || (!document.contentHash
    && contentHash(document.source, data.operations.filter(operation => operation.documentId === document.id)) === fingerprint));
}
module.exports = { contentHash, matchingDocument };
