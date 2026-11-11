const test = require('node:test');
const assert = require('node:assert/strict');
const months = require('../public/document-months');
const { GoogleStore } = require('../google/store');

test('statement coverage identifies gaps per bank across years without guessing from import or purchase dates', () => {
  const documents = [
    { source: 'Cembra', name: 'Cembra - 2025-12-31.pdf' },
    { source: 'Cembra', name: 'releve.pdf', statementMonth: '2026-02' },
    { source: 'Cembra', name: 'export.pdf', statementMonth: '2026-02' },
    { source: 'UBS', statementMonth: '2026-01' },
    { source: 'Cembra', name: 'document123.pdf', importedAt: '2026-01-01', date: '2026-01-02' }
  ];
  assert.deepEqual(months.coverage(documents, 'Cembra', '2025-12', '2026-02'), [
    { month: '2025-12', count: 1 }, { month: '2026-01', count: 0 }, { month: '2026-02', count: 2 }
  ]);
  assert.equal(months.month(documents[4]), '');
  assert.equal(months.month({ source: 'Cembra', name: 'Cembra - 2025-12-31.pdf', statementMonth: '2026-01' }), '2026-01');
  assert.deepEqual(months.coverage(documents, 'Cembra', '2026-02', '2025-01'), []);
});

test('correcting a statement month only updates its dedicated Sheets cell', async () => {
  const store = new GoogleStore();
  store.read = async () => ({ documents: [{ id: 'doc', _row: 3 }] });
  store.context = async () => ({ base: 'https://sheets.example' });
  let writes = 0;
  store.json = async (url, method, body) => {
    writes++;
    assert.equal(url, 'https://sheets.example/values/Documents!K3?valueInputOption=RAW');
    assert.equal(method, 'PUT');
    assert.deepEqual(body, { values: [['2026-10']] });
  };
  assert.deepEqual(await store.setDocumentMonth('doc', '2026-10'), { month: '2026-10' });
  await assert.rejects(() => store.setDocumentMonth('doc', '2026-13'), /invalide/);
  await assert.rejects(() => store.setDocumentMonth('absent', '2026-10'), /introuvable/);
  assert.equal(writes, 1);
});
