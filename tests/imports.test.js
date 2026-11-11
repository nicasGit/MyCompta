const test = require('node:test');
const assert = require('node:assert/strict');
const { contentHash, matchingDocument } = require('../services/document-duplicates');
const { run } = require('../public/imports');

test('document fingerprints preserve repeated purchases and reject only identical complete transaction sets', () => {
  const a = { date: '2026-10-10', label: 'Coop', amount: 25.1, currency: 'CHF', type: 'expense', cardLast4: '3706', holder: 'Florence' };
  const b = { ...a, date: '2026-10-11' };
  const fingerprint = contentHash('Cembra', [a, a, b]);
  assert.equal(contentHash('Cembra', [b, { ...a, category: 'Autres', status: 'ignored' }, a]), fingerprint);
  assert.notEqual(contentHash('Cembra', [a, b]), fingerprint);
  assert.notEqual(contentHash('Cembra', [a, a, { ...b, cardLast4: '1819' }]), fingerprint);
  assert.notEqual(contentHash('UBS', [a, a, b]), fingerprint);
  assert.notEqual(contentHash('Cembra', [a, a, { ...b, type: 'income' }]), fingerprint);
  assert.equal(contentHash('Cembra', []), '');
  const document = { id: 'doc', source: 'Cembra', contentHash: fingerprint };
  assert.equal(matchingDocument({ documents: [document], operations: [] }, 'Cembra', fingerprint), document);
  const legacy = { id: 'legacy', source: 'Cembra' };
  assert.equal(matchingDocument({ documents: [legacy], operations: [a, a, b].map(o => ({ ...o, documentId: 'legacy' })) }, 'Cembra', fingerprint), legacy);
  assert.equal(matchingDocument({ documents: [document], operations: [] }, 'Cembra', ''), null);
});

test('batch imports are sequential and continue after oversized files and upload failures', async () => {
  const calls = [], reports = [];
  let active = 0;
  const results = await run([
    { name: 'a.pdf', size: 10 }, { name: 'large.pdf', size: 16 * 1024 * 1024 },
    { name: 'bad.pdf', size: 10 }, { name: 'b.pdf', size: 10 }
  ], 'Cembra', async (file, source) => {
    assert.equal(source, 'Cembra');
    assert.equal(active++, 0);
    await Promise.resolve();
    active--;
    calls.push(file.name);
    if (file.name === 'bad.pdf') throw new Error('PDF invalide');
    return { count: 2, duplicate: file.name === 'b.pdf' };
  }, report => reports.push(report.index));
  assert.deepEqual(calls, ['a.pdf', 'bad.pdf', 'b.pdf']);
  assert.equal(results.length, 4);
  assert.match(results[1].error, /15 Mo/);
  assert.equal(results[2].error, 'PDF invalide');
  assert.equal(results[3].response.duplicate, true);
  assert.equal(reports.at(-1), 3);
});

