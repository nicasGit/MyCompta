const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (amount, currency = 'CHF') => new Intl.NumberFormat('fr-CH', { style: 'currency', currency }).format(amount);
const today = () => new Date().toLocaleDateString('sv-SE');
const state = { status: {}, data: { documents: [], operations: [], budgets: [], categories: [] }, view: 'dashboard', demo: false, editing: null, busy: false };
const titles = { dashboard: ['Vue d’ensemble', 'Vos dépenses, avec un peu de recul.'], documents: ['Documents', 'Tous vos relevés, au même endroit.'], operations: ['Opérations', 'Le détail de votre quotidien.'], review: ['À vérifier', 'Quelques vérifications pour des comptes plus fiables.'], budgets: ['Budgets', 'Donnez un cap aux dépenses de votre foyer.'], settings: ['Mon espace Google', 'Vos données et vos documents, chez vous.'] };
const categories = ['À catégoriser', 'Logement', 'Alimentation', 'Transports', 'Santé', 'Assurances', 'Loisirs', 'Abonnements', 'Impôts', 'Autres'];
const labels = { pending: 'À vérifier', validated: 'Validée', ignored: 'Ignorée' };
const typeLabels = { expense: 'Dépense', income: 'Revenu / remboursement', transfer: 'Virement', card_payment: 'Règlement de carte' };
$('#month').value = today().slice(0, 7);
$('#redirect-uri').textContent = `${location.origin}/auth/callback`;
const options = values => values.map(v => `<option>${esc(v)}</option>`).join('');
$('#operation-category').innerHTML = options(categories);
$('#budget-category').innerHTML = options(categories.filter(c => c !== 'À catégoriser'));

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'X-MyCompta': '1', ...options.headers } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'La requête a échoué.');
  return result;
}
function message(text, error = false) {
  $('#notice').textContent = text;
  $('#notice').classList.toggle('error', error);
  $('#notice').hidden = false;
  if (error && $('#operation-dialog').open) { $('#dialog-error').textContent = text; $('#dialog-error').hidden = false; }
}
async function action(fn, success) {
  if (state.busy) return;
  state.busy = true;
  document.body.setAttribute('aria-busy', 'true');
  document.querySelectorAll('button[type="submit"],#setup,#disconnect,#refresh').forEach(b => { b.disabled = true; });
  try { await fn(); if (success) message(success); }
  catch (error) { message(error.message, true); }
  finally {
    state.busy = false;
    document.body.removeAttribute('aria-busy');
    document.querySelectorAll('button[type="submit"],#setup,#disconnect,#refresh').forEach(b => { b.disabled = false; });
  }
}
function showView(view) {
  state.view = view;
  Object.keys(titles).forEach(key => { $(`#view-${key}`).hidden = key !== view; });
  document.querySelectorAll('.nav').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('#title').textContent = $('#breadcrumb').textContent = titles[view][0];
  $('#subtitle').textContent = titles[view][1];
  $('#month-label').hidden = !['dashboard', 'operations', 'budgets'].includes(view);
  $('#import-shortcut').hidden = view === 'settings' || view === 'documents';
  $('#onboarding').hidden = state.status.connected || state.demo || view === 'settings';
}
document.addEventListener('click', event => {
  const nav = event.target.closest('[data-view]');
  if (nav) showView(nav.dataset.view);
  const edit = event.target.closest('[data-edit]');
  if (edit) editOperation(state.data.operations.find(o => o.id === edit.dataset.edit));
  const reanalyse = event.target.closest('[data-reanalyse]');
  if (reanalyse && requireStorage() && window.confirm('Relire le détail Cembra ? Les opérations encore à vérifier de ce document seront remplacées, y compris leurs corrections et catégories. Les opérations validées ou ignorées bloquent la relecture.')) action(async () => {
    message('Relecture du détail Cembra depuis le PDF archivé…');
    const result = await api('/api/documents/' + encodeURIComponent(reanalyse.dataset.reanalyse) + '/reanalyse', { method: 'POST' });
    await load();
    message(`${result.count} opération(s) Cembra à vérifier. ${result.note}`);
  });
});
$('#import-shortcut').onclick = () => { showView('documents'); $('#upload-form select').focus(); };
$('#month').onchange = () => { if (state.demo) render(); else action(load); };
$('#search').oninput = renderOperations;
$('#refresh').onclick = () => action(load, 'Données actualisées.');
$('#close-dialog').onclick = () => $('#operation-dialog').close();
$('#add-operation').onclick = () => editOperation();

