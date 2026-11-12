const CATEGORIES = ['À catégoriser', 'Logement', 'Alimentation', 'Transports', 'Santé', 'Assurances', 'Loisirs', 'Abonnements', 'Impôts', 'Autres'];
function validateOperation(input, categories = CATEGORIES) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!input || typeof input !== 'object') fail('Opération invalide.');
  const date = String(input.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail('Date invalide.');
  if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1e9) fail('Le montant doit être positif et inférieur à un milliard.');
  if (Math.round(input.amount * 100) < 1) fail('Le montant minimum est de 0.01.');
  const label = String(input.label || '').trim();
  if (!label || label.length > 500) fail('Libellé requis (500 caractères maximum).');
  if (!categories.includes(input.category)) fail('Catégorie invalide.');
  if (!['expense', 'income', 'transfer', 'card_payment'].includes(input.type)) fail('Type invalide.');
  if (!['pending', 'validated', 'ignored'].includes(input.status)) fail('État invalide.');
  if (!['CHF', 'EUR', 'USD', 'GBP'].includes(input.currency)) fail('Devise non prise en charge.');
  const page = Number(input.page || 0);
  const cardLast4 = String(input.cardLast4 || '').trim();
  if (cardLast4 && !/^\d{4}$/.test(cardLast4)) fail('La carte doit être identifiée par ses quatre derniers chiffres.');
  if (!Number.isInteger(page) || page < 0 || page > 100000) fail('Page invalide.');
  return { date, label, amount: Math.round(input.amount * 100) / 100, currency: input.currency,
    category: input.category, type: input.type, status: input.status === 'ignored' ? 'ignored' : 'validated', account: String(input.account || '').slice(0, 100),
    holder: String(input.holder || '').trim().slice(0, 150), cardLast4, cardType: String(input.cardType || '').trim().slice(0, 40),
    createdBy: String(input.createdBy || '').slice(0, 254),
    documentId: String(input.documentId || '').slice(0, 100), page, raw: String(input.raw || '').slice(0, 2000) };
}
function summarize(operations, month) {
  const selectedMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') ? month : new Date().toISOString().slice(0, 7);
  const expenses = operations.filter(o => o.date.startsWith(selectedMonth) && o.status !== 'ignored' && o.type === 'expense');
  const totals = {}, categories = {};
  for (const o of expenses) {
    const cents = Math.round(Number(o.amount) * 100);
    totals[o.currency] = (totals[o.currency] || 0) + cents;
    const key = `${o.category.split(' › ')[0]}|${o.currency}`;
    categories[key] = (categories[key] || 0) + cents;
  }
  return { month: selectedMonth, count: expenses.length, uncategorized: operations.filter(o => o.status !== 'ignored' && o.category === 'À catégoriser').length,
    totals: Object.fromEntries(Object.entries(totals).map(([key, cents]) => [key, cents / 100])),
    categories: Object.entries(categories).map(([key, cents]) => { const [category, currency] = key.split('|'); return { category, currency, amount: cents / 100 }; }).sort((a, b) => b.amount - a.amount) };
}
function reconcileImport(incoming, existing) {
  const remaining = [...existing];
  return incoming.map(operation => {
    const matches = old => old.date && old.label && operation.label && old.date === operation.date && old.label.trim().toLocaleLowerCase('fr') === operation.label.trim().toLocaleLowerCase('fr') &&
      Math.round(old.amount * 100) === Math.round(operation.amount * 100) && old.currency === operation.currency;
    let index = remaining.findIndex(old => matches(old) && (old.cardLast4 || '') === (operation.cardLast4 || ''));
    if (index < 0) index = remaining.findIndex(old => matches(old) && !old.cardLast4);
    if (index < 0) return { ...operation, status: 'validated' };
    const [old] = remaining.splice(index, 1);
    return { ...operation, id: old.id, category: old.category, account: old.account || operation.account,
      type: old.type, status: old.status === 'ignored' ? 'ignored' : 'validated', createdBy: old.createdBy || '',
      holder: operation.holder || old.holder || '', cardLast4: operation.cardLast4 || old.cardLast4 || '', cardType: operation.cardType || old.cardType || '' };
  });
}
module.exports = { CATEGORIES, validateOperation, summarize, reconcileImport };
