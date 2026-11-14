const {test}=require('node:test');
const assert=require('node:assert/strict');
const {GoogleStore,TABLES}=require('../google/store');
test('holder icons and labels persist independently of bank accounts and match normalized holder names',async()=>{
  const tables=Object.fromEntries(Object.entries(TABLES).map(([table,columns])=>[table,[[...columns]]]));
  const account={id:'UBS 243-557006.40Y',name:'Compte Commun',holder:'Nicolas Jollois',kind:'current',currency:'CHF'};
  tables.Comptes.push(TABLES.Comptes.map(key=>account[key]||''));
  const store=new GoogleStore({env:{}}),calls=[];
  store.context=async()=>({base:'https://sheets.test'});store.ensureSuppliers=async()=>{};
  store.request=async()=>({valueRanges:Object.keys(TABLES).map(table=>({values:structuredClone(tables[table])}))});
  store.json=async(url,method,body)=>{
    calls.push({url,method});
    assert.ok(url.includes('valueInputOption=RAW'));
    if(url.includes(':append'))tables.Comptes.push(body.values[0]);
    else tables.Comptes[Number(/Comptes!A(\d+)/.exec(url)[1])-1]=body.values[0];
  };
  await store.saveHolder({holder:' Nicolas   Jollois ',name:'Nico',icon:'🦊'});
  let data=await store.read();
  assert.equal(data.holders.length,1);assert.equal(data.holders[0].icon,'🦊');assert.equal(data.holders[0].name,'Nico');
  assert.equal(data.accounts.length,1);assert.equal(data.accounts[0].name,'Compte Commun');
  const id=data.holders[0].id;
  await store.saveHolder({holder:'NICOLAS JOLLOIS',name:'Nicolas',icon:'👨'});
  data=await store.read();assert.equal(data.holders.length,1);assert.equal(data.holders[0].id,id);assert.equal(data.holders[0].icon,'👨');
  assert.equal(calls[1].method,'PUT');
  await assert.rejects(()=>store.saveHolder({holder:'Nicolas',name:'',icon:'👨'}),error=>error.status===400);
  await assert.rejects(()=>store.saveHolder({holder:'Nicolas',name:'Nico',icon:'<script>'}),error=>error.status===400);
});