function empty(title, detail = '') { return `<div class="empty"><span>◌</span><strong>${esc(title)}</strong>${esc(detail)}</div>`; }
function pdfUrl(document, page = 0) {
  if (!document || !/^[\w-]+$/.test(document.driveId || '')) return null;
  return `https://drive.google.com/file/d/${encodeURIComponent(document.driveId)}/view${page ? '#page=' + Number(page) : ''}`;
}
function docRows(documents, compact = false) {
  if (!documents.length) return empty('Votre bibliothèque commence ici', 'Importez votre premier relevé PDF.');
  return [...documents].reverse().map(d => {
    const url = state.demo ? null : pdfUrl(d);
    const reanalyse = !compact && !state.demo && d.source === 'Cembra'
      ? `<p><button class="text-button" data-reanalyse="${esc(d.id)}">Relire le détail Cembra</button></p>` : '';
    const operations = state.data.operations.filter(o => o.documentId === d.id);
    const pending = operations.filter(o => o.status === 'pending').length;
    const status = operations.length ? (pending ? `${pending} à vérifier` : 'Traité') : 'Saisie nécessaire';
    return `<div class="document-row"><span class="pdf-icon">PDF</span><div class="document-info"><strong>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(d.name)} ↗</a>` : esc(d.name)}</strong><small>${esc(d.source)} · ${esc(new Date(d.importedAt).toLocaleDateString('fr-CH'))} · ${operations.length} opération(s)</small>${!compact && d.note ? `<p>${esc(d.note)}</p>` : ''}${reanalyse}</div><span class="badge ${pending ? '' : operations.length ? 'validated' : ''}">${esc(status)}</span></div>`;
  }).join('');
}
function operationTable(operations) {
  if (!operations.length) return empty('Aucune opération à afficher', 'Les lignes importées apparaîtront ici.');
  return `<table><thead><tr><th>Date</th><th>Libellé / compte</th><th>Titulaire</th><th>Catégorie</th><th>État</th><th class="amount">Montant</th><th></th></tr></thead><tbody>${operations.map(o => `<tr><td>${esc(o.date.split('-').reverse().join('.'))}</td><td class="label-cell" title="${esc(o.label)}">${esc(o.label)}<span class="subtext">${esc(o.account)} · ${esc(typeLabels[o.type] || o.type)}</span></td><td>${esc(o.holder || "Non renseigné")}<span class="subtext">${esc(o.cardLast4 ? "Carte " + o.cardLast4 : "")}</span></td><td>${esc(o.category)}</td><td><span class="badge ${esc(o.status)}">${esc(labels[o.status] || o.status)}</span></td><td class="amount">${esc(money(o.amount, o.currency))}</td><td><button class="text-button" data-edit="${esc(o.id)}">${o.status === 'pending' ? 'Vérifier' : 'Modifier'} →</button></td></tr>`).join('')}</tbody></table>`;
}
function renderOperations() {
  const month = $('#month').value;
  const search = $('#search').value.toLocaleLowerCase('fr');
  const filtered = state.data.operations.filter(o => o.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
  $('#operations-list').innerHTML = operationTable(filtered.filter(o => `${o.label} ${o.account} ${o.holder || ""} ${o.cardLast4 || ""}`.toLocaleLowerCase('fr').includes(search)));
  $('#recent-operations').innerHTML = operationTable(filtered.slice(0, 5));
  $('#review-list').innerHTML = operationTable(state.data.operations.filter(o => o.status === 'pending'));
}
function summary() {
  const expense = state.data.operations.filter(o => o.date.startsWith($('#month').value) && o.status === 'validated' && o.type === 'expense');
  const totals = {}, groups = {};
  expense.forEach(o => {
    totals[o.currency] = (totals[o.currency] || 0) + Math.round(o.amount * 100);
    const key = `${o.category}|${o.currency}`;
    groups[key] = (groups[key] || 0) + Math.round(o.amount * 100);
  });
  return { expense, totals, groups };
}
function render() {
  const { expense, totals, groups } = summary();
  const pending = state.data.operations.filter(o => o.status === 'pending').length;
  $('#total').textContent = Object.entries(totals).map(([currency, amount]) => money(amount / 100, currency)).join('\n') || money(0);
  $('#count').textContent = expense.length;
  $('#pending').textContent = $('#nav-count').textContent = pending;
  $('#demo-banner').hidden = !state.demo;
  $('#category-chart').innerHTML = Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([key, cents]) => {
    const [category, currency] = key.split('|');
    return `<div class="category-row"><div><span>${esc(category)}</span><strong>${esc(money(cents / 100, currency))}</strong></div><progress value="${cents}" max="${totals[currency]}" aria-label="${esc(category)}"></progress></div>`;
  }).join('') || empty('Un premier relevé, une première vue', 'Validez des opérations pour voir leur répartition.');
  $('#recent-documents').innerHTML = docRows(state.data.documents.slice(-3), true);
  $('#documents-list').innerHTML = docRows(state.data.documents);
  $('#document-count').textContent = `${state.data.documents.length} document(s)`;
  renderOperations();
  const budgets = state.data.budgets.filter(b => b.month === $('#month').value);
  $('#budget-list').innerHTML = budgets.map(b => {
    const spent = expense.filter(o => o.category === b.category && o.currency === 'CHF').reduce((sum, o) => sum + Math.round(o.amount * 100), 0) / 100;
    return `<div class="budget-row"><div><strong>${esc(b.category)}</strong><span>${esc(money(spent))} / ${esc(money(b.amount))}</span></div><progress value="${Math.min(spent, b.amount)}" max="${Math.max(b.amount, 1)}" aria-label="Budget ${esc(b.category)}"></progress><small>${spent > b.amount ? 'Dépassement de ' + esc(money(spent - b.amount)) : 'Reste disponible : ' + esc(money(b.amount - spent))}</small></div>`;
  }).join('') || empty('À chaque catégorie, son budget', 'Ajoutez une enveloppe mensuelle pour commencer.');
  const s = state.status;
  $('#google-account').textContent = s.connected ? (s.user?.name || 'Google connecté') : 'Connecter Google';
  $('#google-account').title = s.user?.email || 'Gérer la connexion Google';
  $('#google-account').classList.toggle('connected', Boolean(s.connected));
  $('#connection-state').innerHTML = `<div class="banner">${!s.configured ? 'Configuration Google à compléter. Suivez les étapes ci-dessous.' : !s.connected ? 'Configuration prête. Connectez votre compte Google.' : !s.ready ? 'Google est connecté. Créez votre espace pour commencer.' : 'Espace configuré. Votre tableur et votre dossier sont prêts.'}</div>`;
  if (s.connected && s.user) $('#connection-state').insertAdjacentHTML('afterbegin', `<div class="account-card"><span class="account-avatar">${esc((s.user.name || s.user.email).slice(0, 1).toUpperCase())}</span><div><strong>${esc(s.user.name)}</strong><span>${esc(s.user.email)}</span></div><span class="chip">Compte connecté</span></div>`);
  $('#connect').hidden = s.connected;
  $('#connect').classList.toggle('disabled', !s.configured);
  $('#connect').setAttribute('aria-disabled', String(!s.configured));
  $('#setup').hidden = !s.connected;
  $('#disconnect').hidden = !s.connected;
  $('#google-links').innerHTML = [s.sheetUrl ? `<a class="secondary" href="${esc(s.sheetUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir Google Sheets ↗</a>` : '', s.driveUrl ? `<a class="secondary" href="${esc(s.driveUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir Google Drive ↗</a>` : ''].join('');
  showView(state.view);
}
async function load() {
  if (state.demo) { render(); return; }
  state.status = await api('/api/status');
  if (state.status.connected && state.status.ready) state.data = await api('/api/data?month=' + $('#month').value);
  else state.data = { documents: [], operations: [], budgets: [], categories: [] };
  render();
}
function requireStorage() {
  if (state.demo) { message('L’exemple est en lecture seule. Quittez-le et connectez Google pour enregistrer vos données.'); return false; }
  if (!state.status.connected || !state.status.ready) { showView('settings'); message('Connectez Google et créez votre espace pour enregistrer des données.'); return false; }
  return true;
}
$('#setup').onclick = () => action(async () => { state.status = await api('/api/setup', { method: 'POST' }); await load(); }, 'Votre espace Google est prêt. Vous pouvez importer un PDF.');
$('#disconnect').onclick = () => action(async () => { await api('/api/disconnect', { method: 'POST' }); state.demo = false; await load(); }, 'Google déconnecté. Vos documents et votre tableur sont conservés.');
$('#upload-form').onsubmit = event => {
  event.preventDefault();
  if (!requireStorage()) return;
  const file = event.target.pdf.files[0];
  if (!file || file.size > 15 * 1024 * 1024) return message('Sélectionnez un PDF de 15 Mo maximum.', true);
  action(async () => {
    message('Import en cours : lecture du PDF et enregistrement dans Google…');
    const params = new URLSearchParams({ name: file.name, source: event.target.source.value });
    const result = await api('/api/documents?' + params, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
    event.target.reset();
    await load();
    message(result.duplicate ? 'Ce PDF a déjà été importé. Aucun doublon créé.' : `PDF archivé dans Drive. ${result.count} opération(s) à vérifier. ${result.note}`);
  });
};
function editOperation(operation) {
  if (!requireStorage()) return;
  state.editing = operation || null;
  const form = $('#operation-form');
  form.reset();
  $('#dialog-error').hidden = true;
  $('#operation-document').innerHTML = '<option value="">Sans document</option>' + state.data.documents.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
  const values = operation || { date: today(), currency: 'CHF', category: 'À catégoriser', type: 'expense', status: 'pending', account: '' };
  Object.entries(values).forEach(([key, value]) => { if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value; });
  $('#dialog-title').textContent = operation ? 'Vérifier une opération' : 'Ajouter une opération';
  $('#operation-context').textContent = operation?.raw ? `Ligne d’origine · page ${operation.page} : ${operation.raw}` : 'Le montant est toujours positif. Choisissez le type pour préciser son sens.';
  updateOperationHints();
  $('#operation-dialog').showModal();
}
function updateOperationHints() {
  const form = $('#operation-form');
  const document = state.data.documents.find(d => d.id === form.documentId.value);
  $('#open-pdf').hidden = !pdfUrl(document);
  const duplicate = state.data.operations.some(o => o.id !== state.editing?.id && o.status !== 'ignored' && o.date === form.date.value && o.amount === Number(form.amount.value) && o.currency === form.currency.value && o.label.toLowerCase() === form.label.value.trim().toLowerCase());
  $('#duplicate-warning').hidden = !duplicate;
}
$('#operation-form').oninput = updateOperationHints;
$('#open-pdf').onclick = () => {
  const doc = state.data.documents.find(d => d.id === $('#operation-form').documentId.value);
  const url = pdfUrl(doc, state.editing?.page);
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
};
$('#operation-form').onsubmit = event => {
  event.preventDefault();
  const form = event.target;
  const operation = Object.fromEntries(new FormData(form));
  operation.amount = Number(operation.amount);
  operation.cardType = state.editing?.cardType || "";
  operation.page = operation.documentId === state.editing?.documentId ? state.editing.page : 0;
  operation.raw = operation.documentId === state.editing?.documentId ? state.editing.raw : '';
  action(async () => {
    await api('/api/operations' + (state.editing ? '/' + encodeURIComponent(state.editing.id) : ''), { method: state.editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation) });
    $('#operation-dialog').close();
    await load();
  }, 'Opération enregistrée dans Sheets.');
};
$('#budget-form').onsubmit = event => {
  event.preventDefault();
  if (!requireStorage()) return;
  const body = { month: $('#month').value, category: event.target.category.value, amount: Number(event.target.amount.value) };
  action(async () => { await api('/api/budgets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); await load(); }, 'Budget enregistré dans Sheets.');
};
$('#demo').onclick = () => {
  state.demo = true;
  const month = $('#month').value;
  state.data = {
    documents: [{ id: 'demo-doc', name: 'Relevé du foyer · exemple.pdf', source: 'Exemple', importedAt: new Date().toISOString() }],
    operations: [['Loyer', 1650, 'Logement'], ['Migros', 142.80, 'Alimentation'], ['CFF', 85, 'Transports'], ['Assurance ménage', 46, 'Assurances'], ['Restaurant', 67.50, 'Loisirs'], ['À vérifier : pharmacie', 32, 'Santé']].map(([label, amount, category], i) => ({ id: 'demo-' + i, documentId: 'demo-doc', date: `${month}-${String(i + 1).padStart(2, '0')}`, label, amount, currency: 'CHF', category, type: 'expense', status: i === 5 ? 'pending' : 'validated', account: 'Compte du foyer' })),
    budgets: [{ month, category: 'Alimentation', amount: 650 }, { month, category: 'Loisirs', amount: 250 }], categories,
  };
  $('#notice').hidden = true;
  render();
};
$('#exit-demo').onclick = () => { state.demo = false; action(load); };
const errorCode = new URLSearchParams(location.search).get('error');
if (errorCode) { message(errorCode === 'configuration' ? 'Renseignez la configuration Google avant de vous connecter.' : errorCode === 'compte' ? 'Cet espace appartient à un autre compte Google. Reconnectez le compte utilisé pour créer votre espace MyCompta.' : 'La connexion Google n’a pas abouti. Vérifiez les autorisations, le client OAuth et l’URI de redirection, puis réessayez.', true); history.replaceState(null, '', '/'); showView('settings'); }
action(load);
