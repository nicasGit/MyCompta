const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregate } = require('../public/annual-data');

test('annual curves aggregate monthly expenses by category without mixing years, currencies, ignored rows or transfers', () => {
  const operation = { date: '2026-01-15', category: 'Alimentation', amount: 0.1, currency: 'CHF', type: 'expense', status: 'validated' };
  const rows = aggregate([operation, { ...operation, amount: 0.2 },
    { ...operation, date: '2026-12-31', amount: 10 },
    { ...operation, category: 'Animaux', date: '2026-02-10', amount: 50 },
    { ...operation, date: '2025-01-15', amount: 1000 },
    { ...operation, currency: 'EUR', amount: 1000 },
    { ...operation, status: 'ignored', amount: 1000 },
    { ...operation, type: 'income', amount: 1000 },
    { ...operation, type: 'transfer', amount: 1000 }], 2026, 'CHF');
  assert.equal(rows[0].category, 'Animaux');
  const food = rows.find(row => row.category === 'Alimentation');
  assert.equal(food.values.length, 12);
  assert.equal(food.values[0], 0.3);
  assert.equal(food.values[1], 0);
  assert.equal(food.values[11], 10);
  assert.equal(food.total, 10.3);
  assert.deepEqual(aggregate([], 2026, 'CHF'), []);
});
