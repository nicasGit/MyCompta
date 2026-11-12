const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { CATEGORIES, validateOperation, reconcileImport } = require('../services/operations');
const { categoryNames, validateCategory, categoryKey } = require('../services/categories');
const { DEFAULT_SUPPLIERS, normalizeSupplier, validateSupplier, matchingSupplier, categorizeOperation } = require('../services/suppliers');
const { runtimeConfig } = require('../services/config');

const TABLES = {
  Documents: ['id', 'name', 'source', 'driveId', 'hash', 'importedAt', 'status', 'note', 'createdBy', 'contentHash', 'statementMonth'],
  Operations: ['id', 'documentId', 'date', 'label', 'amount', 'currency', 'account', 'category', 'type', 'status', 'page', 'raw', 'holder', 'cardLast4', 'cardType', 'createdBy'],
  Comptes: ['id', 'name', 'source', 'currency'],
  Categories: ['name', 'rule'],
  Budgets: ['month', 'category', 'amount'],
  Fournisseurs: ['id', 'name', 'category'],
};
const sheetIds = Object.fromEntries(Object.keys(TABLES).map((name, i) => [name, i]));
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const cells = row => ({ values: row.map(value => ({ userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: String(value ?? '') } })) });
const rowFor = (table, value) => TABLES[table].map(key => value[key] ?? '');

