const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const fail = message => Object.assign(new Error(message), { status: 400 });

function validatePair(operations, debitId, creditId) {
  const debit = operations.find(o => o.id === debitId), credit = operations.find(o => o.id === creditId);
  if (!debit || !credit || debit.id === credit.id || debit.type !== 'transfer' || credit.type !== 'transfer'
    || debit.status === 'ignored' || credit.status === 'ignored' || debit.account === credit.account
    || debit.bankDirection !== 'debit' || credit.bankDirection !== 'credit' || debit.currency !== credit.currency
    || Math.round(debit.amount * 100) !== Math.round(credit.amount * 100)
    || !Number.isFinite(Date.parse(debit.date)) || !Number.isFinite(Date.parse(credit.date))
    || Math.abs(Date.parse(debit.date) - Date.parse(credit.date)) > 5 * 86400000) {
    throw fail('Ces opérations ne constituent pas une paire de virements compatible.');
  }
  return { debit, credit };
}

class TransferLinks {
  constructor(directory) { this.directory = directory; this.memory = new Map(); }
  file(scope) { return path.join(this.directory, crypto.createHash('sha256').update(scope).digest('hex') + '.json'); }
  async read(scope) {
    if (!this.directory) return structuredClone(this.memory.get(scope) || []);
    try { return JSON.parse(await fs.readFile(this.file(scope), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async write(scope, links) {
    if (!this.directory) { this.memory.set(scope, structuredClone(links)); return; }
    await fs.mkdir(this.directory, { recursive: true });
    const file = this.file(scope), temporary = file + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(links), { mode: 0o600 });
    await fs.rename(temporary, file);
  }
  async link(scope, operations, debitId, creditId, automatic = false) {
    validatePair(operations, debitId, creditId);
    let links = await this.read(scope);
    const existing = links.find(item => item.debitId === debitId && item.creditId === creditId);
    if (existing && (!existing.blocked || automatic)) return existing;
    links = links.filter(item => item !== existing);
    if (links.some(item => !item.blocked && [item.debitId, item.creditId].some(id => id === debitId || id === creditId))) {
      throw fail('Une de ces opérations est déjà liée. Dissociez-la avant de changer le lien.');
    }
    const item = { id: crypto.randomUUID(), debitId, creditId, automatic, createdAt: new Date().toISOString() };
    await this.write(scope, [...links, item]);
    return item;
  }
  async unlink(scope, id) {
    const links = await this.read(scope);
    await this.write(scope, links.flatMap(item => item.id !== id ? [item] : item.automatic ? [{ ...item, blocked: true }] : []));
  }
  async autoLink(scope, data) {
    const links = await this.read(scope);
    const { pairs } = require('./bank-reconciliation').buildReconciliation({ ...data, transferLinks:links }, '0000-01', '9999-12');
    let count = 0;
    for (const pair of pairs) {
      const source = (data.accounts || []).find(account => account.id === pair.debit.account);
      const target = (data.accounts || []).find(account => account.id === pair.credit.account);
      const name = String(target?.name || '').trim().replace(/\s+/g,' ').toLocaleLowerCase('fr');
      const fromPostFinance = source?.source === 'PostFinance' || /^PostFinance\b/i.test(pair.debit.account);
      if (!fromPostFinance || !['courant nico','commun'].includes(name) || Math.round(pair.debit.amount*100)%100 !== 0) continue;
      const existing = links.find(link => link.debitId === pair.debit.id && link.creditId === pair.credit.id);
      if (existing) continue;
      await this.link(scope,data.operations,pair.debit.id,pair.credit.id,true);
      count++;
    }
    return { linked:count };
  }
}
module.exports = { TransferLinks, validatePair };
