const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { parseCembraTables } = require('../parsers/cembra');
const { extractPdf } = require('../services/pdf');
const { createApp } = require('../app');
const { GoogleStore } = require('../google/store');
const header = ['Date de trans.', 'Date de com.', 'Description', 'Crédit CHF', 'Débit CHF'];
const row = (label = 'Coop-5145 Savigny Savigny CHE', credit = '', debit = '34.05') => ['28.09.2026', '29.09.2026', label, credit, debit];

test('Cembra reads details across pages and excludes summary tables, totals and advertising', () => {
  const result = parseCembraTables([
    { num: 1, tables: [[['Récapitulatif', 'Montant CHF'], ['Solde', '1500.00']], [['28.09.2026', '29.09.2026', 'Hors détail', '', '99.00']]] },
    { num: 2, tables: [[header, row(), row('TEMU.COM BASEL DUB', '', '53.82'), ['', '', 'Total', '', '87.87'], row('Après total', '', '87.87')]] },
    { num: 3, tables: [[header, row('Coop-1959 Oron-la- Oron-la-Ville CHE', '', '19.45'), row('Coop-5145 Savigny Savigny CHE', '', '12.85')]] },
  ]);
  assert.deepEqual(result.operations.map(o => o.amount), [34.05, 53.82, 19.45, 12.85]);
  assert.deepEqual(result.operations.map(o => o.page), [2, 2, 3, 3]);
  assert.ok(result.operations.every(o => o.type === 'expense' && o.currency === 'CHF' && o.date === '2026-09-28'));
  assert.match(result.operations[0].raw, /29.09.2026/);
});
test('Cembra supports continuation pages and wrapped merchant names without merging separate purchases', () => {
  const result = parseCembraTables([
    { num: 2, tables: [[header, row(), ['', '', 'SUISSE', '', '']]] },
    { num: 3, tables: [[row(), row()]] },
  ]);
  assert.equal(result.operations.length, 3);
  assert.match(result.operations[0].label, /SUISSE$/);
  assert.deepEqual(result.operations.map(o => o.page), [2, 3, 3]);
});
test('Cembra preserves the direction of credits and refuses ambiguous or impossible rows', () => {
  const result = parseCembraTables([{ num: 1, tables: [[header,
    row('Remboursement magasin', '15.50', ''), row('Paiement reçu', "1'250.00", ''),
    row('Double montant', '12.00', '34.00'), row('Montant illisible', '', 'abc'),
    ['31.09.2026', '01.10.2026', 'Date impossible', '', '5.00'],
    row('Achat', '', '1’234,50'),
  ]] }]);
  assert.deepEqual(result.operations.map(o => [o.amount, o.type]), [[15.5, 'income'], [1250, 'card_payment'], [1234.5, 'expense']]);
  assert.equal(result.rejected, 3);
});

test('each table on the same page uses its own preceding card heading', () => {
  const transaction = row();
  const text = [
    'Carte principale Certo! Mastercard se termine par XXXX XXXX XXXX 3706 FLORENCE GALLEZ',
    header.join(' '), transaction.join(' '),
    'Carte supplémentaire Certo! Mastercard se termine par XXXX XXXX XXXX 1819 NICOLAS JOLLOIS',
    header.join(' '), transaction.join(' '),
  ].join('\n');
  const result = parseCembraTables([{ num: 1, tables: [[header, transaction], [header, transaction]] }], [{ num: 1, text }]);
  assert.deepEqual(result.operations.map(o => o.holder), ['FLORENCE GALLEZ', 'NICOLAS JOLLOIS']);
  assert.deepEqual(result.operations.map(o => o.cardLast4), ['3706', '1819']);
});

test('a missing card heading stays unknown; a headerless continuation retains its card', () => {
  const result = parseCembraTables([
    { num: 1, tables: [[header, row()]] }, { num: 2, tables: [[row()]] },
    { num: 3, tables: [[header, row()]] },
  ], [{ num: 1, text: 'Carte principale Certo! Mastercard se termine par XXXX XXXX XXXX 3706 FLORENCE GALLEZ\n' + row().join(' ') }]);
  assert.deepEqual(result.operations.map(o => o.holder), ['FLORENCE GALLEZ', 'FLORENCE GALLEZ', undefined]);
});

