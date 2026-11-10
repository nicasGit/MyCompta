const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const { GoogleStore } = require('./google/store');
const { extractPdf } = require('./services/pdf');
const { validateOperation, summarize, CATEGORIES } = require('./services/operations');
const { exec } = require("child_process");

try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }

function createApp(store = new GoogleStore()) {
  const app = express();
  const origin = `http://localhost:${process.env.PORT || 3001}`;
  const states = new Map();
  let queue = Promise.resolve();
  const serialize = fn => {
    const task = queue.then(fn);
    queue = task.catch(() => { });
    return task;
  };
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!['localhost', '127.0.0.1'].includes(req.hostname)) return res.status(403).send('Accès local uniquement.');
    res.set({
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    });
    if (req.path.startsWith('/api')) {
      res.set('Cache-Control', 'no-store');
      if (req.method !== 'GET' && (req.get('X-MyCompta') !== '1' || (req.get('Origin') && req.get('Origin') !== origin))) {
        return res.status(403).json({ error: 'Requête non autorisée. Ouvrez MyCompta sur ' + origin });
      }
    }
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.get('/api/status', async (req, res) => res.json(await store.status()));
  app.get('/auth/google', (req, res) => {
    if (!store.configured) return res.redirect('/?error=configuration');
    for (const [key, expires] of states) if (expires < Date.now()) states.delete(key);
    const state = crypto.randomBytes(32).toString('hex');
    states.set(state, Date.now() + 600000);
    res.cookie('oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 600000, path: '/auth' });
    res.redirect(store.authorizationUrl(state));
  });
  app.get('/auth/callback', async (req, res) => {
    const cookie = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('oauth_state='))?.slice(12);
    const { state, code } = req.query;
    const valid = typeof state === 'string' && state === cookie && states.get(state) > Date.now();
    states.delete(state);
    res.clearCookie('oauth_state', { path: '/auth' });
    if (!valid || typeof code !== 'string') return res.redirect('/?error=oauth');
    try { await store.exchangeCode(code); res.redirect('/'); }
    catch (error) { res.redirect(error.status === 409 ? '/?error=compte' : '/?error=connexion'); }
  });
  app.post('/api/setup', async (req, res) => res.json(await serialize(() => store.initialize())));
  app.post('/api/disconnect', async (req, res) => { await serialize(() => store.disconnect()); res.json({ ok: true }); });
  app.get('/api/data', async (req, res) => {
    const data = await store.read();
    res.json({ ...data, categories: CATEGORIES, summary: summarize(data.operations, req.query.month) });
  });
  app.post('/api/documents', express.raw({ type: 'application/pdf', limit: '15mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
      return res.status(400).json({ error: 'Sélectionnez un PDF valide (15 Mo maximum).' });
    }
    const name = String(req.query.name || 'document.pdf').replace(/[\\/\x00-\x1f]/g, '_').slice(0, 180);
    const source = String(req.query.source || 'Autre');
    if (!['UBS', 'PostFinance', 'Cembra', 'TopCard', 'Autre'].includes(source)) return res.status(400).json({ error: 'Source inconnue.' });
    const hash = crypto.createHash('sha256').update(req.body).digest('hex');
    const result = await serialize(async () => {
      const data = await store.read();
      const existing = data.documents.find(d => d.hash === hash);
      if (existing) return { duplicate: true, document: existing };
      const parsed = await extractPdf(req.body, source);
      const file = await store.uploadPdf(req.body, name, hash);
      const document = {
        id: crypto.randomUUID(), name, source, driveId: file.id, hash,
        importedAt: new Date().toISOString(), status: parsed.operations.length ? 'À vérifier' : 'Saisie nécessaire', note: parsed.note
      };
      const operations = parsed.operations.map(o => ({
        ...o, id: crypto.randomUUID(), documentId: document.id,
        account: source, category: 'À catégoriser', type: o.type || 'expense', status: 'pending'
      }));
      await store.appendImport(document, operations);
      return { document, count: operations.length, note: parsed.note };
    });
    res.status(result.duplicate ? 200 : 201).json(result);
  });
  app.post('/api/operations', async (req, res) => {
    const operation = validateOperation(req.body);
    const result = await serialize(async () => {
      const data = await store.read();
      if (operation.documentId && !data.documents.some(d => d.id === operation.documentId)) throw Object.assign(new Error('Document introuvable.'), { status: 400 });
      return store.saveOperation({ ...operation, id: crypto.randomUUID() });
    });
    res.status(201).json(result);
  });
  app.post('/api/documents/:id/reanalyse', async (req, res) => {
    const result = await serialize(async () => {
      const data = await store.read();
      const document = data.documents.find(d => d.id === req.params.id);
      if (!document) throw Object.assign(new Error('Document introuvable.'), { status: 404 });
      if (document.source !== 'Cembra') throw Object.assign(new Error('Cette relecture est réservée aux relevés Cembra.'), { status: 400 });
      if (data.operations.some(o => o.documentId === document.id && o.status !== 'pending')) throw Object.assign(new Error('Ce document contient des opérations déjà validées ou ignorées. La relecture est bloquée pour préserver vos décisions.'), { status: 409 });
      const buffer = await store.downloadPdf(document.driveId);
      const parsed = await extractPdf(buffer, 'Cembra');
      if (!parsed.operations.length) throw Object.assign(new Error(parsed.note + ' Les opérations existantes sont conservées.'), { status: 422 });
      const operations = parsed.operations.map(o => ({ ...o, id: crypto.randomUUID(), documentId: document.id,
        account: 'Cembra', category: 'À catégoriser', type: o.type, status: 'pending' }));
      await store.replacePendingImport({ ...document, note: parsed.note, status: 'À vérifier' }, operations);
      return { count: operations.length, note: parsed.note };
    });
    res.json(result);
  });
  app.put('/api/operations/:id', async (req, res) => {
    const operation = validateOperation(req.body);
    res.json(await serialize(() => store.saveOperation({ ...operation, id: req.params.id }, true)));
  });
  app.post('/api/budgets', async (req, res) => {
    const { month, category, amount } = req.body;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') || !CATEGORIES.includes(category) || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ error: 'Mois, catégorie ou montant du budget invalide.' });
    }
    res.json(await serialize(() => store.saveBudget({ month, category, amount: Math.round(amount * 100) / 100 })));
  });
  app.use(express.static(path.join(__dirname, 'public')));
  app.use((error, req, res, next) => {
    const status = error.type === 'entity.too.large' ? 413 : error.status || 500;
    res.status(status).json({ error: status === 413 ? 'Le fichier dépasse la limite de 15 Mo.' : error.message || 'Une erreur est survenue.' });
  });
  return app;
}
function start() {
  const port = Number(process.env.PORT || 3001);


  const resu = createApp().listen(port, '127.0.0.1', () => console.log(`MyCompta : http://localhost:${port}`));

  //exec('start chrome http://localhost:${port}');

  return resu;
}


module.exports = { createApp, start };
