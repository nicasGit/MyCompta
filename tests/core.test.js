const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { validateOperation, summarize } = require('../services/operations');
const { parsePages, extractPdf } = require('../services/pdf');
const { GoogleStore, TABLES } = require('../google/store');
const { createApp } = require('../app');

const operation = overrides => ({ id: 'op', date: '2026-11-02', label: 'Migros', amount: 12.35, currency: 'CHF', category: 'Alimentation', type: 'expense', status: 'validated', account: 'UBS', documentId: '', ...overrides });
function pdf(text) {
  const stream = `BT /F1 12 Tf 40 750 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(content)); content += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(content);
}
test('validation refuses impossible dates, invalid amounts and unknown currencies', () => {
  assert.equal(validateOperation(operation()).amount, 12.35);
  for (const patch of [{ date: '2026-02-30' }, { amount: -10 }, { amount: NaN }, { currency: '???' }, { status: 'approved' }, { page: -1 }]) assert.throws(() => validateOperation(operation(patch)));
});
test('summary separates currencies and excludes pending, ignored, transfers and card settlements', () => {
  const result = summarize([operation(), operation({ amount: 0.1 }), operation({ amount: 0.2 }), operation({ amount: 9, currency: 'EUR' }), operation({ type: 'transfer' }), operation({ type: 'card_payment' }), operation({ type: 'income' }), operation({ status: 'pending' }), operation({ status: 'ignored' }), operation({ date: '2026-10-01' })], '2026-11');
  assert.deepEqual(result.totals, { CHF: 12.65, EUR: 9 });
  assert.equal(result.count, 4);
  assert.equal(result.pending, 1);
});
test('generic extraction retains page and raw text, rejects balances, ambiguous columns and invalid dates', () => {
  const rows = parsePages([{ num: 2, text: "02.11.2026 Migros 42.30 CHF\n03/11/2026 Loyer 1'650.00\n04.11.2026 Librairie -12,50 EUR\n31.02.2026 Impossible 12.00\n05.11.2026 Solde 500.00\n06.11.2026 Achat 20.00 30.00" }]);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].amount, 1650);
  assert.equal(rows[2].currency, 'EUR');
  assert.equal(rows[2].amount, 12.5);
  assert.equal(rows[0].page, 2);
  assert.match(rows[0].raw, /Migros/);
});
test('real PDF text extraction and no-candidate fallback', async () => {
  const result = await extractPdf(pdf('02.11.2026 Migros 42.30 CHF'));
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].amount, 42.3);
  assert.equal(result.operations[0].page, 1);
  const empty = await extractPdf(pdf('Document sans operation'));
  assert.equal(empty.operations.length, 0);
  assert.match(empty.note, /manuellement/);
});

async function withStore(t, handler) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mycompta-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new GoogleStore({ directory, env: { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' }, fetchImpl: handler });
  await store.save('token', { access_token: 'test-token', expires_at: Date.now() + 3600000 });
  await store.save('resources', { folderId: 'folder', spreadsheetId: 'sheet' });
  return store;
}
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
test('Drive and Sheets use the narrow file scope, atomic imports and literal cell values', async t => {
  let batch;
  const store = await withStore(t, async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    if (url.endsWith('?fields=sheets.properties')) return json({ sheets: Object.keys(TABLES).map((title, i) => ({ properties: { title, sheetId: i + 100 } })) });
    if (url.endsWith(':batchUpdate')) { batch = JSON.parse(options.body); return json({}); }
    throw new Error('Unexpected request: ' + url);
  });
  const auth = new URL(store.authorizationUrl('state'));
  assert.equal(auth.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  assert.equal(auth.searchParams.get('access_type'), 'offline');
  await store.appendImport({ id: 'doc', name: '=HYPERLINK("evil")' }, [operation({ label: '=IMPORTXML("evil")' })]);
  assert.equal(batch.requests.length, 2);
  assert.deepEqual(batch.requests[0].appendCells.rows[0].values[1], { userEnteredValue: { stringValue: '=HYPERLINK("evil")' } });
  assert.deepEqual(batch.requests[1].appendCells.rows[0].values[3], { userEnteredValue: { stringValue: '=IMPORTXML("evil")' } });
});
test('Drive resumes import by hash and uploads PDF bytes with metadata', async t => {
  const requests = [];
  const store = await withStore(t, async (url, options) => {
    requests.push([url, options]);
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) return json({ files: [] });
    if (url.includes('uploadType=resumable')) return new Response('', { status: 200, headers: { location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=test' } });
    return json({ id: 'pdf' });
  });
  const bytes = pdf('test');
  assert.deepEqual(await store.uploadPdf(bytes, 'releve.pdf', 'abc'), { id: 'pdf' });
  assert.match(new URL(requests[0][0]).searchParams.get('q'), /sha256.*abc/);
  assert.equal(JSON.parse(requests[1][1].body).parents[0], 'folder');
  assert.equal(requests[2][1].method, 'PUT');
  assert.deepEqual(requests[2][1].body, bytes);
  requests.length = 0;
  store.fetch = async () => json({ files: [{ id: 'existing' }] });
  assert.deepEqual(await store.uploadPdf(bytes, 'releve.pdf', 'abc'), { id: 'existing' });
});
test('expired tokens refresh once for concurrent Google requests', async t => {
  let count = 0;
  const store = await withStore(t, async url => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    count++;
    return json({ access_token: 'renewed', expires_in: 3600 });
  });
  await store.save('token', { refresh_token: 'refresh', expires_at: 0 });
  assert.deepEqual(await Promise.all([store.accessToken(), store.accessToken()]), ['renewed', 'renewed']);
  assert.equal(count, 1);
  assert.equal((await store.load('token')).refresh_token, 'refresh');
});

test('setup initializes missing tabs without colliding with default tab, then runs idempotently', async t => {
  const sheets = [{ properties: { title: 'Sheet1', sheetId: 0 } }];
  let updates = 0;
  const store = await withStore(t, async (url, options) => {
    if (url.endsWith('?fields=sheets.properties')) return json({ sheets });
    if (url.endsWith(':batchUpdate')) {
      updates++;
      const requests = JSON.parse(options.body).requests;
      for (const request of requests) if (request.addSheet) sheets.push({ properties: request.addSheet.properties });
      assert.equal(requests.filter(r => r.addSheet).length, 5);
      assert.ok(requests.filter(r => r.addSheet).every(r => r.addSheet.properties.sheetId >= 100));
      return json({});
    }
    if (url.includes('/values:batchGet?')) return json({ valueRanges: Object.values(TABLES).map(columns => ({ values: [columns] })) });
    throw new Error('Unexpected request: ' + url);
  });
  assert.equal((await store.initialize()).ready, true);
  await store.initialize();
  assert.equal(updates, 1);
});

test('Sheets reads reject altered headers and invalid financial rows instead of showing wrong totals', async t => {
  let badHeader = true;
  const store = await withStore(t, async () => json({ valueRanges: Object.entries(TABLES).map(([table, columns]) => ({ values: [badHeader && table === 'Operations' ? ['modified'] : columns, ...(table === 'Operations' ? [columns.map(c => operation({ currency: 'BAD' })[c] ?? '')] : [])] })) }));
  await assert.rejects(() => store.read(), /en-têtes/);
  badHeader = false;
  await assert.rejects(() => store.read(), /ligne 2/);
});

test('HTTP flow: upload, deduplication, corrections, budgets and cross-origin protection', async t => {
  const data = { documents: [], operations: [], budgets: [] };
  let uploads = 0;
  const fake = { configured: true, status: async () => ({ configured: true, connected: true, ready: true }), read: async () => structuredClone(data),
    uploadPdf: async () => { uploads++; return { id: 'drive-pdf' }; },
    appendImport: async (doc, rows) => { data.documents.push(doc); data.operations.push(...rows); },
    saveOperation: async value => { const i = data.operations.findIndex(o => o.id === value.id); if (i >= 0) data.operations[i] = value; else data.operations.push(value); return value; },
    saveBudget: async value => { data.budgets.push(value); return value; } };
  const server = createApp(fake).listen(0, '127.0.0.1');
  t.after(() => { server.closeAllConnections(); server.close(); });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(base + '/');
  assert.match(await response.text(), /MyCompta/);
  assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(base + '/api/budgets', { method: 'POST' })).status, 403);
  assert.equal((await fetch(base + '/api/budgets', { method: 'POST', headers: { 'X-MyCompta': '1', Origin: 'https://evil.test' } })).status, 403);
  response = await fetch(base + '/api/documents?name=test.pdf&source=UBS', { method: 'POST', headers: { 'X-MyCompta': '1', 'Content-Type': 'application/pdf' }, body: pdf('02.11.2026 Migros 42.30 CHF') });
  assert.equal(response.status, 201);
  const imported = await response.json();
  assert.equal(imported.count, 1);
  assert.equal(data.operations[0].status, 'pending');
  response = await fetch(base + '/api/documents?name=test.pdf&source=UBS', { method: 'POST', headers: { 'X-MyCompta': '1', 'Content-Type': 'application/pdf' }, body: pdf('02.11.2026 Migros 42.30 CHF') });
  assert.equal((await response.json()).duplicate, true);
  assert.equal(uploads, 1);
  const op = data.operations[0];
  response = await fetch(base + '/api/operations/' + op.id, { method: 'PUT', headers: { 'X-MyCompta': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...op, category: 'Alimentation', status: 'validated' }) });
  assert.equal(response.status, 200);
  response = await fetch(base + '/api/data?month=2026-11');
  assert.deepEqual((await response.json()).summary.totals, { CHF: 42.3 });
  response = await fetch(base + '/api/budgets', { method: 'POST', headers: { 'X-MyCompta': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ month: '2026-11', category: 'Alimentation', amount: 600 }) });
  assert.equal(response.status, 200);
  assert.equal(data.budgets[0].amount, 600);
  response = await fetch(base + '/api/documents', { method: 'POST', headers: { 'X-MyCompta': '1', 'Content-Type': 'application/pdf' }, body: 'not a PDF' });
  assert.equal(response.status, 400);
  response = await fetch(base + '/auth/callback?state=evil&code=evil', { redirect: 'manual' });
  assert.equal(response.headers.get('location'), '/?error=oauth');
});