// A real two-page PDF with ruled tables, including empty credit cells.
function cembraPdf(mode = 'debit') {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  for (let page = 0; page < 2; page++) {
    const commands = ['0.5 w'];
    const xs = [20, 110, 200, 400, 490, 580];
    for (const x of xs) commands.push(`${x} 740 m ${x} 680 l S`);
    for (const y of [740, 710, 680]) commands.push(`20 ${y} m 580 ${y} l S`);
    const print = (text, x, y) => commands.push(`BT /F1 9 Tf ${x} ${y} Td (${text}) Tj ET`);
    print(page ? 'Carte suppl\351mentaire Certo! Mastercard se termine par XXXX XXXX XXXX 1819 NICOLAS JOLLOIS' : 'Carte principale Certo! Mastercard se termine par XXXX XXXX XXXX 3706 FLORENCE GALLEZ', 20, 760);
    ['Date de trans.', 'Date de com.', 'Description', 'Cr\351dit CHF', 'D\351bit CHF'].forEach((text, i) => print(text, xs[i] + 3, 720));
    if (mode !== 'empty') ['28.09.2026', '29.09.2026', page ? 'TEMU.COM BASEL DUB' : 'Coop Savigny CHE', mode === 'credit' ? '34.05' : '', mode === 'credit' ? '' : page ? '53.82' : '34.05'].forEach((text, i) => { if (text) print(text, xs[i] + 3, 690); });
    // Summary outside the table must never become a transaction.
    print('28.09.2026 Solde 2500.00 CHF', 20, 640);
    const stream = commands.join('\n');
    const pageId = 4 + page * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  }
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(content, 'latin1')); content += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(content, 'latin1');
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(content, 'latin1');
}
test('PDF table extraction preserves blank columns on a real multipage PDF', async () => {
  const result = await extractPdf(cembraPdf(), 'Cembra');
  assert.equal(result.operations.length, 2);
  assert.deepEqual(result.operations.map(o => [o.amount, o.type, o.page]), [[34.05, 'expense', 1], [53.82, 'expense', 2]]);
  assert.deepEqual(result.operations.map(o => [o.holder, o.cardLast4, o.cardType]), [
    ['FLORENCE GALLEZ', '3706', 'principale'], ['NICOLAS JOLLOIS', '1819', 'supplémentaire'],
  ]);
});
test('HTTP Cembra imports use the dedicated parser and reanalyse the archived PDF without uploading again', async t => {
  const data = { documents: [], operations: [], budgets: [] };
  let uploads = 0, replacements = 0;
  const fake = { read: async () => structuredClone(data), uploadPdf: async () => { uploads++; return { id: 'pdf' }; },
    appendImport: async (doc, ops) => { data.documents.push(doc); data.operations.push(...ops); },
    downloadPdf: async () => cembraPdf('credit'), replacePendingImport: async (doc, ops) => { replacements++; data.operations = ops; } };
  const server = createApp(fake).listen(0, '127.0.0.1');
  t.after(() => { server.closeAllConnections(); server.close(); });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/api/documents?source=Cembra', { method: 'POST', headers: { 'X-MyCompta': '1', 'Content-Type': 'application/pdf' }, body: cembraPdf() });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).count, 2);
  assert.equal(data.operations[0].holder, 'FLORENCE GALLEZ');
  const url = base + '/api/documents/' + data.documents[0].id + '/reanalyse';
  const again = await fetch(url, { method: 'POST', headers: { 'X-MyCompta': '1' } });
  assert.equal(again.status, 200);
  assert.equal(replacements, 1);
  assert.equal(uploads, 1);
  assert.ok(data.operations.every(o => o.type === 'income'));
  assert.equal(data.operations[1].holder, 'NICOLAS JOLLOIS');
  fake.downloadPdf = async () => cembraPdf('empty');
  const empty = await fetch(url, { method: 'POST', headers: { 'X-MyCompta': '1' } });
  assert.equal(empty.status, 422);
  assert.equal(replacements, 1);
  assert.equal(data.operations.length, 2);
  data.operations[0].status = 'validated';
  const blocked = await fetch(url, { method: 'POST', headers: { 'X-MyCompta': '1' } });
  assert.equal(blocked.status, 409);
  assert.equal(replacements, 1);
});
test('Sheets replaces only pending rows in descending order within one atomic update', async () => {
  let batch;
  const store = new GoogleStore({ fetchImpl: async () => { throw new Error('No real requests'); } });
  store.read = async () => ({ documents: [{ id: 'doc', _row: 4 }], operations: [{ documentId: 'doc', status: 'pending', _row: 3 }, { documentId: 'other', status: 'validated', _row: 5 }, { documentId: 'doc', status: 'pending', _row: 9 }] });
  store.context = async () => ({ base: 'https://example.test' });
  store.request = async () => ({ sheets: [{ properties: { title: 'Operations', sheetId: 101 } }, { properties: { title: 'Documents', sheetId: 100 } }] });
  store.json = async (url, method, body) => { batch = body; };
  await store.replacePendingImport({ id: 'doc' }, [{ id: 'new' }]);
  assert.deepEqual(batch.requests.slice(0, 2).map(r => r.deleteDimension.range.startIndex), [8, 2]);
  assert.equal(batch.requests[2].updateCells.start.rowIndex, 3);
  assert.equal(batch.requests[3].appendCells.sheetId, 101);
});
