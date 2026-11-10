const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { prepareAddon } = require('../haos/prepare');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mycompta-addon-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const entries = {
    'app.js': 'module.exports = {};', 'server.js': 'require("./app");', 'package.json': '{}', 'package-lock.json': '{}',
    'google/store.js': 'module.exports = {};', 'services/config.js': 'module.exports = {};', 'parsers/cembra.js': 'module.exports = {};',
    'public/index.html': '<h1>MyCompta</h1>', 'public/style.css': 'body {}', 'public/app.js': 'void 0;',
    '.env': 'SECRET=private', 'data/token.json': '{"secret":"private"}', 'google/service-account.json': '{"private_key":"private"}',
    'node_modules/private.js': 'private', 'public/private.json': '{"secret":"private"}',
  };
  for (const [name, content] of Object.entries(entries)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
  return root;
}
test('HAOS preparation stages runtime files and excludes secrets, private data and dependencies', async t => {
  const root = await fixture(t);
  const { target, files } = await prepareAddon(root);
  assert.equal(files.length, 10);
  for (const name of files) assert.equal(await fs.readFile(path.join(target, name), 'utf8'), await fs.readFile(path.join(root, name), 'utf8'));
  for (const name of ['.env', 'data/token.json', 'google/service-account.json', 'node_modules/private.js', 'public/private.json']) await assert.rejects(() => fs.stat(path.join(target, name)), { code: 'ENOENT' });
  await fs.writeFile(path.join(target, 'public', 'obsolete.js'), 'obsolete');
  await fs.writeFile(path.join(root, 'public', 'style.css'), 'body { color: blue; }');
  await prepareAddon(root);
  assert.equal(await fs.readFile(path.join(target, 'public', 'style.css'), 'utf8'), 'body { color: blue; }');
  await assert.rejects(() => fs.stat(path.join(target, 'public', 'obsolete.js')), { code: 'ENOENT' });
});
test('preparation does not replace an existing directory without its generated marker', async t => {
  const root = await fixture(t);
  const target = path.join(root, 'haos', 'mycompta', 'app');
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, 'keep.txt'), 'keep');
  await assert.rejects(() => prepareAddon(root), /sans marqueur/);
  assert.equal(await fs.readFile(path.join(target, 'keep.txt'), 'utf8'), 'keep');
});
