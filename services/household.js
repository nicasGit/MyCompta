const crypto = require('node:crypto');
const reject = (message, status = 403) => Object.assign(new Error(message), { status });
const emailKey = value => String(value || '').trim().toLowerCase();
class Household {
  constructor(store, ownerEmail) { this.store = store; this.ownerEmail = emailKey(ownerEmail); }
  async registry() {
    const saved = await this.store.load('household');
    if (saved.owner) return saved;
    const token = await this.store.load('token');
    return { owner: token.user?.id ? { ...token.user, role: 'owner' } : null, members: [] };
  }
  async login(user) {
    const registry = await this.registry();
    if (!registry.owner) {
      const resources = await this.store.load('resources');
      if (!this.ownerEmail || emailKey(user.email) !== this.ownerEmail || (resources.ownerId && resources.ownerId !== user.id)) throw reject('Ce compte ne peut pas créer le foyer. Vérifiez OWNER_EMAIL.');
      registry.owner = { ...user, role: 'owner' };
    }
    let principal;
    if (registry.owner.id === user.id) {
      registry.owner = { ...registry.owner, ...user, role: 'owner' };
      principal = registry.owner;
    } else {
      const member = registry.members.find(m => m.googleId === user.id || (!m.googleId && emailKey(m.email) === emailKey(user.email)));
      if (!member) throw reject('Ce compte n’est pas membre du foyer. Demandez au propriétaire de vous ajouter.');
      member.googleId = user.id; member.name = user.name; member.email = user.email;
      principal = { ...user, role: 'member', memberId: member.id };
    }
    await this.store.save('household', registry);
    const session = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(session).digest('hex');
    const sessions = await this.store.load('sessions');
    for (const [key, entry] of Object.entries(sessions)) if (entry.expires < Date.now()) delete sessions[key];
    if (Object.keys(sessions).length >= 500) throw reject('Trop de sessions ouvertes. Réessayez plus tard.', 429);
    sessions[hash] = { userId: user.id, expires: Date.now() + 30 * 86400000 };
    await this.store.save('sessions', sessions);
    return { session, user: principal };
  }
  async authenticate(session) {
    if (!/^[a-f0-9]{64}$/.test(session || '')) return null;
    const hash = crypto.createHash('sha256').update(session).digest('hex');
    const sessions = await this.store.load('sessions');
    const entry = sessions[hash];
    if (!entry || entry.expires <= Date.now()) return null;
    const registry = await this.registry();
    if (registry.owner?.id === entry.userId) return registry.owner;
    const member = registry.members.find(m => m.googleId === entry.userId);
    return member ? { id: member.googleId, memberId: member.id, email: member.email, name: member.name, role: 'member' } : null;
  }
  async logout(session) {
    if (!/^[a-f0-9]{64}$/.test(session || '')) return;
    const sessions = await this.store.load('sessions');
    delete sessions[crypto.createHash('sha256').update(session).digest('hex')];
    await this.store.save('sessions', sessions);
  }
  async list() {
    const registry = await this.registry();
    return { owner: registry.owner ? { name: registry.owner.name, email: registry.owner.email } : null,
      members: registry.members.map(m => ({ id: m.id, email: m.email, name: m.name || '', status: m.googleId ? 'active' : 'invited' })) };
  }
  async add(email) {
    email = emailKey(email);
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw reject('Adresse e-mail invalide.', 400);
    const registry = await this.registry();
    if (!registry.owner) throw reject('Connectez le propriétaire avant d’ajouter un membre.', 409);
    if (emailKey(registry.owner.email) === email || registry.members.some(m => emailKey(m.email) === email)) throw reject('Cette personne appartient déjà au foyer.', 409);
    if (registry.members.length >= 20) throw reject('Le foyer accepte au maximum 20 membres.', 400);
    registry.members.push({ id: crypto.randomUUID(), email });
    await this.store.save('household', registry);
    return this.list();
  }
  async remove(id) {
    const registry = await this.registry();
    if (!registry.members.some(m => m.id === id)) throw reject('Membre introuvable.', 404);
    registry.members = registry.members.filter(m => m.id !== id);
    await this.store.save('household', registry);
    return this.list();
  }
}
module.exports = { Household };
