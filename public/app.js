const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (amount, currency = 'CHF') => new Intl.NumberFormat('fr-CH', { style: 'currency', currency }).format(amount);
function importDate(value) { const date=new Date(value); return value&&Number.isFinite(date.getTime())?new Intl.DateTimeFormat('fr-CH',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Zurich'}).format(date):'date non renseignée'; }
const today = () => new Date().toLocaleDateString('sv-SE');
const state = { status: {}, data: { documents: [], operations: [], budgets: [], categories: [] }, view: 'dashboard', demo: false, editing: null, busy: false };
const titles = { dashboard: ['Vue d’ensemble', 'Vos dépenses, avec un peu de recul.'], documents: ['Documents', 'Tous vos relevés, au même endroit.'], operations: ['Opérations', 'Le détail de votre quotidien.'], review: ['À catégoriser', 'Classez vos opérations à votre rythme, sans bloquer les totaux.'], budgets: ['Budgets', 'Donnez un cap aux dépenses de votre foyer.'], settings: ['Mon espace Google', 'Vos données et vos documents, chez vous.'] };
let categories = ['À catégoriser', 'Logement', 'Alimentation', 'Transports', 'Santé', 'Assurances', 'Loisirs', 'Abonnements', 'Impôts', 'Autres'];
const labels = { pending: 'Incluse', validated: 'Incluse', ignored: 'Ignorée' };
const typeLabels = { expense: 'Dépense', income: 'Revenu / remboursement', transfer: 'Virement', card_payment: 'Règlement de carte' };
titles.suppliers = ['Fournisseurs et catégories', 'Le bon classement, automatiquement.'];
titles.household = ['Mon foyer', 'Un espace commun, une connexion pour chacun.'];
titles.preferences = ['Paramètres', 'Une interface à votre goût.'];
titles.importerrors=['Imports en erreur','Retrouver et corriger les PDF en attente.'];
titles.savings=['Épargne','Suivre les mouvements de vos comptes épargne.'];
const accountName=id=>state.data.accounts?.find(account=>account.id===id)?.name||id;
titles.reconciliation = ['Rapprochements', 'Contrôler les relevés, les paiements de carte et les virements.'];
state.editingSupplier = null;
$('#month').value = MyComptaPeriod.previousMonth();
$('#coverage-end').value = MyComptaPeriod.previousMonth();
$('#coverage-start').value = $('#coverage-end').value.slice(0, 4) + '-01';
for (const id of ['coverage-source', 'coverage-start', 'coverage-end']) $('#' + id).onchange = renderCoverage;
$('#coverage-account').onchange=renderCoverage;
document.addEventListener('change', event => {
  const input = event.target.closest('[data-document-month]');
  if (!input || !input.value || !requireStorage()) return;
  const id = input.dataset.documentMonth, month = input.value;
  action(async () => {
    await api('/api/documents/' + encodeURIComponent(id) + '/month', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month }) });
    await load();
  }, 'Mois du relevé enregistré. Le suivi mensuel est actualisé.');
});
function renderCoverage() {
  if (!state.demo && (!state.status.connected || !state.status.ready)) {
    $('#coverage-summary').textContent = 'Connectez votre espace Google pour vérifier les relevés disponibles.';
    $('#coverage-grid').innerHTML = '';
    $('#coverage-unknown').textContent = '';
    return;
  }
  const source = $('#coverage-source').value, start = $('#coverage-start').value, end = $('#coverage-end').value;
  const previousAccount=$('#coverage-account').value;
  const accounts=[...new Set(state.data.documents.filter(document=>document.source===source&&document.accountId).map(document=>document.accountId))];
  $('#coverage-account').innerHTML=accounts.map(account=>`<option value="${esc(account)}">${esc(accountName(account))}</option>`).join('');
  if(accounts.includes(previousAccount))$('#coverage-account').value=previousAccount;
  $('#coverage-account-label').hidden=!['UBS','PostFinance'].includes(source);
  const relevantDocuments=state.data.documents.filter(document=>!['UBS','PostFinance'].includes(source)||!$('#coverage-account').value||document.accountId===$('#coverage-account').value);
  const span = (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5)) - Number(start.slice(5));
  const valid = MyComptaDocumentMonths.valid(start) && MyComptaDocumentMonths.valid(end) && start <= end && span < 120;
  const months = valid ? MyComptaDocumentMonths.coverage(relevantDocuments, source, start, end) : [];
  const unknown = relevantDocuments.filter(document => document.source === source && document.statementKind!=='annual' && !MyComptaDocumentMonths.month(document)).length;
  $('#coverage-summary').textContent = valid ? `${months.filter(item => item.count > 0).length}/${months.length} mois présents · ${months.filter(item => !item.count).length} mois manquant(s) pour ${source}` : 'Choisissez une période valide de 10 ans maximum.';
  $('#coverage-grid').innerHTML = months.map(item => `<div class="coverage-month ${item.count ? 'present' : 'missing'}"><strong>${esc(new Intl.DateTimeFormat('fr-CH', { month: 'long', year: 'numeric' }).format(new Date(Number(item.month.slice(0, 4)), Number(item.month.slice(5)) - 1, 1)))}</strong><span>${item.count ? `✓ ${item.count} PDF` : 'Manquant'}</span></div>`).join('');
  $('#coverage-unknown').textContent = unknown ? `${unknown} PDF de ${source} sans mois identifié : renseignez leur mois ci-dessous avant de conclure qu’un relevé manque.` : 'Tous les documents de cet établissement ont un mois identifié.';
}
$('#period-mode option[value="year"]').textContent = `Année en cours (${new Date().getFullYear()})`;
const selectedPeriod = () => MyComptaPeriod.prefix($('#period-mode').value, $('#month').value);
function renderPeriodStatus() {
  const value = state.view === 'budgets' ? $('#month').value : selectedPeriod();
  const name = value.length === 4 ? `Année ${value}` : new Intl.DateTimeFormat('fr-CH', { month: 'long', year: 'numeric' }).format(new Date(Number(value.slice(0, 4)), Number(value.slice(5)) - 1, 1));
  $('#period-status').textContent = `${name} · ${state.data.operations.length} opération(s) chargée(s) au total${state.demo ? ' · Exemple' : ''}`;
}
$('#redirect-uri').textContent = `${location.origin}/auth/callback`;
const options = values => values.map(v => `<option>${esc(v)}</option>`).join('');
const categoryBelongsTo = (value, category) => value === category || value.startsWith(category + ' › ');
function openCategoryManagement(category) {
  if (!requireStorage() || category === 'À catégoriser') return;
  $('#category-management').dataset.category = category;
  $('#category-management-current').textContent = category;
  $('#category-management-name').value = '';
  $('#category-management-error').textContent = '';
  $('#add-subcategory').disabled = category.includes(' › ');
  $('#category-management').showModal();
}
$('#category-list').addEventListener('contextmenu', event => {
  const button = event.target.closest('[data-manage-category]');
  if (!button) return;
  event.preventDefault();
  openCategoryManagement(button.dataset.manageCategory);
});
$('#category-list').addEventListener('click', event => {
  const button = event.target.closest('[data-manage-category]');
  if (button) openCategoryManagement(button.dataset.manageCategory);
});
$('#close-category-management').onclick = () => $('#category-management').close();
async function saveCategoryManagement(subcategory) {
  const input = $('#category-management-name');
  if (!input.reportValidity()) return;
  const previous = $('#category-management').dataset.category, name = input.value.trim();
  const body = subcategory ? { name, parent: previous } : { previous, name };
  action(async () => {
    try { await api('/api/categories', { method: subcategory ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch (error) { $('#category-management-error').textContent = error.message; return; }
    $('#category-management').close();
    state.categoryFilter = null;
    await load();
    message(subcategory ? 'Sous-catégorie ajoutée et disponible immédiatement.' : 'Catégorie renommée, correspondances et opérations mises à jour.');
  });
}
$('#add-subcategory').onclick = () => saveCategoryManagement(true);
$('#rename-category').onclick = () => saveCategoryManagement(false);
$('#operation-category').innerHTML = options(categories);
$('#budget-category').innerHTML = options(categories.filter(c => c !== 'À catégoriser'));
$('#supplier-category').innerHTML = options(categories.filter(c => c !== 'À catégoriser'));

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'X-MyCompta': '1', ...options.headers } });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'La requête a échoué.'),result);
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
  document.querySelectorAll('button[type="submit"],#setup,#disconnect,#refresh,#categorize-existing').forEach(b => { b.disabled = true; });
  try { await fn(); if (success) message(success); }
  catch (error) { message(error.message, true); }
  finally {
    state.busy = false;
    document.body.removeAttribute('aria-busy');
    document.querySelectorAll('button[type="submit"],#setup,#disconnect,#refresh,#categorize-existing').forEach(b => { b.disabled = false; });
  }
}
function showView(view) {
  state.view = view;
  Object.keys(titles).forEach(key => { $(`#view-${key}`).hidden = key !== view; });
  document.querySelectorAll('.nav').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('#title').textContent = $('#breadcrumb').textContent = titles[view][0];
  $('#subtitle').textContent = titles[view][1];
  $('#month-label').hidden = !['dashboard', 'operations', 'budgets','savings'].includes(view);
  $('#holder-label').hidden = !['operations', 'review'].includes(view);
  $('#operation-category-label').hidden = view !== 'operations';
  $('#period-mode').hidden = view === 'budgets';
  $('#month').hidden = view !== 'budgets' && $('#period-mode').value === 'year';
  $('#period-status').hidden = !['dashboard', 'operations', 'budgets','savings'].includes(view);
  renderPeriodStatus();
  $('#import-shortcut').hidden = ['settings', 'documents', 'preferences', 'household'].includes(view);
  $('#onboarding').hidden = state.status.connected || state.demo || ['settings', 'preferences', 'household'].includes(view);
}
function openCategoryMenu(id) {
  if (!requireStorage()) return;
  const operation = state.data.operations.find(item => item.id === id);
  if (!operation || !['expense', 'income'].includes(operation.type)) return;
  const dialog = $('#category-menu');
  dialog.dataset.operationId = id;
  $('#category-remember-filter').checked = true;
  $('#category-rule-settings').hidden = false;
  $('#category-rule-filter').disabled = false;
  $('#category-menu-label').textContent = operation.label;
  $('#category-rule-filter').value = operation.label.slice(0, 120);
  $('#category-rule-error').hidden = true;
  $('#category-menu-options').innerHTML = categories.filter(category => category !== 'À catégoriser').map(category => `<button type="button" class="secondary" data-assign-category="${esc(category)}">${esc(category)}</button>`).join('');
  if(!dialog.open)dialog.showModal();
}
for(const target of ['#review-list','#operations-list'])$(target).addEventListener('contextmenu', event => {
  const row = event.target.closest('[data-operation-id]');
  if (!row) return;
  const operation=state.data.operations.find(item=>item.id===row.dataset.operationId);
  if(!operation||!['expense','income'].includes(operation.type))return;
  event.preventDefault();
  openCategoryMenu(row.dataset.operationId);
});
$('#category-remember-filter').onchange = () => {
  const remember = $('#category-remember-filter').checked;
  $('#category-rule-settings').hidden = !remember;
  $('#category-rule-filter').disabled = !remember;
  $('#category-rule-error').hidden = true;
};
$('#close-category-menu').onclick = () => $('#category-menu').close();
$('#close-categorization-preview').onclick = () => $('#categorization-preview').close();
async function openCategorizationPreview(onlyWithMatches = false, reclassify = false) {
    const result = await api('/api/categorize/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reclassify }) });
    state.rescanReclassify = reclassify;
    $('#rescan-title').textContent = reclassify ? 'Reclasser les opérations' : 'Valider les correspondances';
    $('#rescan-description').textContent = reclassify ? 'Recherche sur tous les mois, titulaires et établissements, y compris les opérations déjà catégorisées. Décochez les classements manuels à conserver. Seuls les changements proposés par une règle fournisseur sont affichés.' : 'Recherche sur tous les mois et toutes les règles fournisseurs. Seules les opérations À catégoriser sont proposées. Décochez les lignes à conserver sans catégorie.';
    state.rescanMatches = result.matches;
    if (onlyWithMatches && !result.matches.length) return;
    $('#rescan-count').textContent = `${result.matches.length} correspondance(s) trouvée(s). Aucune modification appliquée à ce stade.`;
    $('#rescan-results').innerHTML = result.matches.length ? `<table><thead><tr><th>Appliquer</th><th>Date</th><th>Libellé</th><th>Montant</th><th>Filtre</th><th>Catégorie actuelle</th><th>Catégorie proposée</th></tr></thead><tbody>${result.matches.map((item, index) => `<tr><td data-label="Appliquer"><input type="checkbox" data-rescan-index="${index}" checked aria-label="Appliquer à ${esc(item.label)}"></td><td data-label="Date">${esc(item.date)}</td><td data-label="Libellé">${esc(item.label)}</td><td data-label="Montant">${esc(money(item.amount, item.currency))}</td><td data-label="Filtre">${esc(item.supplier)}</td><td data-label="Ancienne catégorie">${esc(item.previousCategory || 'À catégoriser')}</td><td data-label="Nouvelle catégorie">${esc(item.category)}</td></tr>`).join('')}</tbody></table>` : '<p>Aucune opération à classer avec les règles actuelles.</p>';
    $('#confirm-categorization').disabled = !result.matches.length;
    $('#categorization-preview').showModal();
}
$('#preview-categorization').onclick = () => {
  if (requireStorage()) action(() => openCategorizationPreview());
};
$('#reclassify-operations').onclick = () => {
  if (requireStorage()) action(() => openCategorizationPreview(false, true));
};
$('#confirm-categorization').onclick = () => {
  const items = [...document.querySelectorAll('[data-rescan-index]:checked')].map(input => state.rescanMatches[Number(input.dataset.rescanIndex)]).map(({ id, category, previousCategory }) => ({ id, category, previousCategory }));
  if (!items.length) { $('#rescan-count').textContent = 'Sélectionnez au moins une ligne.'; return; }
  if (items.length > 2000) { $('#rescan-count').textContent = 'Sélectionnez au maximum 2000 lignes par validation.'; return; }
  action(async () => {
    let result;
    try { result = await api('/api/categorize/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, reclassify: state.rescanReclassify }) }); }
    catch (error) { $('#rescan-count').textContent = error.message; return; }
    $('#categorization-preview').close();
    $('#rescan-offer').hidden = true;
    await load();
    message(`${result.updated} opération(s) classée(s) après validation.`);
  });
};

document.addEventListener('click', event => {
  const quickCategory = event.target.closest('[data-quick-category]');
  if (quickCategory) openCategoryMenu(quickCategory.dataset.quickCategory);
  const assign = event.target.closest('[data-assign-category]');
  if (assign && state.busy) {
    $('#category-rule-error').textContent = 'Actualisation en cours, veuillez réessayer dans un instant.';
    $('#category-rule-error').hidden = false;
    return;
  }
  if (assign) {
    const id = $('#category-menu').dataset.operationId, category = assign.dataset.assignCategory;
    const rememberFilter = $('#category-remember-filter').checked;
    const filter = $('#category-rule-filter').value.trim();
    if (rememberFilter && !$('#category-rule-filter').reportValidity()) return;
    $('#category-menu').close();
    action(async () => {
      const result = await api('/api/operations/' + encodeURIComponent(id) + '/category', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category, filter, rememberFilter }) });
      await load();
      if (!rememberFilter) { message(`Catégorie ${category} attribuée uniquement à cette opération.`); return; }
      message(`Catégorie ${category} attribuée. Correspondance mémorisée pour « ${result.supplier} ». Vous pouvez la modifier dans Fournisseurs.`);
      $('#rescan-offer').hidden = false;
      await openCategorizationPreview(true);
    });
  }
  const categoryRow = event.target.closest('[data-budget-category]');
  if (categoryRow) {
    $('#holder-filter').value = '';
    state.categoryFilter = { category: categoryRow.dataset.budgetCategory, currency: categoryRow.dataset.currency, expensesOnly: true };
    $('#search').value = '';
    showView('operations');
    renderOperations();
    $('#category-detail-label').focus();
  }
  const nav = event.target.closest('[data-view]');
  if (nav?.hasAttribute('data-dashboard-card')) {
    $('#holder-filter').value = '';
    state.categoryFilter = null;
    $('#search').value = '';
    renderOperations();
  }
  if (nav) { showView(nav.dataset.view); if (nav.dataset.view === 'household') action(loadHousehold); if(nav.dataset.view==='reconciliation')action(()=>MyComptaBank.load()); if(nav.dataset.view==='importerrors')action(()=>MyComptaWorkflows.loadInbox()); }
  const edit = event.target.closest('[data-edit]');
  const removeMember = event.target.closest('[data-remove-member]');
  if (removeMember && window.confirm('Retirer cette personne du foyer et bloquer ses sessions ?')) action(async () => {
    await api('/api/household/members/' + encodeURIComponent(removeMember.dataset.removeMember), { method: 'DELETE' });
    await loadHousehold();
  }, 'Membre retiré du foyer.');
  if (edit) editOperation(state.data.operations.find(o => o.id === edit.dataset.edit));
  const supplierEdit = event.target.closest('[data-edit-supplier]');
  if (supplierEdit) editSupplier(supplierEdit.dataset.editSupplier);
  const supplierDelete = event.target.closest('[data-delete-supplier]');
  if (supplierDelete && requireStorage()) action(async () => {
    await api('/api/suppliers/' + encodeURIComponent(supplierDelete.dataset.deleteSupplier), { method: 'DELETE' });
    resetSupplierForm();
    await load();
    message('Règle supprimée. Les catégories des opérations existantes sont conservées.');
  });
  const reanalyse = event.target.closest('[data-reanalyse]');
  const rename = event.target.closest('[data-rename]');
  if (rename && requireStorage()) action(async () => {
    message('Lecture de la date de facture et mise à jour du nom…');
    const result = await api('/api/documents/' + encodeURIComponent(rename.dataset.rename) + '/rename', { method: 'POST' });
    await load();
    message(`Document renommé : ${result.name}`);
  });
  if (reanalyse && requireStorage() && window.confirm('Relire le détail du relevé ? Les lignes du document seront remplacées par la nouvelle extraction. Les catégories et exclusions seront conservées pour les opérations retrouvées ; les lignes sans correspondance seront remplacées. Pour UBS et PostFinance, les types dépense / revenu / virement seront recalculés.')) action(async () => {
    message('Relecture du détail Cembra depuis le PDF archivé…');
    const result = await api('/api/documents/' + encodeURIComponent(reanalyse.dataset.reanalyse) + '/reanalyse', { method: 'POST' });
    await load();
    message(`${result.count} opération(s) relues et prises en compte. ${result.note}`);
  });
});
$('#import-shortcut').onclick = () => { showView('documents'); $('#upload-form select').focus(); };
$('#month').onchange = () => { if ($('#month').value) render(); };
$('#period-mode').onchange = () => render();
$('#search').oninput = renderOperations;
$('#holder-filter').onchange = renderOperations;
$('#operation-category-filter').onchange = () => {
  const category = $('#operation-category-filter').value;
  state.categoryFilter = category ? { category } : null;
  renderOperations();
};
const holderKey = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('fr');
const matchesHolder = operation => !$('#holder-filter').value || ($('#holder-filter').value === 'unknown' ? !holderKey(operation.holder) : 'holder:' + holderKey(operation.holder) === $('#holder-filter').value);
$('#clear-category-filter').onclick = () => {
  state.categoryFilter = null;
  renderOperations();
};
$('#refresh').onclick = () => action(load, 'Données actualisées.');
$('#close-dialog').onclick = () => $('#operation-dialog').close();
$('#add-operation').onclick = () => editOperation();

