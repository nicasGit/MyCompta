const fs = require('node:fs');
const path = require('node:path');
function configureAddon(env = process.env, read = fs.readFileSync) {
  const directory = env.DATA_DIR || '/data';
  const options = JSON.parse(read(path.join(directory, 'options.json'), 'utf8'));
  const mapping = { app_url: 'APP_URL', owner_email: 'OWNER_EMAIL', google_client_id: 'GOOGLE_CLIENT_ID', google_client_secret: 'GOOGLE_CLIENT_SECRET' };
  for (const [key, variable] of Object.entries(mapping)) {
    if (typeof options[key] !== 'string' || !options[key].trim()) throw new Error(`Option obligatoire de l’add-on : ${key}`);
    env[variable] = options[key].trim();
  }
  env.DATA_DIR = directory; env.PORT = '3001'; env.LISTEN_HOST = '0.0.0.0'; env.MULTI_USER = 'true';
}
if (require.main === module) {
  try { configureAddon(); require('./app').start(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { configureAddon };
