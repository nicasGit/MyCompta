const test = require('node:test');
const assert = require('node:assert/strict');
const { GoogleStore } = require('../google/store');
const { categorizeOperation } = require('../services/suppliers');

test('short filters match future descriptions and rescan changes only validated selections that remain uncategorized', async () => {
  const store = new GoogleStore();
  const base = { date: '2026-10-01', amount: 10, currency: 'CHF', type: 'expense', status: 'validated', category: 'À catégoriser' };
  const data = { operations: [
    { ...base, id: 'one', label: 'toto titi 1829', _row: 2 },
    { ...base, id: 'two', label: 'TOTO Paris 9999', _row: 3 },
    { ...base, id: 'manual', label: 'TOTO Paris', category: 'Loisirs', _row: 4 },
    { ...base, id: 'ignored', label: 'toto', status: 'ignored', _row: 5 },
    { ...base, id: 'transfer', label: 'toto', type: 'transfer', _row: 6 }
  ], suppliers: [], categories: [] };
  store.read = async () => structuredClone(data);
  store.context = async () => ({ base: 'https://sheets.example' });
  const requests = [];
  store.json = async (url, method, body) => requests.push(body);
  await store.assignCategory('one', 'Alimentation', 'toto');
  const [id, name, category] = requests[0].data[1].values[0];
  assert.equal(name, 'toto');
  data.suppliers.push({ id, name, category, _row: 2 });
  await assert.rejects(() => store.assignCategory('one', 'Alimentation', 'autre'), /ne correspond pas/);
  const preview = await store.previewCategorization();
  assert.deepEqual(preview.map(item => item.id), ['one', 'two']);
  assert.equal(requests.length, 1); // Preview does not write.
  assert.deepEqual(await store.confirmCategorization([{ id: 'two', category: 'Alimentation' }]), { updated: 1 });
  assert.deepEqual(requests[1].data, [{ range: 'Operations!H3', values: [['Alimentation']] }]);
  data.operations[1].category = 'Loisirs';
  await assert.rejects(() => store.confirmCategorization([{ id: 'two', category: 'Alimentation' }]), /changé/);
  await assert.rejects(() => store.confirmCategorization([{ id: 'one', category: 'Alimentation' }, { id: 'one', category: 'Alimentation' }]), /invalide/);
  assert.equal(requests.length, 2);
});

test('quick category atomically writes a category and reusable supplier rule without modifying financial cells', async () => {
  const store = new GoogleStore();
  const data = { operations: [{ id: 'op', label: 'Animalerie Lausanne', type: 'expense', status: 'validated', _row: 8 }], suppliers: [], categories: [{ name: 'Animaux' }] };
  store.read = async () => structuredClone(data);
  store.context = async () => ({ base: 'https://sheets.example' });
  const requests = [];
  store.json = async (url, method, body) => { requests.push({ url, method, body }); };
  const result = await store.assignCategory('op', 'Animaux');
  assert.deepEqual(result, { category: 'Animaux', supplier: 'Animalerie Lausanne' });
  assert.equal(requests.length, 1);
  const { body } = requests[0];
  assert.equal(body.valueInputOption, 'RAW');
  assert.deepEqual(body.data[0], { range: 'Operations!H8', values: [['Animaux']] });
  assert.equal(body.data[1].range, 'Fournisseurs!A2:C2');
  const [id, name, category] = body.data[1].values[0];
  assert.ok(id);
  assert.equal(categorizeOperation({ label: 'ANIMALERIE LAUSANNE', category: 'À catégoriser', type: 'expense' }, [{ id, name, category }]).category, 'Animaux');
  data.suppliers.push({ id, name, category, _row: 4 });
  await store.assignCategory('op', 'Loisirs');
  assert.equal(requests[1].body.data[1].range, 'Fournisseurs!A4:C4');
  assert.equal(requests[1].body.data[1].values[0][0], id);
  await assert.rejects(() => store.assignCategory('op', 'Inconnue'), /catégorie/);
  await assert.rejects(() => store.assignCategory('absent', 'Animaux'), /introuvable/);
  data.operations[0].status = 'ignored';
  await assert.rejects(() => store.assignCategory('op', 'Animaux'), /classée/);
  assert.equal(requests.length, 2);
});
