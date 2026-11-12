const { CATEGORIES } = require('./operations');
const DEFAULT_SUPPLIERS = [
  { id: 'default-coop', name: 'Coop', category: 'Alimentation' },
  { id: 'default-migros', name: 'Migros', category: 'Alimentation' },
  { id: 'default-aldi', name: 'Aldi', category: 'Alimentation' },
  { id: 'default-lidl', name: 'Lidl', category: 'Alimentation' },
  { id: 'default-cff', name: 'CFF', category: 'Transports' },
];
function normalizeSupplier(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function validateSupplier(value, categories = CATEGORIES) {
  const name = typeof value?.name === 'string' ? value.name.trim().replace(/\s+/g, ' ') : '';
  if (name.length > 120 || normalizeSupplier(name).length < 2) throw Object.assign(new Error('Indiquez un fournisseur de 2 à 120 caractères.'), { status: 400 });
  if (!categories.includes(value.category) || value.category === 'À catégoriser') throw Object.assign(new Error('Choisissez une catégorie pour ce fournisseur.'), { status: 400 });
  return { name, category: value.category };
}
function matchingSupplier(label, suppliers = []) {
  const text = ` ${normalizeSupplier(label)} `;
  return [...suppliers].sort((a, b) => normalizeSupplier(b.name).length - normalizeSupplier(a.name).length)
    .find(s => text.includes(` ${normalizeSupplier(s.name)} `));
}
function categorizeOperation(operation, suppliers, reclassify = false) {
  if ((!reclassify && operation.category !== 'À catégoriser') || operation.status === 'ignored' || !['expense', 'income'].includes(operation.type)) return operation;
  const rule = matchingSupplier(operation.label, suppliers);
  return rule ? { ...operation, category: rule.category } : operation;
}
module.exports = { DEFAULT_SUPPLIERS, normalizeSupplier, validateSupplier, matchingSupplier, categorizeOperation };
