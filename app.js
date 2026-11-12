const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const { GoogleStore } = require('./google/store');
const { extractPdf, suggestPdfName } = require('./services/pdf');
const { validateOperation, summarize } = require('./services/operations');
const { validateSupplier, categorizeOperation } = require('./services/suppliers');
const { categoryNames } = require('./services/categories');
const { contentHash, matchingDocument } = require('./services/document-duplicates');
const { exec } = require("child_process");
const { runtimeConfig } = require('./services/config');
const { Household } = require('./services/household');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }

function createApp(store = new GoogleStore(), config = runtimeConfig()) {
  const app = express();
  const origin = config.origin;
  const household = config.multiUser ? new Household(store, config.ownerEmail) : null;
  const cookie = (req, name) => req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='))?.slice(name.length + 1);
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: config.secure, path: '/' };
  const ownerOnly = (req, res, next) => config.multiUser && req.user?.role !== 'owner' ? res.status(403).json({ error: 'Cette action est réservée au propriétaire du foyer.' }) : next();
  const states = new Map();
  let queue = Promise.resolve();
  const serialize = fn => {
    const task = queue.then(fn);
    queue = task.catch(() => { });
    return task;
  };
  app.disable('x-powered-by');
  app.enable('case sensitive routing');
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use(async (req, res, next) => {
    if (!config.multiUser && !['localhost', '127.0.0.1'].includes(req.hostname)) return res.status(403).send('Accès local uniquement.');
    if (config.multiUser && req.hostname !== config.hostname) {
      if (req.method === 'GET' && req.path === '/') return res.redirect(origin + '/');
      return res.status(403).json({ error: 'Utilisez l’adresse MyCompta configurée.' });
    }
    res.set({
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    });
    if (req.path.startsWith('/api')) {
      res.set('Cache-Control', 'no-store');
      if (req.method !== 'GET' && (req.get('X-MyCompta') !== '1' || (config.multiUser ? req.get('Origin') !== origin : req.get('Origin') && req.get('Origin') !== origin))) {
        return res.status(403).json({ error: 'Requête non autorisée. Ouvrez MyCompta sur ' + origin });
      }
    }
    if (household) {
      req.user = await household.authenticate(cookie(req, 'mycompta_session'));
      if (req.path.startsWith('/api/') && req.path !== '/api/status' && !req.user) return res.status(401).json({ error: 'Connectez-vous à votre compte Google pour accéder au foyer.' });
    }
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  const statusFor = async req => {
    const status = await store.status();
    if (!household) return { ...status, multiUser: false };
    if (!req.user) return { configured: status.configured, connected: false, ready: false, multiUser: true, authenticated: false, user: null };
    return { ...status, multiUser: true, authenticated: true, connected: true, driveConnected: status.connected, role: req.user.role,
      user: { name: req.user.name, email: req.user.email }, sheetUrl: req.user.role === 'owner' ? status.sheetUrl : null, driveUrl: req.user.role === 'owner' ? status.driveUrl : null };
  };
  app.get('/api/status', async (req, res) => res.json(await statusFor(req)));
  app.get('/auth/google', async (req, res) => {
    if (!store.configured) return res.redirect('/?error=configuration');
    for (const [key, entry] of states) if (entry.expires < Date.now()) states.delete(key);
    const drive = !household || !(await store.status()).connected || req.query.drive === '1';
    if (household && req.query.drive === '1' && req.user?.role !== 'owner') return res.status(403).send('Seul le propriétaire peut reconnecter le stockage Google.');
    const state = crypto.randomBytes(32).toString('hex');
    states.set(state, { expires: Date.now() + 600000, drive });
    res.cookie('oauth_state', state, { ...cookieOptions, maxAge: 600000, path: '/auth' });
    res.redirect(store.authorizationUrl(state, drive));
  });
  app.get('/auth/callback', async (req, res) => {
    const cookie = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('oauth_state='))?.slice(12);
    const { state, code } = req.query;
    const entry = states.get(state);
    const valid = typeof state === 'string' && state === cookie && entry?.expires > Date.now();
    states.delete(state);
    res.clearCookie('oauth_state', { ...cookieOptions, path: '/auth' });
    if (!valid || typeof code !== 'string') return res.redirect('/?error=oauth');
    try {
      if (household) {
        const token = await store.authenticateCode(code, entry.drive);
        const login = await serialize(async () => {
          const result = await household.login(token.user);
          if (entry.drive && result.user.role === 'owner') await store.saveOwnerToken(token);
          return result;
        });
        res.cookie('mycompta_session', login.session, { ...cookieOptions, maxAge: 30 * 86400000 });
      } else await store.exchangeCode(code);
      res.redirect('/');
    }
    catch (error) { res.redirect(error.status === 403 ? '/?error=nonmembre' : error.status === 409 ? '/?error=compte' : '/?error=connexion'); }
  });
  app.post('/api/setup', ownerOnly, async (req, res) => { await serialize(() => store.initialize()); res.json(await statusFor(req)); });
  app.post('/api/disconnect', ownerOnly, async (req, res) => { await serialize(() => store.disconnect()); res.json({ ok: true }); });
  app.post('/api/logout', async (req, res) => {
    if (household) await serialize(() => household.logout(cookie(req, 'mycompta_session')));
    res.clearCookie('mycompta_session', cookieOptions); res.json({ ok: true });
  });
  app.get('/api/household', ownerOnly, async (req, res) => res.json(household ? await household.list() : { localOnly: true }));
  app.post('/api/household/members', ownerOnly, async (req, res) => {
    if (!household) return res.status(409).json({ error: 'Activez le mode multi-utilisateur pour gérer les membres.' });
    res.status(201).json(await serialize(() => household.add(req.body.email)));
  });
  app.delete('/api/household/members/:id', ownerOnly, async (req, res) => {
    if (!household) return res.status(409).json({ error: 'Mode multi-utilisateur non activé.' });
    res.json(await serialize(() => household.remove(req.params.id)));
  });
  app.get('/api/documents/:id/pdf', async (req, res) => {
    const data = await store.read();
    const document = data.documents.find(d => d.id === req.params.id);
    if (!document) return res.status(404).json({ error: 'Document introuvable.' });
    const pdf = await store.downloadPdf(document.driveId);
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(document.name)}`).type('application/pdf').send(pdf);
  });
  app.get('/api/data', async (req, res) => {
    const data = await store.read();
    res.json({ ...data, categories: categoryNames(data.categories), summary: summarize(data.operations, req.query.month) });
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
      const fingerprint = contentHash(source, parsed.operations);
      const sameData = matchingDocument(data, source, fingerprint);
      if (sameData) return { duplicate: true, duplicateReason: 'content', document: sameData };
      const storedName = parsed.suggestedName || name;
      const file = await store.uploadPdf(req.body, storedName, hash);
      if (parsed.suggestedName) await store.renamePdf(file.id, storedName);
      const document = {
        id: crypto.randomUUID(), name: storedName, source, driveId: file.id, hash, contentHash: fingerprint, statementMonth: parsed.statementMonth || '', createdBy: req.user?.email || '',
        importedAt: new Date().toISOString(), status: parsed.operations.length ? 'Importé' : 'Saisie nécessaire', note: parsed.note
      };
      const operations = parsed.operations.map(o => categorizeOperation({
        ...o, id: crypto.randomUUID(), documentId: document.id,
        account: source, category: 'À catégoriser', type: o.type || 'expense', status: 'validated', createdBy: req.user?.email || ''
      }, data.suppliers));
      await store.appendImport(document, operations);
      return { document, count: operations.length, note: parsed.note };
    });
    res.status(result.duplicate ? 200 : 201).json(result);
  });
  app.post('/api/operations', async (req, res) => {
    const operation = validateOperation(req.body, categoryNames((await store.read()).categories));
    const result = await serialize(async () => {
      const data = await store.read();
      if (operation.documentId && !data.documents.some(d => d.id === operation.documentId)) throw Object.assign(new Error('Document introuvable.'), { status: 400 });
      return store.saveOperation(categorizeOperation({ ...operation, id: crypto.randomUUID(), createdBy: req.user?.email || '' }, data.suppliers));
    });
    res.status(201).json(result);
  });
  app.post('/api/documents/:id/reanalyse', async (req, res) => {
    const result = await serialize(async () => {
      const data = await store.read();
      const document = data.documents.find(d => d.id === req.params.id);
      if (!document) throw Object.assign(new Error('Document introuvable.'), { status: 404 });
      if (!['Cembra', 'TopCard'].includes(document.source)) throw Object.assign(new Error('Relecture disponible pour Cembra et TopCard.'), { status: 400 });
      const buffer = await store.downloadPdf(document.driveId);
      const parsed = await extractPdf(buffer, document.source);
      if (!parsed.operations.length) throw Object.assign(new Error(parsed.note + ' Les opérations existantes sont conservées.'), { status: 422 });
      const operations = parsed.operations.map(o => ({ ...o, id: crypto.randomUUID(), documentId: document.id,
        account: document.source, category: 'À catégoriser', type: o.type, status: 'validated', createdBy: req.user?.email || '' }));
      const storedName = parsed.suggestedName || document.name;
      if (storedName !== document.name) await store.renamePdf(document.driveId, storedName);
      await store.replaceImport({ ...document, name: storedName, contentHash: contentHash(document.source, parsed.operations), statementMonth: document.statementMonth || parsed.statementMonth || '', note: parsed.note, status: 'Importé' }, operations);
      return { count: operations.length, note: parsed.note };
    });
    res.json(result);
  });
  app.post('/api/documents/:id/rename', async (req, res) => {
    const result = await serialize(async () => {
      const data = await store.read();
      const document = data.documents.find(d => d.id === req.params.id);
      if (!document) throw Object.assign(new Error('Document introuvable.'), { status: 404 });
      if (document.source !== 'Cembra') throw Object.assign(new Error('Le nom automatique est disponible pour Cembra.'), { status: 400 });
      const name = await suggestPdfName(await store.downloadPdf(document.driveId));
      if (!name) throw Object.assign(new Error('Date de facture absente ou ambiguë. Le nom actuel est conservé.'), { status: 422 });
      await store.renameDocument(document.id, name);
      return { name };
    });
    res.json(result);
  });
  app.put('/api/operations/:id', async (req, res) => {
    const operation = validateOperation(req.body, categoryNames((await store.read()).categories));
    res.json(await serialize(() => store.saveOperation({ ...operation, id: req.params.id }, true)));
  });
  app.post('/api/budgets', async (req, res) => {
    const { month, category, amount } = req.body;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') || !categoryNames((await store.read()).categories).includes(category) || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ error: 'Mois, catégorie ou montant du budget invalide.' });
    }
    res.json(await serialize(() => store.saveBudget({ month, category, amount: Math.round(amount * 100) / 100 })));
  });
  app.post('/api/suppliers', async (req, res) => {
    const supplier = { ...validateSupplier(req.body, categoryNames((await store.read()).categories)), id: crypto.randomUUID() };
    res.status(201).json(await serialize(() => store.saveSupplier(supplier)));
  });
  app.put('/api/suppliers/:id', async (req, res) => {
    const supplier = { ...validateSupplier(req.body, categoryNames((await store.read()).categories)), id: req.params.id };
    res.json(await serialize(() => store.saveSupplier(supplier, true)));
  });
  app.delete('/api/suppliers/:id', async (req, res) => res.json(await serialize(() => store.deleteSupplier(req.params.id))));
  app.post('/api/operations/:id/category', async (req, res) => {
    res.json(await serialize(() => store.assignCategory(req.params.id, req.body.category)));
  });
  app.put('/api/documents/:id/month', async (req, res) => {
    res.json(await serialize(() => store.setDocumentMonth(req.params.id, req.body.month)));
  });
  app.post('/api/categories', async (req, res) => {
    res.status(201).json(await serialize(() => store.addCategory(req.body.name)));
  });
  app.post('/api/categorize', async (req, res) => res.json(await serialize(() => store.categorizeOperations())));
  app.use(express.static(path.join(__dirname, 'public'), { setHeaders(res, file) {
    if (/\.(?:html|js|css|webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
  } }));
  app.use((error, req, res, next) => {
    const status = error.type === 'entity.too.large' ? 413 : error.status || 500;
    res.status(status).json({ error: status === 413 ? 'Le fichier dépasse la limite de 15 Mo.' : error.message || 'Une erreur est survenue.' });
  });
  return app;
}
function start() {
  const { port, host, multiUser, ownerEmail } = runtimeConfig();
  if (multiUser && !ownerEmail) throw new Error('OWNER_EMAIL est obligatoire en mode multi-utilisateur.');


  const resu = createApp().listen(port, host, () => console.log(`MyCompta : port ${port}, mode ${multiUser ? 'foyer partagé' : 'local'}`));

  //exec('start chrome http://localhost:${port}');

  return resu;
}


module.exports = { createApp, start };