class GoogleStore {
  constructor({ directory, fetchImpl = fetch, env = process.env } = {}) {
    const config = runtimeConfig(env);
    directory ||= config.directory;
    this.directory = directory;
    this.fetch = fetchImpl;
    this.clientId = env.GOOGLE_CLIENT_ID;
    this.clientSecret = env.GOOGLE_CLIENT_SECRET;
    this.redirect = `${config.origin}/auth/callback`;
  }
  get configured() { return Boolean(this.clientId && this.clientSecret); }
  async load(name) {
    try { return JSON.parse(await fs.readFile(path.join(this.directory, `${name}.json`), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  async save(name, value) {
    await fs.mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, `${name}.json`);
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fs.rename(temp, file);
  }
  async status() {
    const [token, resources] = await Promise.all([this.load('token'), this.load('resources')]);
    return { configured: this.configured, connected: Boolean(token.refresh_token || token.access_token),
      ready: Boolean(resources.spreadsheetId && resources.folderId),
      user: token.user ? { name: token.user.name, email: token.user.email } : null,
      sheetUrl: resources.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${resources.spreadsheetId}/edit` : null,
      driveUrl: resources.folderId ? `https://drive.google.com/drive/folders/${resources.folderId}` : null };
  }
  authorizationUrl(state, drive = true) {
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: this.clientId, redirect_uri: this.redirect, response_type: 'code',
      scope: 'openid email profile' + (drive ? ' https://www.googleapis.com/auth/drive.file' : ''), access_type: 'offline',
      prompt: drive ? 'select_account consent' : 'select_account', state,
    });
  }
  async tokenRequest(fields) {
    const response = await this.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, ...fields }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json();
    if (!response.ok) throw fail('Connexion Google expirée ou refusée. Reconnectez le même compte Google.', 401);
    return data;
  }
  async authenticateCode(code, drive = true) {
    const token = await this.tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: this.redirect });
    if (drive && !token.scope?.split(' ').includes('https://www.googleapis.com/auth/drive.file')) throw fail('Autorisez l’accès aux fichiers MyCompta dans Google.', 401);
    const response = await this.fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw fail('Impossible de vérifier le compte Google. Réessayez la connexion.', 401);
    const profile = await response.json();
    if (!profile.sub || !profile.email || profile.email_verified !== true) throw fail('Le compte Google doit disposer d’une adresse e-mail vérifiée.', 401);
    const user = { id: profile.sub, name: String(profile.name || profile.email), email: String(profile.email) };
    return { ...token, user, expires_at: Date.now() + token.expires_in * 1000 };
  }
  async saveOwnerToken(token) {
    const resources = await this.load('resources');
    if (resources.ownerId && resources.ownerId !== token.user.id) throw fail('Cet espace appartient à un autre compte Google. Reconnectez le compte utilisé lors de sa création.', 409);
    const previous = await this.load('token');
    if (!token.refresh_token && previous.user?.id === token.user.id) token.refresh_token = previous.refresh_token;
    await this.save('token', token);
  }
  async exchangeCode(code) {
    return this.saveOwnerToken(await this.authenticateCode(code));
  }
  async accessToken() {
    const token = await this.load('token');
    if (token.access_token && token.expires_at > Date.now() + 60000) return token.access_token;
    if (!token.refresh_token) throw fail('Connectez votre compte Google.', 401);
    if (!this.refreshing) this.refreshing = (async () => {
      const refreshed = await this.tokenRequest({ refresh_token: token.refresh_token, grant_type: 'refresh_token' });
      await this.save('token', { ...token, ...refreshed, expires_at: Date.now() + refreshed.expires_in * 1000 });
      return refreshed.access_token;
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async request(url, { method = 'GET', body, headers = {}, rawResponse = false } = {}) {
    const token = await this.accessToken();
    const response = await this.fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...headers }, body, signal: AbortSignal.timeout(60000) });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      const reason = detail.error?.errors?.[0]?.reason;
      if (response.status === 401) throw fail('Session Google expirée. Reconnectez votre compte.', 401);
      if (response.status === 403 || response.status === 404) throw fail('Accès Google impossible. Vérifiez les API Drive/Sheets, les autorisations et le compte connecté.' + (reason === 'accessNotConfigured' ? ' Activez les API dans Google Cloud.' : ''), 403);
      if (response.status === 429) throw fail('Limite Google atteinte. Réessayez dans une minute.', 429);
      throw fail('Google n’a pas confirmé l’enregistrement. Actualisez les données avant de réessayer.', 502);
    }
    return rawResponse ? response : response.status === 204 ? {} : response.json();
  }
  json(url, method, body) { return this.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  async disconnect() {
    const token = await this.load('token');
    if (token.refresh_token || token.access_token) {
      const response = await this.fetch('https://oauth2.googleapis.com/revoke', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: token.refresh_token || token.access_token }), signal: AbortSignal.timeout(30000) });
      if (!response.ok && response.status !== 400) throw fail('Google n’a pas confirmé la déconnexion. Réessayez.', 502);
    }
    await fs.rm(path.join(this.directory, 'token.json'), { force: true });
  }
  async findFile(kind) {
    const q = `trashed = false and appProperties has { key='mycompta' and value='${kind}' }`;
    const result = await this.request('https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '100' }));
    return result.files[0];
  }
  async initialize() {
    if (!this.configured) throw fail('Configurez les identifiants Google dans .env.');
    const resources = await this.load('resources');
    const token = await this.load('token');
    if (resources.ownerId && resources.ownerId !== token.user?.id) throw fail('Reconnectez le compte propriétaire de cet espace.', 409);
    if (!resources.folderId) {
      const folder = await this.findFile('folder') || await this.json('https://www.googleapis.com/drive/v3/files', 'POST', {
        name: 'MyCompta · Documents', mimeType: 'application/vnd.google-apps.folder', appProperties: { mycompta: 'folder' },
      });
      resources.folderId = folder.id;
      await this.save('resources', resources);
    }
    if (!resources.spreadsheetId) {
      const sheet = await this.findFile('sheet') || await this.json('https://www.googleapis.com/drive/v3/files', 'POST', {
        name: 'MyCompta · Foyer', mimeType: 'application/vnd.google-apps.spreadsheet', parents: [resources.folderId], appProperties: { mycompta: 'sheet' },
      });
      resources.spreadsheetId = sheet.id;
      await this.save('resources', resources);
    }
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${resources.spreadsheetId}`;
    const metadata = await this.request(base + '?fields=sheets.properties');
    const requests = [];
    const existing = metadata.sheets || [];
    for (const [title, columns] of Object.entries(TABLES)) {
      if (existing.some(s => s.properties.title === title)) continue;
      const usedIds = existing.map(s => s.properties.sheetId);
      // Avoid colliding with the automatically created first sheet (usually id 0).
      const sheetId = 100 + sheetIds[title];
      if (usedIds.includes(sheetId)) throw fail('Le tableur contient un onglet incompatible avec MyCompta.');
      requests.push({ addSheet: { properties: { sheetId, title, gridProperties: { frozenRowCount: 1 } } } });
      const rows = [columns];
      if (title === 'Categories') rows.push(...CATEGORIES.map(c => [c, '']));
      if (title === 'Fournisseurs') rows.push(...DEFAULT_SUPPLIERS.map(s => rowFor(title, s)));
      requests.push({ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: rows.map(cells), fields: 'userEnteredValue' } });
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: .1, green: .3, blue: .27 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } } }, fields: 'userEnteredFormat' } });
    }
    if (requests.length) await this.json(base + ':batchUpdate', 'POST', { requests });
    await this.read();
    if (token.user?.id) { resources.ownerId = token.user.id; await this.save('resources', resources); }
    return this.status();
  }
  async context() {
    const resources = await this.load('resources');
    if (!resources.spreadsheetId || !resources.folderId) throw fail('Créez d’abord votre espace Google MyCompta.', 409);
    if (resources.ownerId) {
      const token = await this.load('token');
      if (resources.ownerId !== token.user?.id) throw fail('Reconnectez le compte propriétaire de cet espace.', 409);
    }
    return { ...resources, base: `https://sheets.googleapis.com/v4/spreadsheets/${resources.spreadsheetId}` };
  }
  async read() {
    const { base } = await this.context();
    await this.ensureSuppliers();
    const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' });
    for (const name of Object.keys(TABLES)) params.append('ranges', `${name}!A:P`);
    const result = await this.request(base + '/values:batchGet?' + params);
    // Add missing trailing metadata columns without overwriting customized cells.
    for (const [name, index, lengths] of [['Documents', 0, [10, 9, 8]], ['Operations', 1, [15, 12]]]) {
      const rows = result.valueRanges[index]?.values || [];
      const header = rows[0];
      if (!header) continue;
      const length = lengths.find(n => TABLES[name].slice(0, n).every((c, i) => header[i] === c) && TABLES[name].slice(n).every((c, i) => !header[n + i]));
      if (!length) continue;
      if (rows.slice(1).some(row => row.slice(length, TABLES[name].length).some(v => v !== '' && v != null))) throw fail(`Des colonnes supplémentaires sont déjà utilisées dans ${name}. Déplacez leur contenu avant la migration.`, 409);
      const start = String.fromCharCode(65 + length), end = String.fromCharCode(64 + TABLES[name].length);
      await this.json(base + `/values/${name}!${start}1:${end}1?valueInputOption=RAW`, 'PUT', { values: [TABLES[name].slice(length)] });
      header.splice(length, TABLES[name].length - length, ...TABLES[name].slice(length));
    }
    const data = {};
    Object.entries(TABLES).forEach(([name, columns], index) => {
      const values = result.valueRanges[index].values || [];
      if (columns.some((column, i) => values[0]?.[i] !== column)) throw fail(`Structure de l’onglet ${name} modifiée. Rétablissez les en-têtes d’origine.`, 409);
      data[name] = values.slice(1).map((row, i) => ({ ...Object.fromEntries(columns.map((key, j) => [key, row[j] ?? ''])), _row: i + 2 })).filter(row => row[columns[0]] !== '');
    });
    const allowedCategories = categoryNames(data.Categories);
    const operations = data.Operations.map(o => {
      try { return { ...o, ...validateOperation({ ...o, amount: Number(o.amount), page: Number(o.page) }, allowedCategories) }; }
      catch (error) { throw fail(`Opération invalide dans Sheets, ligne ${o._row} : ${error.message}`, 409); }
    });
    const budgets = data.Budgets.map(b => {
      const amount = Number(b.amount);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month) || !allowedCategories.includes(b.category) || !Number.isFinite(amount) || amount < 0) throw fail(`Budget invalide dans Sheets, ligne ${b._row}.`, 409);
      return { ...b, amount };
    });
    const suppliers = data.Fournisseurs.map(s => {
      try { return { ...s, ...validateSupplier(s, allowedCategories) }; }
      catch (error) { throw fail(`Fournisseur invalide dans Sheets, ligne ${s._row} : ${error.message}`, 409); }
    });
    if (new Set(suppliers.map(s => s.id)).size !== suppliers.length || new Set(suppliers.map(s => normalizeSupplier(s.name))).size !== suppliers.length) throw fail('Des fournisseurs sont en double dans Sheets. Corrigez les doublons dans l’onglet Fournisseurs.', 409);
    return { documents: data.Documents, operations, accounts: data.Comptes, categories: data.Categories, budgets, suppliers };
  }
  async addCategory(input) {
    const name = validateCategory(input);
    const data = await this.read();
    if (categoryNames(data.categories).some(existing => categoryKey(existing) === categoryKey(name))) throw fail('Cette catégorie existe déjà.', 409);
    await this.writeRow('Categories', { name, rule: '' });
    return { name };
  }
  async ensureSuppliers() {
    if (this.suppliersReady) return;
    if (!this.suppliersSetup) this.suppliersSetup = (async () => {
      const { base } = await this.context();
      const metadata = await this.request(base + '?fields=sheets.properties');
      if (!metadata.sheets.some(s => s.properties.title === 'Fournisseurs')) {
        const sheetId = Math.max(104, ...metadata.sheets.map(s => s.properties.sheetId)) + 1;
        await this.json(base + ':batchUpdate', 'POST', { requests: [
          { addSheet: { properties: { sheetId, title: 'Fournisseurs', gridProperties: { frozenRowCount: 1 } } } },
          { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: [TABLES.Fournisseurs, ...DEFAULT_SUPPLIERS.map(s => rowFor('Fournisseurs', s))].map(cells), fields: 'userEnteredValue' } },
        ] });
      }
      this.suppliersReady = true;
    })().finally(() => { this.suppliersSetup = null; });
    return this.suppliersSetup;
  }
  async assignCategory(id, category, filter) {
    const data = await this.read();
    const operation = data.operations.find(item => item.id === id);
    if (!operation) throw fail('Opération introuvable.', 404);
    if (operation.status === 'ignored' || !['expense', 'income'].includes(operation.type)) throw fail('Cette opération ne peut pas être classée automatiquement.', 400);
    const name = filter === undefined ? operation.label.trim().replace(/\s+/g, ' ').slice(0, 120) : filter;
    const rule = validateSupplier({ name, category }, categoryNames(data.categories));
    if (!matchingSupplier(operation.label, [rule])) throw fail('Ce filtre ne correspond pas au libellé sélectionné.', 400);
    const existing = data.suppliers.find(item => normalizeSupplier(item.name) === normalizeSupplier(rule.name));
    const supplier = { ...rule, id: existing?.id || crypto.randomUUID() };
    const row = existing?._row || Math.max(1, ...data.suppliers.map(item => item._row)) + 1;
    const { base } = await this.context();
    // One Sheets request applies the category and remembers the rule together.
    await this.json(base + '/values:batchUpdate', 'POST', { valueInputOption: 'RAW', data: [
      { range: `Operations!H${operation._row}`, values: [[category]] },
      { range: `Fournisseurs!A${row}:C${row}`, values: [rowFor('Fournisseurs', supplier)] }
    ] });
    return { category, supplier: supplier.name };
  }
  async previewCategorization() {
    const data = await this.read();
    return data.operations.flatMap(operation => {
      const next = categorizeOperation(operation, data.suppliers);
      if (next.category === operation.category) return [];
      return [{ id: operation.id, date: operation.date, label: operation.label, amount: operation.amount,
        currency: operation.currency, category: next.category, supplier: matchingSupplier(operation.label, data.suppliers).name }];
    });
  }
  async confirmCategorization(items) {
    if (!Array.isArray(items) || !items.length || items.length > 2000 || items.some(item => typeof item?.id !== 'string' || typeof item.category !== 'string')
      || new Set(items.map(item => item.id)).size !== items.length) throw fail('Sélection invalide (1 à 2000 opérations).', 400);
    const data = await this.read();
    const changes = items.map(item => {
      const old = data.operations.find(operation => operation.id === item.id);
      const next = old && categorizeOperation(old, data.suppliers);
      if (!old || next.category === old.category || next.category !== item.category) throw fail('Les correspondances ont changé. Relancez la recherche avant de valider.', 409);
      return { range: `Operations!H${old._row}`, values: [[next.category]] };
    });
    const { base } = await this.context();
    await this.json(base + '/values:batchUpdate', 'POST', { valueInputOption: 'RAW', data: changes });
    return { updated: changes.length };
  }
  async saveSupplier(supplier, update = false) {
    const data = await this.read();
    const value = { ...validateSupplier(supplier, categoryNames(data.categories)), id: supplier.id };
    const old = data.suppliers.find(s => s.id === value.id);
    if (update && !old) throw fail('Fournisseur introuvable.', 404);
    if (data.suppliers.some(s => s.id !== value.id && normalizeSupplier(s.name) === normalizeSupplier(value.name))) throw fail('Ce fournisseur possède déjà une règle. Modifiez la règle existante.', 409);
    return this.writeRow('Fournisseurs', value, old?._row);
  }
  async deleteSupplier(id) {
    const data = await this.read();
    const supplier = data.suppliers.find(s => s.id === id);
    if (!supplier) throw fail('Fournisseur introuvable.', 404);
    const { base } = await this.context();
    await this.json(base + `/values/Fournisseurs!A${supplier._row}:C${supplier._row}:clear`, 'POST', {});
    return { ok: true };
  }
  async categorizeOperations() {
    const data = await this.read();
    const changes = data.operations.map(o => ({ old: o, next: categorizeOperation(o, data.suppliers) })).filter(({ old, next }) => old.category !== next.category);
    if (changes.length) {
      const { base } = await this.context();
      await this.json(base + '/values:batchUpdate', 'POST', { valueInputOption: 'RAW', data: changes.map(({ old, next }) => ({ range: `Operations!H${old._row}`, values: [[next.category]] })) });
    }
    return { updated: changes.length };
  }
  async appendImport(document, operations) {
    const { base } = await this.context();
    const metadata = await this.request(base + '?fields=sheets.properties');
    const id = name => metadata.sheets.find(s => s.properties.title === name).properties.sheetId;
    const requests = [{ appendCells: { sheetId: id('Documents'), rows: [cells(rowFor('Documents', document))], fields: 'userEnteredValue' } }];
    if (operations.length) requests.push({ appendCells: { sheetId: id('Operations'), rows: operations.map(o => cells(rowFor('Operations', o))), fields: 'userEnteredValue' } });
    // One atomic Sheets request for the document and its operation candidates.
    await this.json(base + ':batchUpdate', 'POST', { requests });
  }
  async writeRow(table, value, row) {
    const { base } = await this.context();
    const range = `${table}!A${row || 1}`;
    const suffix = row ? `/${encodeURIComponent(range)}?valueInputOption=RAW` : `/${table}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    await this.json(base + '/values' + suffix, row ? 'PUT' : 'POST', { values: [rowFor(table, value)] });
    return value;
  }
  async downloadPdf(id) {
    const response = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { rawResponse: true });
    const max = 15 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > max) throw fail('Le PDF dépasse 15 Mo.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > max || !buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw fail('Le fichier Drive n’est pas un PDF valide de 15 Mo maximum.');
    return buffer;
  }
  async renamePdf(id, name) {
    return this.json(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name`, 'PATCH', { name });
  }
  async setDocumentMonth(id, month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw fail('Mois du relevé invalide.', 400);
    const data = await this.read();
    const document = data.documents.find(item => item.id === id);
    if (!document) throw fail('Document introuvable.', 404);
    const { base } = await this.context();
    await this.json(base + `/values/Documents!K${document._row}?valueInputOption=RAW`, 'PUT', { values: [[month]] });
    return { month };
  }
  async renameDocument(id, name) {
    const data = await this.read();
    const document = data.documents.find(d => d.id === id);
    if (!document) throw fail('Document introuvable.', 404);
    await this.renamePdf(document.driveId, name);
    return this.writeRow('Documents', { ...document, name }, document._row);
  }
  async replaceImport(document, operations) {
    const data = await this.read();
    const existing = data.documents.find(d => d.id === document.id);
    if (!existing) throw fail('Document introuvable.', 404);
    const old = data.operations.filter(o => o.documentId === document.id);
    operations = reconcileImport(operations, old).map(o => categorizeOperation(o, data.suppliers));
    const { base } = await this.context();
    const metadata = await this.request(base + '?fields=sheets.properties');
    const id = name => metadata.sheets.find(s => s.properties.title === name).properties.sheetId;
    const requests = old.sort((a, b) => b._row - a._row).map(o => ({ deleteDimension: { range: { sheetId: id('Operations'), dimension: 'ROWS', startIndex: o._row - 1, endIndex: o._row } } }));
    requests.push({ updateCells: { start: { sheetId: id('Documents'), rowIndex: existing._row - 1, columnIndex: 0 }, rows: [cells(rowFor('Documents', document))], fields: 'userEnteredValue' } });
    if (operations.length) requests.push({ appendCells: { sheetId: id('Operations'), rows: operations.map(o => cells(rowFor('Operations', o))), fields: 'userEnteredValue' } });
    await this.json(base + ':batchUpdate', 'POST', { requests });
  }
  async saveOperation(operation, update = false) {
    const data = await this.read();
    const old = data.operations.find(o => o.id === operation.id);
    if (update && !old) throw fail('Opération introuvable.', 404);
    if (operation.documentId && !data.documents.some(d => d.id === operation.documentId)) throw fail('Document introuvable.');
    if (old) operation.createdBy = old.createdBy || '';
    await this.writeRow('Operations', operation, old?._row);
    return operation;
  }
  async saveBudget(budget) {
    const data = await this.read();
    const old = data.budgets.find(b => b.month === budget.month && b.category === budget.category);
    return this.writeRow('Budgets', budget, old?._row);
  }
  async uploadPdf(buffer, name, hash) {
    const { folderId } = await this.context();
    const q = `trashed = false and '${folderId}' in parents and appProperties has { key='sha256' and value='${hash}' }`;
    const existing = await this.request('https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' }));
    if (existing.files.length) return existing.files[0];
    const metadata = JSON.stringify({ name, mimeType: 'application/pdf', parents: [folderId], appProperties: { sha256: hash } });
    const session = await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'application/pdf', 'X-Upload-Content-Length': String(buffer.length) }, body: metadata, rawResponse: true,
    });
    const location = session.headers.get('location');
    if (!location || new URL(location).origin !== 'https://www.googleapis.com') throw fail('Session d’import Google invalide.', 502);
    return this.request(location, {
      method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: buffer,
    });
  }
}
module.exports = { GoogleStore, TABLES };
