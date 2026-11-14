const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {once}=require('node:events');
const {ImportInbox}=require('../services/import-inbox');
const {detectSource}=require('../services/detect-source');
const {markSavings}=require('../services/savings');
const {summarize}=require('../services/operations');
const {aggregate}=require('../public/annual-data');
const {calculate}=require('../public/operation-totals');
const {categorizeOperation}=require('../services/suppliers');
const {GoogleStore}=require('../google/store');
const {createApp}=require('../app');
function pdf(text){
  const stream=Array.isArray(text)?text.map(item=>`BT /F1 7 Tf ${item.x} ${item.y} Td (${item.text}) Tj ET`).join('\n'):`BT /F1 12 Tf 40 750 Td (${text}) Tj ET`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let result='%PDF-1.4\n';const offsets=[];
  objects[3]=objects[3].replace('/Helvetica','/Courier');
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(result));result+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const start=Buffer.byteLength(result);
  result+=`xref\n0 6\n0000000000 65535 f \n${offsets.map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(result);
}
test('issuer detection gives bank statement headers precedence over card beneficiaries',async()=>{
  assert.equal(await detectSource(pdf('UBS Switzerland AG No de compte Releve de compte Cembra Money Bank')),'UBS');
  assert.equal(await detectSource(pdf('PostFinance SA Extrait de compte UBS Switzerland AG')),'PostFinance');
  assert.equal(await detectSource(pdf('TopCard Service SA')),'TopCard');
  assert.equal(await detectSource(pdf('Cembra Money Bank')),'Cembra');
  await assert.rejects(()=>detectSource(pdf('Unknown bank')),error=>error.status===422);
});
test('import inbox persists original PDFs and diagnostics, deduplicates and removes only its own files',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mycompta-inbox-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  let inbox=new ImportInbox(directory);const buffer=pdf('Test');
  const error=Object.assign(new Error('Erreur ligne'),{diagnostics:{issues:[{page:3,raw:'ligne'}]}});
  const first=await inbox.save(buffer,{name:'Test.pdf',source:'UBS'},error);
  inbox=new ImportInbox(directory);
  assert.deepEqual((await inbox.get(first.id)).buffer,buffer);
  assert.equal((await inbox.list())[0].diagnostics.issues[0].page,3);
  assert.equal((await inbox.save(buffer,{name:'Again.pdf',source:'UBS'},error)).id,first.id);
  assert.equal((await inbox.list()).length,1);
  await assert.rejects(()=>inbox.get('../private'),error=>error.status===404);
  await inbox.remove(first.id);assert.equal((await inbox.list()).length,0);
  await assert.rejects(()=>inbox.get(first.id),error=>error.status===404);
});
test('failed automatic import is retained without financial rows and can be retried with a chosen source',async t=>{
  const data={documents:[],operations:[],suppliers:[],accounts:[],categories:[],budgets:[]};let uploads=0;
  const store={read:async()=>structuredClone(data),status:async()=>({connected:true,ready:true}),uploadPdf:async()=>({id:'drive-'+(++uploads)}),appendImport:async(doc,rows)=>{data.documents.push(doc);data.operations.push(...rows);}};
  const server=createApp(store).listen(0,'127.0.0.1');t.after(()=>{server.closeAllConnections();server.close();});await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const headers={'X-MyCompta':'1','Content-Type':'application/pdf'},buffer=pdf('02.11.2026 Migros 42.30 CHF');
  let response=await fetch(base+'/api/documents?source=Auto&name=unknown.pdf',{method:'POST',headers,body:buffer});
  assert.equal(response.status,422);const failure=await response.json();assert.ok(failure.inboxId);
  assert.equal(data.operations.length,0);assert.equal(uploads,0);
  assert.equal((await(await fetch(base+'/api/import-inbox')).json()).items.length,1);
  response=await fetch(base+'/api/import-inbox/'+failure.inboxId+'/pdf');assert.deepEqual(Buffer.from(await response.arrayBuffer()),buffer);
  response=await fetch(base+'/api/import-inbox/'+failure.inboxId+'/retry',{method:'POST',headers:{'X-MyCompta':'1','Content-Type':'application/json'},body:JSON.stringify({source:'Autre'})});
  assert.equal(response.status,200);assert.equal((await response.json()).count,1);assert.equal(uploads,1);
  assert.equal((await(await fetch(base+'/api/import-inbox')).json()).items.length,0);
  response=await fetch(base+'/api/documents?source=UBS',{method:'POST',headers,body:pdf('UBS non reconnu')});
  const second=await response.json();assert.ok(second.inboxId);
  assert.equal((await fetch(base+'/api/import-inbox/'+second.inboxId,{method:'DELETE'})).status,403);
  assert.equal((await fetch(base+'/api/import-inbox/'+second.inboxId,{method:'DELETE',headers:{'X-MyCompta':'1'}})).status,200);
});
test('savings account and its counterpart leave budgets without counting both transfer legs',()=>{
  const accounts=[{id:'UBS 243-557006.M1V',kind:'savings',name:'Épargne famille'}];
  const base={date:'2026-01-10',amount:250,currency:'CHF',category:'Autres',type:'expense',status:'validated',bankDirection:'debit'};
  const marked=markSavings([
    {...base,id:'out',account:'PostFinance current',raw:'CH46 0024 3243 5570 06M1 V'},
    {...base,id:'in',account:accounts[0].id,bankDirection:'credit',type:'income'},
    {...base,id:'shop',account:'PostFinance current',raw:'Marchand'},
  ],accounts);
  assert.deepEqual(marked.map(operation=>operation.isSavings),[true,true,false]);
  assert.equal(marked[0].savingsAccount,accounts[0].id);
  assert.deepEqual(summarize(marked,'2026-01').totals,{CHF:250});
  assert.equal(aggregate(marked,2026,'CHF')[0].total,250);
  assert.equal(calculate(marked)[0].expenses,250);
  const savings={...marked[1],type:'expense',label:'Coop',category:'À catégoriser'};
  assert.equal(categorizeOperation(savings,[{name:'Coop',category:'Alimentation'}],true).category,'À catégoriser');
  assert.ok(markSavings(marked,[]).every(operation=>!operation.isSavings));
  assert.equal(markSavings([{...base,account:'UBS 243-557006.40Y',raw:'Virement sur 243-557006.M1V'}],accounts)[0].isSavings,true);
});
test('correcting an inbox UBS line preserves the PDF and pending edits until totals agree',async t=>{
  const item=(text,x,y)=>({text,x,y});
  const rows=[item('No de compte 243-557006.40Y',40,750),item('Compte CHF',40,730),item('01.12.2025 - 31.12.2025 / Mensuelle',40,710),item('Total debits 250.00',40,690),item('Total credits 0.00',40,670),
    ...['Date','Informations','Debits','Credits','Valeur','Solde de compte'].map((text,i)=>item(text,[40,85,302,384,440,482][i],600)),
    item('01.12.2025',40,450),item('ACHAT',110,450),item('250.00',302,450),item('250.00',388.2,450),item('01.12.2025',440,450),item('1000.00',515.6,450)];
  const buffer=pdf(rows);
  const data={documents:[],operations:[],suppliers:[],accounts:[],categories:[],budgets:[]};let uploaded;
  const store={read:async()=>structuredClone(data),status:async()=>({connected:true,ready:true}),uploadPdf:async bytes=>{uploaded=bytes;return {id:'pdf'};},renamePdf:async()=>{},appendImport:async(doc,ops)=>{data.documents.push(doc);data.operations.push(...ops);}};
  const server=createApp(store).listen(0,'127.0.0.1');t.after(()=>{server.closeAllConnections();server.close();});await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  let response=await fetch(base+'/api/documents?source=UBS',{method:'POST',headers:{'X-MyCompta':'1','Content-Type':'application/pdf'},body:buffer});
  assert.equal(response.status,422);const failure=await response.json();assert.ok(failure.diagnostics.issues.length,JSON.stringify(failure.diagnostics));
  const patch={rowId:failure.diagnostics.issues[0].rowId,bankDirection:'debit',amount:249};
  const retry=()=>fetch(base+'/api/import-inbox/'+failure.inboxId+'/retry',{method:'POST',headers:{'X-MyCompta':'1','Content-Type':'application/json'},body:JSON.stringify({source:'UBS',corrections:[patch]})});
  response=await retry();assert.equal(response.status,422);assert.equal(data.operations.length,0);assert.equal(uploaded,undefined);
  const pending=(await(await fetch(base+'/api/import-inbox')).json()).items[0];assert.equal(pending.corrections[0].amount,249);
  assert.deepEqual(Buffer.from(await(await fetch(base+'/api/import-inbox/'+failure.inboxId+'/pdf')).arrayBuffer()),buffer);
  patch.amount=250;response=await retry();assert.equal(response.status,200);assert.equal(data.operations.length,1);
  assert.deepEqual(uploaded,buffer);assert.match(data.operations[0].raw,/Correction manuelle/);
  assert.equal((await(await fetch(base+'/api/import-inbox')).json()).items.length,0);
  data.documents.length=0;data.operations.length=0;
  store.uploadPdf=async()=>{throw Object.assign(new Error('Drive indisponible'),{status:502});};
  response=await fetch(base+'/api/documents?source=UBS',{method:'POST',headers:{'X-MyCompta':'1','Content-Type':'application/pdf'},body:pdf(rows.filter(row=>row.x!==388.2))});
  assert.equal(response.status,502);
  const refreshed=(await(await fetch(base+'/api/import-inbox')).json()).items[0];
  assert.equal(refreshed.diagnostics.rows.length,1);assert.equal(refreshed.diagnostics.rows[0].values.amount,250);
  assert.equal(refreshed.error,'Drive indisponible');assert.equal(data.operations.length,0);
});
test('account labels and savings usage persist without requiring a holder override',async()=>{
  const store=new GoogleStore({env:{}});store.read=async()=>({accounts:[]});
  let row;store.writeRow=async(table,value)=>{assert.equal(table,'Comptes');row=value;return value;};
  await store.saveAccount({id:'UBS 243-557006.M1V',name:'Épargne vacances',holder:'',kind:'savings'});
  assert.equal(row.kind,'savings');assert.equal(row.name,'Épargne vacances');
  await assert.rejects(()=>store.saveAccount({id:'client:243-557006',holder:'',kind:'savings'}),error=>error.status===400);
});
