const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {TransferLinks,validatePair}=require('../services/transfer-links');
const {buildReconciliation}=require('../services/bank-reconciliation');
const debit={id:'out',date:'2026-10-31',account:'UBS',type:'transfer',bankDirection:'debit',amount:100,currency:'CHF',status:'validated'};
const credit={...debit,id:'in',date:'2026-11-02',account:'PostFinance',bankDirection:'credit'};
test('transfer links persist per workspace, prevent reuse, and can be removed without altering operations',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mycompta-links-test-'));
 try{
  const store=new TransferLinks(dir),operations=[debit,credit,{...credit,id:'other'}];
  const before=JSON.stringify(operations);
  const link=await store.link('sheet-one',operations,'out','in');
  assert.equal((await new TransferLinks(dir).read('sheet-one'))[0].id,link.id);
  assert.deepEqual(await store.read('sheet-two'),[]);
  assert.equal((await store.link('sheet-one',operations,'out','in')).id,link.id);
  await assert.rejects(()=>store.link('sheet-one',operations,'out','other'),/li/);
  assert.equal(JSON.stringify(operations),before);
  await store.unlink('sheet-one',link.id);
  assert.deepEqual(await store.read('sheet-one'),[]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('incompatible transfers cannot be linked and confirmed pairs leave the suggestions',()=>{
 for(const change of [{currency:'EUR'},{amount:101},{account:'UBS'},{bankDirection:'debit'},{status:'ignored'},{type:'expense'},{date:'2026-11-12'}]){
  assert.throws(()=>validatePair([debit,{...credit,...change}],'out','in'),/compatible/);
 }
 const data={operations:[debit,credit],transferLinks:[{id:'link',debitId:'out',creditId:'in'}]};
 const result=buildReconciliation(data,'2026-10','2026-10');
 assert.equal(result.linked.length,1);
 assert.equal(result.pairs.length,0);
 assert.equal(result.unmatched.length,0);
 assert.equal(buildReconciliation(data,'2026-11','2026-11').linked.length,1);
 const changed=buildReconciliation({...data,operations:[debit,{...credit,amount:99}]},'2026-10','2026-11');
 assert.equal(changed.linked.length,0);
});

test('transfer API saves, lists and removes links with normal mutation protections',async t=>{
 const {createApp}=require('../app');
 const {once}=require('node:events');
 const store={status:async()=>({connected:true,ready:true}),context:async()=>({base:'https://sheets.example/transfers'}),read:async()=>({operations:[debit,credit],documents:[],accounts:[]})};
 const server=createApp(store).listen(0,'127.0.0.1');
 t.after(()=>{server.closeAllConnections();server.close();});await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 const headers={'X-MyCompta':'1','Content-Type':'application/json'};
 const body=JSON.stringify({debitId:'out',creditId:'in'});
 assert.equal((await fetch(base+'/api/transfer-links',{method:'POST',headers:{'Content-Type':'application/json'},body})).status,403);
 let response=await fetch(base+'/api/transfer-links',{method:'POST',headers,body});
 assert.equal(response.status,200);const link=await response.json();
 const result=await (await fetch(base+'/api/reconciliation?start=2026-10&end=2026-11')).json();
 assert.equal(result.linked.length,1);assert.equal(result.pairs.length,0);
 assert.equal((await fetch(base+'/api/transfer-links/'+link.id,{method:'DELETE',headers})).status,200);
 const after=await (await fetch(base+'/api/reconciliation?start=2026-10&end=2026-11')).json();
 assert.equal(after.linked.length,0);assert.equal(after.pairs.length,1);
});

test('automatic links only match whole-amount PostFinance transfers to named accounts and respect unlinking',async()=>{
 const store=new TransferLinks(null),scope='auto';
 const accounts=[{id:'UBS',source:'PostFinance'},{id:'PostFinance',name:'Courant Nico'}];
 const data={operations:[debit,credit],accounts};
 assert.equal((await store.autoLink(scope,data)).linked,1);
 const links=await store.read(scope);assert.equal(links[0].automatic,true);
 assert.equal((await store.autoLink(scope,data)).linked,0);
 await store.unlink(scope,links[0].id);
 assert.equal((await store.autoLink(scope,data)).linked,0);
 assert.equal(buildReconciliation({...data,transferLinks:await store.read(scope)},'2026-10','2026-11').pairs.length,1);
 await store.link(scope,data.operations,'out','in');
 assert.equal((await store.read(scope)).filter(item=>!item.blocked).length,1);
 for(const name of ['Commun','Courant Nico']){
  assert.equal((await store.autoLink('name-'+name,{...data,accounts:[accounts[0],{id:'PostFinance',name}]})).linked,1);
 }
 assert.equal((await store.autoLink('other',{...data,accounts:[accounts[0],{id:'PostFinance',name:'Vacances'}]})).linked,0);
 assert.equal((await store.autoLink('fraction',{...data,operations:[{...debit,amount:100.50},{...credit,amount:100.50}]})).linked,0);
 assert.equal((await store.autoLink('ambiguous',{...data,operations:[debit,credit,{...credit,id:'duplicate'}]})).linked,0);
 assert.equal((await store.autoLink('reverse',{...data,operations:[{...debit,bankDirection:'credit'},{...credit,bankDirection:'debit'}]})).linked,0);
});
