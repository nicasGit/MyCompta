const path = require('node:path');
function runtimeConfig(env = process.env) {
  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT invalide.');
  const multiUser = env.MULTI_USER === 'true';
  const url = new URL(env.APP_URL || `http://localhost:${port}`);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('APP_URL doit être une URL racine, sans chemin ni identifiants.');
  if (multiUser && url.protocol !== 'https:' && !loopback) throw new Error('Une URL HTTPS est nécessaire hors localhost.');
  const host = env.LISTEN_HOST || '127.0.0.1';
  if (!multiUser && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Activez MULTI_USER avant une écoute réseau.');
  return { port, host, multiUser, origin: url.origin, secure: url.protocol === 'https:', hostname: url.hostname,
    ownerEmail: (env.OWNER_EMAIL || '').trim().toLowerCase(), directory: env.DATA_DIR || path.join(__dirname, '..', 'data') };
}
module.exports = { runtimeConfig };
