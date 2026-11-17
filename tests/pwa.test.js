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
    self, URL, Response, importScripts:()=>{}, fetch: async () => { throw new Error('Offline'); }
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

test('Android manifest registers PDFs as a multipart POST share target',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/manifest.webmanifest'),'utf8'));
 assert.equal(manifest.share_target.action,'/share-pdf');
 assert.equal(manifest.share_target.method,'POST');
 assert.equal(manifest.share_target.enctype,'multipart/form-data');
 assert.deepEqual(manifest.share_target.params.files,[{name:'pdf',accept:['application/pdf','.pdf']}]);
});
test('shared PDFs accept real PDFs and reject wrong content, oversize and excessive batches',async()=>{
 const {validate}=require('../public/shared-files');
 const pdf=new File(['%PDF-1.4\n test'],'releve.pdf',{type:'application/pdf'});
 assert.deepEqual(await validate([pdf]),[pdf]);
 await assert.rejects(()=>validate([]));
 await assert.rejects(()=>validate(Array(21).fill(pdf)));
 await assert.rejects(()=>validate([new File(['not a PDF'],'bad.pdf',{type:'application/pdf'})]));
 await assert.rejects(()=>validate([new File(['%PDF-1.4'],'bad.txt',{type:'text/plain'})]));
 await assert.rejects(()=>validate([{name:'big.pdf',type:'application/pdf',size:16*1024*1024,slice:()=>new Blob(['%PDF-'])}]));
});
test('share worker stages files and redirects without uploading or intercepting other POSTs',async()=>{
 const listeners={};let stored,fail=false;
 const self={location:{origin:'https://compta.example'},addEventListener:(name,fn)=>listeners[name]=fn};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/service-worker.js'),'utf8'),{
   self,URL,Response,encodeURIComponent,importScripts:()=>{},MyComptaSharedFiles:{save:async files=>{if(fail)throw Error('quota');stored=files;return 'share-id';}}
 });
 const pdf=new File(['%PDF-1.4'],'statement.pdf',{type:'application/pdf'}),form=new FormData();form.append('pdf',pdf);
 let result;listeners.fetch({request:new Request('https://compta.example/share-pdf',{method:'POST',body:form}),respondWith:value=>result=value});
 let response=await result;assert.equal(response.status,303);assert.equal(response.headers.get('location'),'https://compta.example/?shared=share-id');assert.equal(stored[0].name,'statement.pdf');
 fail=true;listeners.fetch({request:new Request('https://compta.example/share-pdf',{method:'POST',body:form}),respondWith:value=>result=value});
 response=await result;assert.equal(response.headers.get('location'),'https://compta.example/?share-error=invalid');
 for(const url of ['https://other.example/share-pdf','https://compta.example/api/documents'])listeners.fetch({request:{url,method:'POST'},respondWith:()=>assert.fail('Unexpected interception')});
});
