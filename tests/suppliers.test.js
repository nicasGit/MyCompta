const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { DEFAULT_SUPPLIERS, categorizeOperation, matchingSupplier, validateSupplier } = require('../services/suppliers');
const { GoogleStore } = require('../google/store');
const { createApp } = require('../app');
const operation = overrides => ({ id: 'op', documentId: 'doc', date: '2026-09-28', label: 'Coop-5145 Savigny CHE', amount: 34.05,
  currency: 'CHF', account: 'Cembra', category: 'À catégoriser', type: 'expense', status: 'validated', _row: 2, ...overrides });

test('supplier matching recognizes bank descriptions, ignores case/accents and prefers specific rules', () => {
  assert.equal(categorizeOperation(operation(), DEFAULT_SUPPLIERS).category, 'Alimentation');
  const rules = [...DEFAULT_SUPPLIERS, { id: 'pronto', name: 'Coop Pronto', category: 'Transports' }, { id: 'cafe', name: 'Café du coin', category: 'Loisirs' }];
  assert.equal(matchingSupplier('COOP PRONTO Lausanne', rules).category, 'Transports');
  assert.equal(matchingSupplier('CAFE-DU-COIN CHE', rules).category, 'Loisirs');
  assert.equal(matchingSupplier('Coopérative habitation', rules), undefined);
  assert.equal(matchingSupplier('Supercoop', rules), undefined);
  assert.equal(categorizeOperation(operation({ label: 'Inconnu' }), rules).category, 'À catégoriser');
});
test('categorization preserves manual choices, ignored operations, transfers and card settlements', () => {
  for (const patch of [{ category: 'Loisirs' }, { status: 'ignored' }, { type: 'transfer' }, { type: 'card_payment' }]) {
    const original = operation(patch);
    assert.equal(categorizeOperation(original, DEFAULT_SUPPLIERS), original);
  }
  assert.equal(categorizeOperation(operation({ type: 'income' }), DEFAULT_SUPPLIERS).category, 'Alimentation');
  for (const value of [{ name: '', category: 'Alimentation' }, { name: 'Coop', category: 'À catégoriser' }, { name: 'Coop', category: 'Inventée' }, { name: '%%', category: 'Autres' }]) assert.throws(() => validateSupplier(value));
});
test('an old workspace gets the supplier tab once, with defaults, without touching other tabs', async () => {
  const store = new GoogleStore();
  const sheets = [{ properties: { title: 'Operations', sheetId: 101 } }];
  let writes = 0;
  store.context = async () => ({ base: 'https://example.test' });
  store.request = async () => ({ sheets });
  store.json = async (url, method, body) => {
    writes++;
    assert.equal(body.requests.length, 2);
    assert.equal(body.requests[0].addSheet.properties.title, 'Fournisseurs');
    assert.deepEqual(body.requests[1].updateCells.rows[1].values.map(c => c.userEnteredValue.stringValue), ['default-coop', 'Coop', 'Alimentation']);
    sheets.push({ properties: body.requests[0].addSheet.properties });
  };
  await Promise.all([store.ensureSuppliers(), store.ensureSuppliers()]);
  assert.equal(writes, 1);
  store.suppliersReady = false;
  await store.ensureSuppliers();
  assert.equal(writes, 1);
});
test('bulk categorization changes only category cells of matching uncategorized operations', async () => {
  const store = new GoogleStore();
  const operations = [operation(), operation({ id: 'manual', category: 'Loisirs', _row: 3 }), operation({ id: 'ignored', status: 'ignored', _row: 4 }), operation({ id: 'unknown', label: 'Inconnu', _row: 5 })];
  store.read = async () => ({ operations, suppliers: DEFAULT_SUPPLIERS });
  store.context = async () => ({ base: 'https://example.test' });
  let body;
  store.json = async (url, method, value) => { body = value; };
  assert.deepEqual(await store.categorizeOperations(), { updated: 1 });
  assert.deepEqual(body, { valueInputOption: 'RAW', data: [{ range: 'Operations!H2', values: [['Alimentation']] }] });
});
test('rereading applies rules to new lines while preserving existing categories', async () => {
  const store = new GoogleStore();
  store.read = async () => ({ documents: [{ id: 'doc', _row: 2 }], operations: [operation({ category: 'Loisirs' })], suppliers: DEFAULT_SUPPLIERS });
  store.context = async () => ({ base: 'https://example.test' });
  store.request = async () => ({ sheets: [{ properties: { title: 'Operations', sheetId: 101 } }, { properties: { title: 'Documents', sheetId: 100 } }] });
  let batch;
  store.json = async (url, method, body) => { batch = body; };
  await store.replaceImport({ id: 'doc' }, [operation({ id: 'new' }), operation({ id: 'second', label: 'Migros Lausanne' })]);
  const rows = batch.requests.at(-1).appendCells.rows;
  assert.equal(rows[0].values[7].userEnteredValue.stringValue, 'Loisirs');
  assert.equal(rows[1].values[7].userEnteredValue.stringValue, 'Alimentation');
});
test('supplier API supports create/edit/delete, rejects duplicates and applies saved rules', async t => {
  const data = { documents: [], operations: [operation()], budgets: [], suppliers: [] };
  const store = new GoogleStore();
  store.read = async () => structuredClone(data);
  store.context = async () => ({ base: 'https://example.test' });
  store.writeRow = async (table, value, row) => {
    assert.equal(table, 'Fournisseurs');
    const index = data.suppliers.findIndex(s => s.id === value.id);
    if (index < 0) data.suppliers.push({ ...value, _row: 2 }); else data.suppliers[index] = { ...value, _row: row };
    return value;
  };
  store.json = async (url, method, body) => {
    if (url.includes(':clear')) data.suppliers = [];
    else if (url.includes('values:batchUpdate')) data.operations[0].category = body.data[0].values[0][0];
    else throw new Error('Unexpected request');
  };
  const server = createApp(store).listen(0, '127.0.0.1');
  t.after(() => { server.closeAllConnections(); server.close(); });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method, body) => fetch(base + path, { method, headers: { 'X-MyCompta': '1', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let response = await request('/api/suppliers', 'POST', { name: 'Coop', category: 'Alimentation' });
  assert.equal(response.status, 201);
  const supplier = await response.json();
  response = await request('/api/suppliers', 'POST', { name: 'COOP', category: 'Autres' });
  assert.equal(response.status, 409);
  response = await request('/api/suppliers/' + supplier.id, 'PUT', { name: 'Coop', category: 'Loisirs' });
  assert.equal(response.status, 200);
  response = await request('/api/categorize', 'POST');
  assert.deepEqual(await response.json(), { updated: 1 });
  assert.equal(data.operations[0].category, 'Loisirs');
  response = await request('/api/categorize', 'POST');
  assert.deepEqual(await response.json(), { updated: 0 });
  response = await request('/api/suppliers/' + supplier.id, 'DELETE');
  assert.equal(response.status, 200);
  assert.equal(data.suppliers.length, 0);
  assert.equal(data.operations[0].category, 'Loisirs');
  response = await request('/api/suppliers/not-found', 'PUT', { name: 'Coop', category: 'Autres' });
  assert.equal(response.status, 404);
});
