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
  async link(scope, operations, debitId, creditId) {
    validatePair(operations, debitId, creditId);
    const links = await this.read(scope);
    const existing = links.find(item => item.debitId === debitId && item.creditId === creditId);
    if (existing) return existing;
    if (links.some(item => [item.debitId, item.creditId].some(id => id === debitId || id === creditId))) {
      throw fail('Une de ces opérations est déjà liée. Dissociez-la avant de changer le lien.');
    }
    const item = { id: crypto.randomUUID(), debitId, creditId, createdAt: new Date().toISOString() };
    await this.write(scope, [...links, item]);
    return item;
  }
  async unlink(scope, id) { await this.write(scope, (await this.read(scope)).filter(item => item.id !== id)); }
}
module.exports = { TransferLinks, validatePair };
