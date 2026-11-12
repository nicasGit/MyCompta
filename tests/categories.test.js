const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { GoogleStore, TABLES } = require('../google/store');
const { createApp } = require('../app');
const { CATEGORIES } = require('../services/operations');

test('new Sheets categories immediately support operations, suppliers and budgets and survive rereading', async t => {
  const rows = Object.fromEntries(Object.entries(TABLES).map(([table, header]) => [table, [[...header]]]));
  rows.Categories.push(...CATEGORIES.map(name => [name, '']));
  const store = new GoogleStore();
  store.suppliersReady = true;
  store.context = async () => ({ base: 'https://sheets.example.test' });
  store.request = async url => {
    assert.ok(url.includes('/values:batchGet?'));
    return { valueRanges: Object.keys(TABLES).map(table => ({ values: structuredClone(rows[table]) })) };
  };
  store.json = async (url, method, body) => {
    assert.equal(method, 'POST');
    if (url.endsWith('/values:batchUpdate')) {
      assert.equal(body.valueInputOption, 'RAW');
      for (const change of body.data) {
        const [, table, column, row] = /^(\w+)!([A-Z])(\d+)$/.exec(change.range);
        rows[table][Number(row) - 1][column.charCodeAt(0) - 65] = change.values[0][0];
      }
      return {};
    }
    assert.ok(url.includes('valueInputOption=RAW'));
    const table = /\/values\/(\w+)!A1:append/.exec(url)?.[1];
    assert.ok(rows[table], url);
    rows[table].push(...body.values);
    return {};
  };
  const server = createApp(store).listen(0, '127.0.0.1');
  t.after(() => { server.closeAllConnections(); server.close(); });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MyCompta': '1' }, body: JSON.stringify(body) });
  assert.equal((await post('/api/categories', { name: '  Animaux  ' })).status, 201);
  assert.equal((await post('/api/categories', { name: 'ANIMAUX' })).status, 409);
  assert.equal((await post('/api/categories', { name: ' ' })).status, 400);
  assert.equal((await post('/api/suppliers', { name: 'Animalerie', category: 'Animaux' })).status, 201);
  assert.equal((await post('/api/budgets', { month: '2026-10', category: 'Animaux', amount: 100 })).status, 200);
  const operation = { date: '2026-10-15', label: 'Animalerie', amount: 12, currency: 'CHF', category: 'Animaux', type: 'expense', status: 'validated' };
  assert.equal((await post('/api/operations', operation)).status, 201);
  assert.equal((await post('/api/operations', { ...operation, category: 'Inconnue' })).status, 400);
  const data = await (await fetch(base + '/api/data?month=2026-10')).json();
  assert.ok(data.categories.includes('Animaux'));
  assert.equal(data.operations[0].category, 'Animaux');
  assert.equal(data.suppliers[0].category, 'Animaux');
  assert.equal(data.budgets[0].category, 'Animaux');
  assert.equal(data.summary.totals.CHF, 12);
  assert.equal((await post('/api/categories', { name: 'Essence', parent: 'Transports' })).status, 201);
  assert.equal((await post('/api/categories', { name: 'Essence', parent: 'Transports' })).status, 409);
  assert.equal((await post('/api/categories', { name: 'Autre', parent: 'Transports › Essence' })).status, 400);
  assert.equal((await post('/api/operations', { ...operation, category: 'Transports › Essence' })).status, 201);
  assert.equal((await post('/api/suppliers', { name: 'Station test', category: 'Transports › Essence' })).status, 201);
  assert.equal((await post('/api/budgets', { month: '2026-10', category: 'Transports › Essence', amount: 200 })).status, 200);
  let response = await fetch(base + '/api/categories', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-MyCompta': '1' }, body: JSON.stringify({ previous: 'Transports', name: 'Déplacements' }) });
  assert.equal(response.status, 200);
  let renamed = await (await fetch(base + '/api/data?month=2026-10')).json();
  assert.ok(renamed.categories.includes('Déplacements › Essence'));
  assert.ok(!renamed.categories.includes('Transports'));
  assert.equal(renamed.operations[1].category, 'Déplacements › Essence');
  assert.equal(renamed.operations[1].amount, 12);
  assert.equal(renamed.suppliers[1].category, 'Déplacements › Essence');
  assert.equal(renamed.budgets[1].category, 'Déplacements › Essence');
  assert.ok(renamed.summary.categories.some(item => item.category === 'Déplacements' && item.amount === 12));
  response = await fetch(base + '/api/categories', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-MyCompta': '1' }, body: JSON.stringify({ previous: 'Déplacements › Essence', name: 'Carburant' }) });
  assert.equal(response.status, 200);
  renamed = await (await fetch(base + '/api/data')).json();
  assert.equal(renamed.operations[1].category, 'Déplacements › Carburant');
});
