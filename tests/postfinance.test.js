const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const {parsePostFinancePages,extractPostFinance}=require('../parsers/postfinance');
const {extractPdf}=require('../services/pdf');
const {createApp}=require('../app');
const {reconcileImport}=require('../services/operations');
const {mergeBankStatement}=require('../services/bank-import');
const {buildReconciliation}=require('../services/bank-reconciliation');
const iban='CH7409000000107451825';
const item=(text,x,y)=>({text,x,y,width:text.length*4});
const header=y=>['Date','Texte','Crédit','Débit','Valeur','Solde'].map((t,i)=>item(t,[65,119,328,411,460,540][i],y));
function fixture(){
  return [{num:1,items:[item('Extrait de compte 01.01.2026 - 31.01.2026',62,800),item('IBAN '+iban+' CHF',305,780),
    item('Monsieur',300,740),item('Nicolas Christian Jollois',300,725),...header(700),
    item('31.12.25',65,675),item('Etat de compte',119,675),item('1 000.00',520,675),
    item('30.01.26',65,650),item('DÉBIT',119,650),item('100.00',390,650),item('30.01.26',460,650),
    item('CH660024324355807940X',119,635),item('JOLLOIS NICOLAS',119,620)]},
    {num:2,items:[...header(730),item('CRÉDIT',119,700),item('25.00',328,700),item('30.01.26',460,700),item('925.00',520,700),
    item('DONNEUR D’ORDRE: UNE AUTRE PERSONNE',119,685),
    item('Total',119,600),item('25.00',328,600),item('100.00',390,600),
    item('31.01.26',65,580),item('Etat de compte',119,580),item('925.00',520,580)]}];
}
test('PostFinance carries dates across pages and reconstructs balances between printed checkpoints',()=>{
  const result=parsePostFinancePages(fixture());
  assert.equal(result.operations.length,2);
  assert.equal(result.operations[1].date,'2026-01-30');
  assert.deepEqual(result.operations.map(o=>o.bankBalance),['900','925']);
  assert.deepEqual(result.operations.map(o=>o.bankDirection),['debit','credit']);
  assert.deepEqual(result.operations.map(o=>o.type),['transfer','income']);
  assert.equal(result.accountId,'PostFinance '+iban);
  assert.equal(result.holder,'Nicolas Christian Jollois');
  assert.equal(result.statementMonth,'2026-01');
  assert.equal(result.debitTotal,100);assert.equal(result.creditTotal,25);
  const duplicate=mergeBankStatement(result.operations,result);
  assert.equal(duplicate.operations.length,0);assert.equal(duplicate.report.matched,2);
});
test('PostFinance refuses ambiguous directions, invalid dates, missing totals and inconsistent balances',()=>{
  for(const change of [
    pages=>pages[0].items.push(item('100.00',328,650)),
    pages=>pages[0].items.find(i=>i.text==='30.01.26'&&i.x===65).text='31.02.26',
    pages=>pages[1].items.find(i=>i.text==='925.00').text='926.00',
    pages=>pages[1].items.find(i=>i.text==='100.00').text='101.00',
    pages=>pages[1].items=pages[1].items.filter(i=>i.y!==600),
    pages=>pages[0].items=pages[0].items.filter(i=>i.y!==675),
    pages=>pages[1].items=pages[1].items.filter(i=>i.y!==580)
  ]){
    const pages=fixture();change(pages);assert.throws(()=>parsePostFinancePages(pages),error=>error.status===422);
  }
});
test('PostFinance ignores annex pages when totals agree and requires explicit approval for partial import otherwise',()=>{
  const annex=fixture();annex.push({num:3,items:[item('Informations générales',62,700)]});
  let result=parsePostFinancePages(annex);
  assert.equal(result.operations.length,2);assert.equal(result.partial,false);assert.deepEqual(result.ignoredPages,[3]);
  const incomplete=fixture();incomplete[1].items=incomplete[1].items.filter(item=>item.y!==730);
  assert.throws(()=>parsePostFinancePages(incomplete),error=>error.status===422&&error.diagnostics.canImportPartial&&error.diagnostics.detectedCount===1);
  result=parsePostFinancePages(incomplete,{allowPartial:true});
  assert.equal(result.operations.length,1);assert.equal(result.partial,true);assert.match(result.note,/IMPORT PARTIEL/);assert.deepEqual(result.ignoredPages,[2]);
  incomplete[0].items.push(item('100.00',328,650));
  assert.throws(()=>parsePostFinancePages(incomplete,{allowPartial:true}),error=>error.status===422);
});
test('PostFinance does not exclude third-party transfers solely because their reference says TRANSFERT',()=>{
  const pages=fixture();pages[0].items.find(i=>i.text==='JOLLOIS NICOLAS').text='JOLLOIS BAPTISTE';
  pages[0].items.push(item('TRANSFERT BAPTISTE',119,605));
  assert.equal(parsePostFinancePages(pages).operations[0].type,'expense');
  assert.equal(parsePostFinancePages(pages,{accounts:[{id:'UBS 243-558079.40X'}]}).operations[0].type,'transfer');
  assert.equal(parsePostFinancePages(pages,{accounts:[{id:'UBS 243-557006.40Y'}]}).operations[0].type,'expense');
});
test('PostFinance reanalysis recalculates transfer classification while preserving category and exclusion',()=>{
  const incoming=parsePostFinancePages(fixture()).operations[0];
  const old={...incoming,id:'old',type:'expense',category:'Loisirs',status:'ignored'};
  const updated=reconcileImport([incoming],[old])[0];
  assert.equal(updated.type,'transfer');assert.equal(updated.id,'old');assert.equal(updated.category,'Loisirs');assert.equal(updated.status,'ignored');
});
test('PostFinance recognizes card settlements independently from internal transfers',()=>{
  for(const [label,network] of [['CEMBRA MONEY BANK','Cembra'],['CUMULUS','Cembra'],['TOPCARD SERVICE SA','TopCard'],['SUPERCARD','TopCard']]){
    const pages=fixture();pages[0].items.push(item(label,119,605));
    const operation=parsePostFinancePages(pages).operations[0];
    assert.equal(operation.type,'card_payment');assert.equal(operation.paymentNetwork,network);
  }
});
test('provided PostFinance PDF imports all movements, checks totals and matches a UBS counterpart',async t=>{
  const file=path.join(__dirname,'../aCharger/Documents_20261114_1/REP_P_CH7409000000107451825_1105589735_0_2026020104312755.pdf');
  let buffer;try{buffer=await fs.readFile(file);}catch(error){if(error.code==='ENOENT'){t.skip('Private sample absent');return;}throw error;}
  const result=await extractPostFinance(buffer,{documents:[{accountId:'UBS 243-557006.40Y'}]});
  assert.equal(result.operations.length,15);assert.equal(result.debitTotal,14140.86);assert.equal(result.creditTotal,9455.30);
  assert.equal(result.operations[13].date,'2026-01-30');assert.equal(result.operations[14].bankBalance,'5418.46');
  assert.equal(result.operations.find(o=>o.amount===80.26).currency,'CHF');
  assert.match(result.operations.find(o=>o.amount===80.26).raw,/EUR 86.00/);
  assert.equal(result.operations.find(o=>o.amount===3100).type,'transfer');
  assert.equal(result.operations[0].type,'expense');
  const data={documents:[{id:'ubs',source:'UBS',accountId:'UBS 243-557006.40Y'}],operations:[],accounts:[],categories:[],suppliers:[],budgets:[]};
  let uploads=0,replaced;
  const store={status:async()=>({connected:true,ready:true}),read:async()=>structuredClone(data),
    uploadPdf:async()=>({id:'drive-'+(++uploads)}),renamePdf:async()=>{},downloadPdf:async()=>buffer,
    appendImport:async(doc,ops)=>{data.documents.push(doc);data.operations.push(...ops);},
    replaceImport:async(doc,ops)=>{replaced={doc,ops};}};
  const server=createApp(store).listen(0,'127.0.0.1');t.after(()=>{server.closeAllConnections();server.close();});await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port,headers={'X-MyCompta':'1','Content-Type':'application/pdf'};
  let response=await fetch(base+'/api/documents?source=PostFinance',{method:'POST',headers,body:buffer});
  assert.equal(response.status,201);const imported=await response.json();assert.equal(imported.count,15);
  assert.equal(imported.document.statementMonth,'2026-01');assert.equal(imported.document.accountId,'PostFinance '+iban);
  response=await fetch(base+'/api/documents?source=PostFinance',{method:'POST',headers,body:Buffer.concat([buffer,Buffer.from('\n% different export')])});
  assert.equal(response.status,200);assert.equal((await response.json()).duplicateReason,'content');assert.equal(uploads,1);
  response=await fetch(base+'/api/documents/'+imported.document.id+'/reanalyse',{method:'POST',headers:{'X-MyCompta':'1'}});
  assert.equal(response.status,200);assert.equal(replaced.ops.length,15);assert.equal(uploads,1);
  const payment=data.operations.find(o=>o.amount===3100);
  const matching={...payment,id:'ubs-credit',account:'UBS 243-557006.40Y',bankDirection:'credit',documentId:'ubs'};
  const reconciliation=buildReconciliation({...data,operations:[payment,matching]},'2026-01','2026-01');
  assert.equal(reconciliation.pairs.length,1);assert.equal(reconciliation.unmatched.length,0);
  await assert.rejects(()=>extractPdf(Buffer.from('not a PDF'),'PostFinance'),error=>error.status===400);
});
