const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('PWA manifest references real PNG icons with correct dimensions', () => {
  const directory = path.join(__dirname, '../public');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  for (const icon of manifest.icons) {
    const png = fs.readFileSync(path.join(directory, icon.src));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});

test('PWA shows a safe offline page without intercepting APIs, PDFs or OAuth', async () => {
  const listeners = {};
  const self = { location: { origin: 'https://compta.example' }, addEventListener: (name, fn) => { listeners[name] = fn; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/service-worker.js'), 'utf8'), {
    self, URL, Response, fetch: async () => { throw new Error('Offline'); }
    // No caches global: any attempt to store data fails this test.
  });
  for (const pathname of ['/api/data', '/api/documents/123/pdf', '/auth/callback?code=secret', '/auth/google']) {
    listeners.fetch({ request: { url: `https://compta.example${pathname}`, mode: 'navigate', method: 'GET' },
      respondWith: () => assert.fail(`Intercepted ${pathname}`) });
  }
  let response;
  listeners.fetch({ request: { url: 'https://compta.example/', mode: 'navigate', method: 'GET' }, respondWith: value => { response = value; } });
  const offline = await response;
  assert.equal(offline.status, 503);
  assert.equal(offline.headers.get('cache-control'), 'no-store');
  assert.match(await offline.text(), /hors connexion/);
});
