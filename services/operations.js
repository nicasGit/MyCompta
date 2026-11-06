const CATEGORIES = ['À catégoriser', 'Logement', 'Alimentation', 'Transports', 'Santé', 'Assurances', 'Loisirs', 'Abonnements', 'Impôts', 'Autres'];
function validateOperation(input) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!input || typeof input !== 'object') fail('Opération invalide.');
  const date = String(input.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail('Date invalide.');
  if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1e9) fail('Le montant doit être positif et inférieur à un milliard.');
  if (Math.round(input.amount * 100) < 1) fail('Le montant minimum est de 0.01.');
  const label = String(input.label || '').trim();
  if (!label || label.length > 500) fail('Libellé requis (500 caractères maximum).');
  if (!CATEGORIES.includes(input.category)) fail('Catégorie invalide.');
  if (!['expense', 'income', 'transfer', 'card_payment'].includes(input.type)) fail('Type invalide.');
  if (!['pending', 'validated', 'ignored'].includes(input.status)) fail('État invalide.');
  if (!['CHF', 'EUR', 'USD', 'GBP'].includes(input.currency)) fail('Devise non prise en charge.');
  const page = Number(input.page || 0);
  if (!Number.isInteger(page) || page < 0 || page > 100000) fail('Page invalide.');
  return { date, label, amount: Math.round(input.amount * 100) / 100, currency: input.currency,
    category: input.category, type: input.type, status: input.status, account: String(input.account || '').slice(0, 100),
    documentId: String(input.documentId || '').slice(0, 100), page, raw: String(input.raw || '').slice(0, 2000) };
}
function summarize(operations, month) {
  const selectedMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') ? month : new Date().toISOString().slice(0, 7);
  const expenses = operations.filter(o => o.date.startsWith(selectedMonth) && o.status === 'validated' && o.type === 'expense');
  const totals = {}, categories = {};
  for (const o of expenses) {
    const cents = Math.round(Number(o.amount) * 100);
    totals[o.currency] = (totals[o.currency] || 0) + cents;
    const key = `${o.category}|${o.currency}`;
    categories[key] = (categories[key] || 0) + cents;
  }
  return { month: selectedMonth, count: expenses.length, pending: operations.filter(o => o.status === 'pending').length,
    totals: Object.fromEntries(Object.entries(totals).map(([key, cents]) => [key, cents / 100])),
    categories: Object.entries(categories).map(([key, cents]) => { const [category, currency] = key.split('|'); return { category, currency, amount: cents / 100 }; }).sort((a, b) => b.amount - a.amount) };
}
module.exports = { CATEGORIES, validateOperation, summarize };