function empty(title, detail = '') { return `<div class="empty"><span>◌</span><strong>${esc(title)}</strong>${esc(detail)}</div>`; }
function pdfUrl(document, page = 0) {
  if (!document || !/^[\w-]+$/.test(document.driveId || '')) return null;
  if (state.status.multiUser) return `/api/documents/${encodeURIComponent(document.id)}/pdf${page ? '#page=' + Number(page) : ''}`;
  return `https://drive.google.com/file/d/${encodeURIComponent(document.driveId)}/view${page ? '#page=' + Number(page) : ''}`;
}
function docRows(documents, compact = false) {
  if (!documents.length) return empty('Votre bibliothèque commence ici', 'Importez votre premier relevé PDF.');
  return [...documents].reverse().map(d => {
    const url = state.demo ? null : pdfUrl(d);
    const reanalyse = !compact && !state.demo && ['Cembra', 'TopCard','UBS','PostFinance'].includes(d.source)
      ? `<p><button class="text-button" data-reanalyse="${esc(d.id)}">Relire le détail ${esc(d.source)}</button></p>${d.source === 'Cembra' ? `<p><button class="text-button" data-rename="${esc(d.id)}">Renommer avec la date de facture</button></p>` : ''}` : '';
    const operations = state.data.operations.filter(o => o.documentId === d.id);
    const pending = operations.filter(o => !o.isSavings && ['expense','income'].includes(o.type) && o.status !== 'ignored' && o.category === 'À catégoriser').length;
    const status = d.status==='Import partiel'?'Import partiel':operations.length ? (pending ? `${pending} à catégoriser` : 'Traité') : ['UBS','PostFinance'].includes(d.source)&&d.importReport?'Contrôlé / opérations déjà présentes':'Saisie nécessaire';
    return `<div class="document-row"><span class="pdf-icon">PDF</span><div class="document-info"><strong>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(d.name)} ↗</a>` : esc(d.name)}</strong><small>${esc(d.source)} · Importé le ${esc(importDate(d.importedAt))} · ${operations.length} opération(s)${d.createdBy ? " · Ajouté par " + esc(d.createdBy) : ""}</small>${!compact && d.note ? `<p>${esc(d.note)}</p>` : ''}${reanalyse}${!compact && d.statementKind !== "annual" ? `<label class="document-month-label">Mois du relevé<input type="month" data-document-month="${esc(d.id)}" value="${esc(MyComptaDocumentMonths.month(d))}" aria-label="Mois du relevé ${esc(d.name)}"></label>` : ''}</div><span class="badge ${pending ? '' : operations.length ? 'validated' : ''}">${esc(status)}</span></div>`;
  }).join('');
}
function operationTable(operations, quickCategory = false) {
  if (!operations.length) return empty('Aucune opération à afficher', 'Les lignes importées apparaîtront ici.');
  return `<table class="operation-table"><thead><tr><th>Date</th><th class="amount">Montant</th><th>Libellé / compte</th><th class="holder-cell">Titulaire</th><th>Catégorie</th><th>État</th><th>Ajouté par</th><th class="${quickCategory?'category-action':''}"></th></tr></thead><tbody>${operations.map(o => `<tr data-operation-id="${esc(o.id)}"><td>${esc(o.date.split('-').reverse().join('.'))}</td><td class="amount">${esc(money(o.amount, o.currency))}</td><td class="label-cell" title="${esc(o.label)}">${esc(o.label)}<span class="subtext">${esc(accountName(o.account))} · ${esc(typeLabels[o.type] || o.type)}</span></td><td class="holder-cell" title="${esc(o.holder || "Non renseigné")}">${MyComptaHolders.badge(o.holder)}<span class="subtext">${esc(o.cardLast4 ? "Carte " + o.cardLast4 : "")}</span></td><td>${esc(o.category)}</td><td><span class="badge ${esc(o.status)}">${esc(o.status !== "ignored" && o.category === "À catégoriser" ? "À catégoriser" : labels[o.status] || o.status)}</span></td><td>${esc(o.createdBy || "—")}</td><td class="${quickCategory?'category-action':''}">${quickCategory ? `<button type="button" class="primary" data-quick-category="${esc(o.id)}">Catégoriser</button>` : `<button class="text-button" data-edit="${esc(o.id)}">Modifier →</button>`}</td></tr>`).join('')}</tbody></table>`;
}
const operationList=$('#operations-list'),operationScrollbar=$('#operations-scrollbar');
function updateOperationScrollbar(){
  const overflow=operationList.clientWidth>0&&operationList.scrollWidth>operationList.clientWidth;
  operationScrollbar.hidden=!overflow;
  operationScrollbar.firstElementChild.style.width=operationList.scrollWidth+'px';
  operationScrollbar.scrollLeft=operationList.scrollLeft;
}
operationScrollbar.onscroll=()=>{operationList.scrollLeft=operationScrollbar.scrollLeft;};
operationList.onscroll=()=>{operationScrollbar.scrollLeft=operationList.scrollLeft;};
new ResizeObserver(updateOperationScrollbar).observe(operationList);
function renderOperations() {
  const month = selectedPeriod();
  const search = $('#search').value.toLocaleLowerCase('fr');
  const allForPeriod = state.data.operations.filter(o => !o.isSavings && MyComptaPeriod.matches(o.date, month)).sort((a, b) => b.date.localeCompare(a.date));
  const filtered = allForPeriod.filter(matchesHolder);
  const selection = state.categoryFilter;
  $('#operation-category-filter').value = selection?.category || '';
  const details = selection ? filtered.filter(o => categoryBelongsTo(o.category, selection.category) && (!selection.currency || o.currency === selection.currency) && (!selection.expensesOnly || (o.type === 'expense' && o.status !== 'ignored'))) : filtered;
  $('#category-detail').hidden = !selection;
  if (selection) $('#category-detail-label').textContent = `${selection.category} · ${details.length} opération(s)${selection.expensesOnly ? ' · Dépenses incluses uniquement' : ''}`;
  const visible = details.filter(o => `${o.label} ${o.account} ${o.holder || ""} ${o.cardLast4 || ""}`.toLocaleLowerCase('fr').includes(search));
  $('#operations-list').innerHTML = operationTable(visible);
  const totals = MyComptaOperationTotals.calculate(visible);
  $('#operations-totals').innerHTML = `<strong>${visible.length} opération(s) affichée(s)</strong><div class="operation-total-values">${totals.length ? totals.map(total => `<div><span>Dépenses : <strong>${esc(money(total.expenses, total.currency))}</strong></span>${total.income ? `<span>Revenus / remboursements : ${esc(money(total.income, total.currency))}</span><span>Solde dépenses − revenus : <strong>${esc(money(total.net, total.currency))}</strong></span>` : ''}</div>`).join('') : '<span>Aucun montant à totaliser.</span>'}</div><small>Hors opérations ignorées, virements et règlements de carte. Totaux selon les filtres affichés.</small>`;
  updateOperationScrollbar();
  $('#recent-operations').innerHTML = operationTable(allForPeriod.slice(0, 5));
  $('#review-list').innerHTML = operationTable(state.data.operations.filter(o => !o.isSavings && ['expense','income'].includes(o.type) && matchesHolder(o) && o.status !== 'ignored' && o.category === 'À catégoriser'), true);
}
function summary() {
  const expense = state.data.operations.filter(o => !o.isSavings && MyComptaPeriod.matches(o.date, selectedPeriod()) && o.status !== 'ignored' && o.type === 'expense');
  const totals = {}, groups = {};
  expense.forEach(o => {
    totals[o.currency] = (totals[o.currency] || 0) + Math.round(o.amount * 100);
    const key = JSON.stringify([o.category.split(' › ')[0], o.currency]);
    groups[key] = (groups[key] || 0) + Math.round(o.amount * 100);
  });
  return { expense, totals, groups };
}
function render() {
  MyComptaHolders.render(state.data);
  MyComptaBank.render(state.data);
  MyComptaWorkflows.renderSavings();
  const previousHolder = $('#holder-filter').value;
  const holders = [...new Set(state.data.operations.map(o => holderKey(o.holder)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  $('#holder-filter').innerHTML = '<option value="">Tous les titulaires</option>' + holders.map(holder => `<option value="${esc('holder:' + holder)}">${esc(holder)}</option>`).join('') + '<option value="unknown">Non renseigné</option>';
  if ([...$('#holder-filter').options].some(option => option.value === previousHolder)) $('#holder-filter').value = previousHolder;
  MyComptaAnnual.render(state.data.operations);
  renderCoverage();
  if (state.data.categories?.length) categories = state.data.categories;
  $('#operation-category-filter').innerHTML = '<option value="">Toutes les catégories</option>' + options(categories);
  for (const id of ['operation-category', 'budget-category', 'supplier-category']) {
    const select = $('#' + id), previous = select.value;
    select.innerHTML = options(id === 'operation-category' ? categories : categories.filter(c => c !== 'À catégoriser'));
    if (categories.includes(previous)) select.value = previous;
  }
  $('#category-list').innerHTML = categories.map(name => name === 'À catégoriser' ? `<span class="chip">${esc(name)}</span>` : `<button type="button" class="secondary" data-manage-category="${esc(name)}" title="Ajouter une sous-catégorie ou renommer">${esc(name)}</button>`).join('');
  const previousParent = $('#new-category-parent').value;
  $('#new-category-parent').innerHTML = '<option value="">Aucune — catégorie principale</option>' + options(categories.filter(name => name !== 'À catégoriser' && !name.includes(' › ')));
  if (categories.includes(previousParent)) $('#new-category-parent').value = previousParent;
  const annual = $('#period-mode').value === 'year';
  renderPeriodStatus();
  $('#expense-period-title').textContent = annual ? 'Dépenses de l’année' : 'Dépenses du mois';
  $('#count-period-title').textContent = annual ? 'Opérations de l’année' : 'Opérations du mois';
  $('#operations-period-title').textContent = annual ? 'Toutes les opérations de l’année' : 'Toutes les opérations du mois';
  renderSuppliers();
  const { expense, totals, groups } = summary();
  const pending = state.data.operations.filter(o => !o.isSavings && ['expense','income'].includes(o.type) && o.status !== 'ignored' && o.category === 'À catégoriser').length;
  $('#total').textContent = Object.entries(totals).map(([currency, amount]) => money(amount / 100, currency)).join('\n') || money(0);
  $('#count').textContent = expense.length;
  $('#pending').textContent = $('#nav-count').textContent = pending;
  $('#demo-banner').hidden = !state.demo;
  $('#category-chart').innerHTML = Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([key, cents]) => {
    const [category, currency] = JSON.parse(key);
    return `<button type="button" class="category-row category-drilldown" data-budget-category="${esc(category)}" data-currency="${esc(currency)}" aria-label="Voir les dépenses ${esc(category)} en ${esc(currency)}"><div><span>${esc(category)} →</span><strong>${esc(money(cents / 100, currency))}</strong></div><progress value="${cents}" max="${totals[currency]}" aria-label="${esc(category)}"></progress></button>`;
  }).join('') || empty('Un premier relevé, une première vue', 'Importez des opérations pour voir leur répartition.');
  $('#recent-documents').innerHTML = docRows(state.data.documents.slice(-3), true);
  $('#documents-list').innerHTML = docRows(state.data.documents);
  $('#document-count').textContent = `${state.data.documents.length} document(s)`;
  renderOperations();
  const budgets = state.data.budgets.filter(b => b.month === $('#month').value);
  $('#budget-list').innerHTML = budgets.map(b => {
    const spent = state.data.operations.filter(o => !o.isSavings && MyComptaPeriod.matches(o.date, b.month) && o.status !== 'ignored' && o.type === 'expense' && categoryBelongsTo(o.category, b.category) && o.currency === 'CHF').reduce((sum, o) => sum + Math.round(o.amount * 100), 0) / 100;
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
  $('#setup').hidden = !s.connected || (s.multiUser && (s.role !== 'owner' || !s.driveConnected));
  $('#disconnect').hidden = !s.connected || (s.multiUser && (s.role !== 'owner' || !s.driveConnected));
  $('#disconnect').textContent = s.multiUser ? 'Retirer l’autorisation du stockage Google' : 'Déconnecter Google';
  $('#logout-household').hidden = !s.multiUser || !s.connected;
  if (s.multiUser) {
    const text = !s.connected ? 'Connectez votre compte Google pour rejoindre le foyer. Le propriétaire doit vous avoir ajouté au préalable.'
      : !s.driveConnected ? 'La session est ouverte. Le propriétaire doit reconnecter le stockage Google du foyer.'
      : `Connecté au foyer en tant que ${s.role === 'owner' ? 'propriétaire' : 'membre'}. Le stockage est commun à tous les membres.`;
    $('#connection-state').insertAdjacentHTML('beforeend', `<p class="muted">${esc(text)}</p>${s.role === 'owner' ? '<p><a class="secondary" href="/auth/google?drive=1">Reconnecter le stockage Google</a></p>' : ''}`);
  }
  $('#google-links').innerHTML = [s.sheetUrl ? `<a class="secondary" href="${esc(s.sheetUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir Google Sheets ↗</a>` : '', s.driveUrl ? `<a class="secondary" href="${esc(s.driveUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir Google Drive ↗</a>` : ''].join('');
  showView(state.view);
}
async function load() {
  if (state.demo) { render(); return; }
  state.status = await api('/api/status');
  await MyComptaWorkflows.refreshInboxCount();
  if (state.status.connected && state.status.ready && (!state.status.multiUser || state.status.driveConnected)) state.data = await api('/api/data');
  else state.data = { documents: [], operations: [], budgets: [], categories: [] };
  render();
  if (state.view === 'household') await loadHousehold();
  if(state.view==='reconciliation')await MyComptaBank.load();
  if(state.view==='importerrors')await MyComptaWorkflows.loadInbox();
}
function requireStorage() {
  if (state.demo) { message('L’exemple est en lecture seule. Quittez-le et connectez Google pour enregistrer vos données.'); return false; }
  if (!state.status.connected || !state.status.ready) { showView('settings'); message('Connectez Google et créez votre espace pour enregistrer des données.'); return false; }
  return true;
}
$('#category-form').onsubmit = event => {
  event.preventDefault();
  if (!requireStorage()) return;
  const name = event.target.elements.name.value.trim();
  const parent = $('#new-category-parent').value;
  action(async () => {
    await api('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parent }) });
    await load();
    $('#category-form').reset();
  }, 'Catégorie ajoutée. Elle est disponible dans les opérations, les fournisseurs et les budgets.');
};
$('#setup').onclick = () => action(async () => { state.status = await api('/api/setup', { method: 'POST' }); await load(); }, 'Votre espace Google est prêt. Vous pouvez importer un PDF.');
$('#disconnect').onclick = () => action(async () => { await api('/api/disconnect', { method: 'POST' }); state.demo = false; await load(); }, 'Google déconnecté. Vos documents et votre tableur sont conservés.');
$('#upload-form').onsubmit = event => {
  event.preventDefault();
  if (!requireStorage()) return;
  const form = event.target, files = Array.from(MyComptaWorkflows.files(form.pdf)), source = form.source.value;
  if (!files.length) return message('Choisissez au moins un PDF.', true);
  action(async () => {
    const results = await MyComptaImports.run(files, source,
      (file, source) => api('/api/documents?' + new URLSearchParams({ name: file.name, source }), { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file }),
      ({ index, file, results }) => {
        message('Import ' + (index + 1) + '/' + files.length + ' : ' + file.name);
        $('#import-results').innerHTML = results.map(item => '<p class="banner' + (item.error ? ' import-error' : '') + '"><strong>' + esc(item.name) + '</strong><br>' + esc(item.error || (item.response.duplicate ? 'Relevé déjà importé (fichier ou données identiques) : aucun ajout.' : item.response.count + ' opération(s) importée(s). ' + (item.response.note || ''))) + '</p>').join('');
      });
    const failed = results.filter(item => item.error).length;
    if (!failed) {form.reset();MyComptaWorkflows.clearFiles();}
    if(failed)$('#import-results').insertAdjacentHTML('beforeend','<button class="secondary" data-view="importerrors">Voir les PDF en erreur et leurs diagnostics</button>');
    try { await load(); } catch (error) { message('Imports terminés. Actualisation impossible : ' + error.message, true); return; }
    message((files.length - failed) + '/' + files.length + ' fichier(s) traité(s). Consultez les résultats ci-dessous.', failed > 0);
  });
};
function editOperation(operation) {
  if (!requireStorage()) return;
  state.editing = operation || null;
  const form = $('#operation-form');
  form.reset();
  $('#dialog-error').hidden = true;
  $('#operation-document').innerHTML = '<option value="">Sans document</option>' + state.data.documents.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
  const values = { ...(operation || { date: today(), currency: 'CHF', category: 'À catégoriser', type: 'expense', account: '' }), status: operation?.status === 'ignored' ? 'ignored' : 'validated' };
  Object.entries(values).forEach(([key, value]) => { if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value; });
  $('#dialog-title').textContent = operation ? 'Modifier une opération' : 'Ajouter une opération';
  $('#operation-context').textContent = operation?.raw ? `Ligne d’origine · page ${operation.page} : ${operation.raw}` : 'Le montant est toujours positif. Choisissez le type pour préciser son sens.';
  updateOperationHints();
  $('#operation-dialog').showModal();
}
function updateOperationHints() {
  const form = $('#operation-form');
  const document = state.data.documents.find(d => d.id === form.documentId.value);
  $('#open-pdf').hidden = !pdfUrl(document);
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
    suppliers: [{ id: 'demo-coop', name: 'Coop', category: 'Alimentation' }, { id: 'demo-migros', name: 'Migros', category: 'Alimentation' }, { id: 'demo-cff', name: 'CFF', category: 'Transports' }],
    documents: [{ id: 'demo-doc', name: 'Relevé du foyer · exemple.pdf', source: 'Exemple', importedAt: new Date().toISOString() }],
    operations: [['Loyer', 1650, 'Logement'], ['Migros', 142.80, 'Alimentation'], ['CFF', 85, 'Transports'], ['Assurance ménage', 46, 'Assurances'], ['Restaurant', 67.50, 'Loisirs'], ['Pharmacie', 32, 'Santé']].map(([label, amount, category], i) => ({ id: 'demo-' + i, documentId: 'demo-doc', date: `${month}-${String(i + 1).padStart(2, '0')}`, label, amount, currency: 'CHF', category: i === 5 ? 'À catégoriser' : category, type: 'expense', status: 'validated', account: 'Compte du foyer' })),
    budgets: [{ month, category: 'Alimentation', amount: 650 }, { month, category: 'Loisirs', amount: 250 }], categories,
  };
  $('#notice').hidden = true;
  render();
};
$('#exit-demo').onclick = () => { state.demo = false; action(load); };
function renderSuppliers() {
  const suppliers = state.data.suppliers || [];
  const search = $('#supplier-search').value.toLocaleLowerCase('fr');
  const filtered = suppliers.filter(s => `${s.name} ${s.category}`.toLocaleLowerCase('fr').includes(search));
  $('#supplier-count').textContent = `${suppliers.length} fournisseur(s)`;
  $('#suppliers-list').innerHTML = filtered.length ? `<table><thead><tr><th>Fournisseur / texte recherché</th><th>Catégorie automatique</th><th>Actions</th></tr></thead><tbody>${[...filtered].sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(s => `<tr><td>${esc(s.name)}</td><td><span class="chip">${esc(s.category)}</span></td><td><div class="actions"><button class="text-button" data-edit-supplier="${esc(s.id)}">Modifier</button><button class="text-button" data-delete-supplier="${esc(s.id)}">Supprimer</button></div></td></tr>`).join('')}</tbody></table>` : empty('Aucun fournisseur à afficher', 'Ajoutez une règle pour automatiser le classement.');
}
function resetSupplierForm() {
  state.editingSupplier = null;
  $('#supplier-form').reset();
  $('#save-supplier').textContent = 'Ajouter le fournisseur';
  $('#cancel-supplier').hidden = true;
}
function editSupplier(id) {
  if (!requireStorage()) return;
  const supplier = state.data.suppliers?.find(s => s.id === id);
  if (!supplier) return;
  state.editingSupplier = id;
  $('#supplier-form').elements.name.value = supplier.name;
  $('#supplier-category').value = supplier.category;
  $('#save-supplier').textContent = 'Enregistrer la règle';
  $('#cancel-supplier').hidden = false;
  $('#supplier-form').elements.name.focus();
}
$('#supplier-search').oninput = renderSuppliers;
$('#cancel-supplier').onclick = resetSupplierForm;
async function loadHousehold() {
  const s = state.status;
  $('#household-owner-controls').hidden = true;
  $('#members-list').innerHTML = '';
  if (!s.multiUser) { $('#household-state').textContent = 'Le mode foyer partagé sera disponible avec MULTI_USER=true dans la configuration de l’add-on. Le mode local actuel reste personnel.'; return; }
  if (!s.connected) { $('#household-state').textContent = 'Connectez-vous avec votre compte Google pour rejoindre le foyer.'; return; }
  if (s.role !== 'owner') { $('#household-state').textContent = 'Vous êtes membre du foyer : vous pouvez consulter les données et ajouter ou modifier des informations. Le propriétaire gère les accès.'; return; }
  const data = await api('/api/household');
  $('#household-state').textContent = `Propriétaire : ${data.owner?.name || ''} (${data.owner?.email || ''}). Le dossier Drive et le tableur sont accessibles aux membres à travers MyCompta.`;
  $('#household-owner-controls').hidden = false;
  $('#members-list').innerHTML = data.members.length ? `<table><thead><tr><th>Membre</th><th>Accès</th><th></th></tr></thead><tbody>${data.members.map(m => `<tr><td>${esc(m.name || m.email)}<span class="subtext">${esc(m.name ? m.email : '')}</span></td><td>${m.status === 'active' ? 'Accès activé' : 'Autorisé, première connexion à effectuer'}</td><td><button class="text-button" data-remove-member="${esc(m.id)}">Retirer</button></td></tr>`).join('')}</tbody></table>` : empty('Aucun autre membre', 'Ajoutez une adresse Google pour partager votre foyer.');
}
$('#member-form').onsubmit = event => {
  event.preventDefault();
  const email = event.target.elements.email.value;
  action(async () => {
    await api('/api/household/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    event.target.reset();
    await loadHousehold();
  }, 'Membre autorisé. Communiquez-lui le lien MyCompta pour sa première connexion.');
};
$('#logout-household').onclick = () => action(async () => {
  await api('/api/logout', { method: 'POST' });
  if ($('#operation-dialog').open) $('#operation-dialog').close();
  await load();
}, 'Votre session est fermée. Le foyer reste accessible aux autres membres.');
$('#supplier-form').onsubmit = event => {
  event.preventDefault();
  if (!requireStorage()) return;
  const value = Object.fromEntries(new FormData(event.target));
  action(async () => {
    await api('/api/suppliers' + (state.editingSupplier ? '/' + encodeURIComponent(state.editingSupplier) : ''), { method: state.editingSupplier ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    resetSupplierForm();
    await load();
  }, 'Règle enregistrée. Elle sera appliquée aux prochains imports.');
};
$('#categorize-existing').onclick = () => {
  if (!requireStorage()) return;
  action(async () => {
    const result = await api('/api/categorize', { method: 'POST' });
    await load();
    message(`${result.updated} opération(s) catégorisée(s). Les catégories déjà renseignées sont conservées.`);
  });
};
const errorCode = new URLSearchParams(location.search).get('error');
if (errorCode) { message(errorCode === 'configuration' ? 'Renseignez la configuration Google avant de vous connecter.' : errorCode === 'nonmembre' ? 'Ce compte ne fait pas partie du foyer. Le propriétaire doit ajouter votre adresse Google dans Mon foyer.' : errorCode === 'compte' ? 'Cet espace appartient à un autre compte Google. Reconnectez le compte utilisé pour créer votre espace MyCompta.' : 'La connexion Google n’a pas abouti. Vérifiez les autorisations, le client OAuth et l’URI de redirection, puis réessayez.', true); history.replaceState(null, '', '/'); showView('settings'); }
// Installed mobile apps may stay open for days; reload Sheets on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !state.demo && !state.busy) action(load);
});
window.addEventListener('pageshow', event => {
  if (event.persisted && !state.demo && !state.busy) action(load);
});
action(load);
