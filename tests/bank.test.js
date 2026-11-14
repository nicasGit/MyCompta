const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const {createApp}=require('../app');
const {extractUBS,parseUBSPages}=require('../parsers/ubs');
const {bankKey,mergeUBS}=require('../services/bank-import');
const {buildReconciliation}=require('../services/bank-reconciliation');
const {GoogleStore,TABLES}=require('../google/store');
const {validateOperation,reconcileImport}=require('../services/operations');
const op=patch=>({id:'a',documentId:'monthly',date:'2025-12-01',bookingDate:'2025-12-01',label:'VIREMENT',amount:250,currency:'CHF',account:'UBS 243-557006.40Y',clientNumber:'243-557006',bankDirection:'debit',bankBalance:'1000',type:'transfer',status:'validated',category:'Autres',...patch});
const parsed=operations=>({accountId:op().account,periodStart:'2025-01-01',periodEnd:'2025-12-31',statementKind:'annual',operations,debitTotal:500,creditTotal:0});

function positionedStatement(){
  const item=(text,x,y,width=30)=>({text,x,y,width});
  return [{num:1,items:[
    item('No de compte 243-557006.40Y',40,800),item('No de client 243-557006',40,780),
    item('01.12.2025 - 31.12.2025 / Mensuelle: numéro 12',40,760),item('Compte CHF',40,740),
    item('Total débits 250.00',40,720),item('Total crédits 0.00',40,700),
    item('Date',40,650),item('Informations',85,650),item('Débits',302,650),item('Crédits',384,650),item('Valeur',440,650),item('Solde de compte',482,650,70),
    item('01.12.2025',40,620),item('VIREMENT',85,620),item('250.00',302,620),item('01.12.2025',440,620),item('1000.00',522,620),
    item('Compte destinataire',85,600),item('Mouvement total',85,580)
  ]}];
}

test('UBS positioned parsing retains direction and rejects ambiguous columns or inconsistent summary totals',()=>{
  const pages=positionedStatement(),result=parseUBSPages(pages);
  assert.equal(result.operations.length,1);assert.equal(result.operations[0].bankDirection,'debit');
  assert.equal(result.operations[0].type,'transfer');assert.equal(result.debitTotal,250);
  const bad=structuredClone(pages);bad[0].items.push({text:'250.00',x:384,y:620,width:30});
  assert.throws(()=>parseUBSPages(bad),error=>error.status===422&&error.diagnostics.issues[0].page===1&&error.diagnostics.issues[0].raw.includes('250.00')&&error.diagnostics.totals.debit.expected===250);
  const inconsistent=structuredClone(pages);inconsistent[0].items.find(item=>item.text.startsWith('Total débits')).text='Total débits 251.00';
  assert.throws(()=>parseUBSPages(inconsistent),error=>error.status===422);
  const missing=structuredClone(pages);missing[0].items=missing[0].items.filter(item=>!item.text.startsWith('Total débits'));
  assert.throws(()=>parseUBSPages(missing),error=>error.status===422);
});

test('bank overlap is a multiset by account, direction, dates, amount and resulting balance',()=>{
  const first=op(),second=op({id:'b',bankBalance:'750'}),third=op({id:'c',bankBalance:'500'});
  const result=mergeUBS([first,second],parsed([first,second,third]));
  assert.deepEqual(result.operations,[third]);
  assert.equal(result.report.matched,2);
  assert.equal(result.report.unmatchedExisting,0);
  assert.equal(mergeUBS([first],parsed([first,first])).operations.length,1);
  assert.equal(mergeUBS([first],parsed([op({account:'UBS 243-557006.M1V'})])).report.matched,0);
  assert.equal(mergeUBS([op({bankDirection:'credit'})],parsed([first])).report.matched,0);
  assert.equal(mergeUBS([op({category:'Loisirs',holder:'Autre titulaire',label:'Corrigé'})],parsed([first])).report.matched,1);
  assert.equal(mergeUBS([first,second],parsed([first])).report.unmatchedExisting,1);
  assert.equal(bankKey(op({bankBalance:undefined})), '');
  assert.equal(bankKey(op({bankBalance:'garbage'})), '');
  assert.notEqual(bankKey(op({bankBalance:'0'})), '');
});
test('UBS trailing minus balances and unreadable balances never block valid debit/credit totals',()=>{
  for(const [text,expected] of [['79.00-','-79'],['79-','-79'],['79.00−','-79'],['illisible','']]){
    const pages=positionedStatement();pages[0].items.find(item=>item.text==='1000.00').text=text;
    const result=parseUBSPages(pages);
    assert.equal(result.operations.length,1);assert.equal(result.operations[0].bankBalance,expected);assert.equal(result.debitTotal,250);
  }
  const missing=positionedStatement();missing[0].items=missing[0].items.filter(item=>item.text!=='1000.00');
  assert.equal(parseUBSPages(missing).operations[0].bankBalance,'');
  missing[0].items.find(item=>item.text.startsWith('Total débits')).text='Total débits 251.00';
  assert.throws(()=>parseUBSPages(missing),error=>error.status===422);
});
test('missing bank balances use a counted fallback without collapsing repeated purchases',()=>{
  const first=op({bankBalance:''}),second=op({id:'b',bankBalance:''});
  assert.equal(mergeUBS([first],parsed([first,second])).report.matched,1);
  assert.equal(mergeUBS([first],parsed([first,second])).operations.length,1);
  assert.equal(mergeUBS([first],parsed([op()])).report.matched,1);
  assert.equal(mergeUBS([op()],parsed([first])).report.matched,1);
  assert.equal(mergeUBS([first],parsed([op({bankBalance:'',label:'Autre achat'})])).report.matched,0);
});

test('manual UBS row corrections repair ambiguity but cannot bypass printed totals or target invented rows',()=>{
  const pages=positionedStatement();pages[0].items.push({text:'250.00',x:384,y:620,width:30});
  let diagnostic;try{parseUBSPages(pages);}catch(error){diagnostic=error.diagnostics;}
  const row=diagnostic.issues[0];assert.ok(row.rowId);assert.equal(row.values.bankBalance,1000);assert.equal(row.values.amount,null);
  const correction={rowId:row.rowId,bankDirection:'debit',amount:250};
  const result=parseUBSPages(pages,{corrections:[correction]});
  assert.equal(result.operations.length,1);assert.equal(result.debitTotal,250);assert.match(result.operations[0].raw,/Correction manuelle/);
  assert.throws(()=>parseUBSPages(pages,{corrections:[{...correction,amount:249}]}),error=>error.status===422&&error.diagnostics.totals.debit.actual===249);
  for(const patch of [{...correction,rowId:'invented'},{...correction,amount:'250'},{...correction,date:'2025-02-30'},{...correction,totals:{debit:0}}]){
    assert.throws(()=>parseUBSPages(pages,{corrections:[patch]}),error=>error.status===400);
  }
  const mismatch=positionedStatement();mismatch[0].items.find(item=>item.text.startsWith('Total débits')).text='Total débits 251.00';
  try{parseUBSPages(mismatch);}catch(error){diagnostic=error.diagnostics;}
  assert.equal(diagnostic.rows[0].values.amount,250);
  assert.equal(parseUBSPages(mismatch,{corrections:[{rowId:diagnostic.rows[0].rowId,amount:251}]}).debitTotal,251);
});

test('annual first and monthly first both retain a single copy of overlapping bank movements',()=>{
  const december=op(),january=op({id:'j',date:'2025-01-03',bankBalance:'2000'});
  const annual=parsed([january,december]);
  const monthly={...annual,periodStart:'2025-12-01',statementKind:'monthly',operations:[december]};
  assert.equal(mergeUBS(annual.operations,monthly).operations.length,0);
  assert.deepEqual(mergeUBS(monthly.operations,annual).operations,[january]);
});

test('transfer proposals require a unique opposite movement, with no cross-currency or reused matches',()=>{
  const debit=op(),credit=op({id:'b',account:'PostFinance Commun',date:'2025-12-03',bankDirection:'credit'});
  let result=buildReconciliation({operations:[debit,credit]},'2025-12','2025-12');
  assert.equal(result.pairs.length,1);assert.equal(result.unmatched.length,0);
  assert.equal(result.pairs[0].credit.account,'PostFinance Commun');
  for(const patch of [{currency:'EUR'},{date:'2025-12-07'},{account:debit.account},{status:'ignored'},{bankDirection:''}]){
    result=buildReconciliation({operations:[debit,{...credit,...patch}]},'2025-12','2025-12');assert.equal(result.pairs.length,0);
  }
  result=buildReconciliation({operations:[debit,credit,{...credit,id:'c'}]},'2025-12','2025-12');
  assert.equal(result.pairs.length,0);assert.equal(result.unmatched.length,3);
});

test('card reconciliation compares bank payments to net purchases by statement month and currency',()=>{
  const result=buildReconciliation({documents:[{id:'card',source:'Cembra',statementMonth:'2025-12'}],operations:[
    op({id:'payment',type:'card_payment',paymentNetwork:'Cembra',amount:90}),
    op({id:'purchase',documentId:'card',date:'2025-11-25',type:'expense',amount:100}),
    op({id:'refund',documentId:'card',type:'income',amount:10}),
    op({id:'settlement',documentId:'card',type:'card_payment',amount:90}),
    op({id:'ignored',documentId:'card',type:'expense',amount:100,status:'ignored'})
  ]},'2025-12','2025-12');
  assert.deepEqual(result.cards[0].totals,[{currency:'CHF',paid:90,billed:90,difference:0,comparable:true}]);
  assert.equal(result.cards[1].totals.length,0);
});

test('UBS annual totals compare monthly statements once even when their movements were already imported',()=>{
  const doc={id:'year',source:'UBS',accountId:op().account,periodStart:'2025-01-01',periodEnd:'2025-12-31',statementKind:'annual',importReport:JSON.stringify({debitTotal:500,creditTotal:50})};
  const month={...doc,id:'month',periodStart:'2025-12-01',statementMonth:'2025-12',statementKind:'monthly',importReport:JSON.stringify({debitTotal:250,creditTotal:0})};
  const result=buildReconciliation({documents:[doc,month,{...month,id:'duplicate'}],operations:[op()]},'2025-01','2025-12');
  assert.equal(result.annual[0].monthlyCount,1);assert.equal(result.annual[0].monthlyDebit,250);
  assert.equal(result.annual[0].missingMonths.length,11);
});

test('account holder mapping takes precedence over a shared client mapping without changing financial rows',async()=>{
  const store=new GoogleStore({env:{}});
  store.context=async()=>({base:'https://sheets.test'});store.ensureSuppliers=async()=>{};
  const operations=[op(),op({id:'b',account:'UBS 243-557006.M1V'})];
  const accounts=[{id:'client:243-557006',holder:'Nicolas'},{id:op().account,holder:'Commun'}];
  const values=()=>({valueRanges:Object.entries(TABLES).map(([table,columns])=>({values:[columns,...(table==='Operations'?operations:table==='Comptes'?accounts:[]).map(row=>columns.map(key=>row[key]??''))]}))});
  store.request=async()=>values();
  const data=await store.read();
  assert.deepEqual(data.operations.map(o=>o.holder),['Commun','Nicolas']);
  assert.equal(data.operations[0].bankBalance,'1000');
  let saved;store.writeRow=async(...args)=>{saved=args;return args[1];};
  await store.saveAccount({id:op().account,holder:'Foyer',currency:'CHF'});
  assert.equal(saved[0],'Comptes');assert.equal(saved[1].clientNumber,'243-557006');
  assert.equal(saved[2],3);
  await assert.rejects(()=>store.saveAccount({id:'invalid',holder:'X'}));
});

test('legacy metadata migrations append bank headers without rewriting financial cells',async()=>{
  const store=new GoogleStore({env:{}}),calls=[];
  store.context=async()=>({base:'https://sheets.test'});store.ensureSuppliers=async()=>{};
  store.request=async()=>({valueRanges:Object.entries(TABLES).map(([table,columns])=>({values:[columns.slice(0,({Documents:11,Operations:16,Comptes:4})[table]||columns.length)]}))});
  store.json=async(...args)=>{calls.push(args);};
  await store.read();
  assert.deepEqual(calls.map(call=>call[0]),['https://sheets.test/values/Documents!L1:Q1?valueInputOption=RAW','https://sheets.test/values/Operations!Q1:U1?valueInputOption=RAW','https://sheets.test/values/Comptes!E1:I1?valueInputOption=RAW']);
  assert.ok(calls.every(call=>call[2].values.length===1));
});

test('bank identities survive operation edits and preserve a zero resulting balance',async()=>{
  assert.equal(validateOperation(op({bankBalance:0})).bankBalance,'0');
  const incoming=op(),old=op({account:'UBS',category:'Loisirs'});
  assert.equal(reconcileImport([incoming],[old])[0].account,incoming.account);
  const store=new GoogleStore({env:{}});store.read=async()=>({operations:[op({_row:2})],documents:[{id:'monthly'}]});
  let saved;store.writeRow=async(table,value)=>{saved=value;};
  await store.saveOperation(op({bankDirection:'credit',bankBalance:'900',paymentNetwork:'Cembra'}),true);
  assert.equal(saved.bankDirection,'debit');assert.equal(saved.bankBalance,'1000');
});

test('provided UBS monthly and annual PDFs match their printed debit and credit totals',async t=>{
  const folder=path.join(__dirname,'../aCharger/Archive-2026-11-14-12-41-47');
  let names;try{names=await fs.readdir(folder);}catch(error){if(error.code==='ENOENT'){t.skip('Private PDFs absent');return;}throw error;}
  const monthlyName=names.find(name=>name.endsWith('20260104092257146452.pdf'));
  const annualName=names.find(name=>name.endsWith('20260104092238240795.pdf'));
  if(!monthlyName||!annualName){t.skip('Private PDFs absent');return;}
  const monthly=await extractUBS(await fs.readFile(path.join(folder,monthlyName)));
  const annual=await extractUBS(await fs.readFile(path.join(folder,annualName)));
  assert.equal(monthly.operations.length,23);assert.equal(monthly.debitTotal,11151.10);assert.equal(monthly.creditTotal,10626);
  assert.equal(monthly.statementMonth,'2025-12');assert.equal(monthly.statementKind,'monthly');
  assert.equal(monthly.operations.filter(o=>o.type==='card_payment').reduce((sum,o)=>sum+o.amount,0),6800);
  assert.equal(annual.operations.length,11);assert.equal(annual.debitTotal,4650);assert.equal(annual.creditTotal,1006.05);
  assert.equal(annual.statementMonth,'');assert.equal(annual.statementKind,'annual');
  assert.equal(monthly.clientNumber,annual.clientNumber);assert.notEqual(monthly.accountId,annual.accountId);
  assert.ok(monthly.operations.every(o=>o.account===monthly.accountId&&o.holder));
  assert.throws(()=>parseUBSPages([]),error=>error.status===422);
  const data={documents:[],operations:[],accounts:[],suppliers:[],categories:[],budgets:[]};let uploads=0;
  const store={status:async()=>({connected:true,ready:true}),read:async()=>structuredClone(data),
    uploadPdf:async()=>({id:'pdf-'+(++uploads)}),renamePdf:async()=>{},
    appendImport:async(doc,rows)=>{data.documents.push(doc);data.operations.push(...rows);},
    saveAccount:async value=>value};
  const server=createApp(store).listen(0,'127.0.0.1');t.after(()=>{server.closeAllConnections();server.close();});await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port,headers={'X-MyCompta':'1','Content-Type':'application/pdf'};
  const body=await fs.readFile(path.join(folder,monthlyName));
  let response=await fetch(base+'/api/documents?source=UBS',{method:'POST',headers,body});
  assert.equal(response.status,201);assert.equal((await response.json()).count,23);
  assert.equal(data.documents[0].accountId,monthly.accountId);
  assert.equal(data.operations[0].account,monthly.accountId);
  response=await fetch(base+'/api/documents?source=UBS',{method:'POST',headers,body:Buffer.concat([body,Buffer.from('\n% another export')])});
  assert.equal((await response.json()).duplicateReason,'content');assert.equal(uploads,1);
  response=await fetch(base+'/api/documents?source=UBS',{method:'POST',headers,body:await fs.readFile(path.join(folder,annualName))});
  assert.equal(response.status,201);assert.equal((await response.json()).count,11);assert.equal(uploads,2);
  response=await fetch(base+'/api/reconciliation?start=2025-01&end=2025-12');
  assert.equal(response.status,200);assert.equal((await response.json()).annual.length,1);
  assert.equal((await fetch(base+'/api/reconciliation?start=2025-13&end=2025-12')).status,400);
  response=await fetch(base+'/api/accounts',{method:'POST',headers:{'X-MyCompta':'1','Content-Type':'application/json'},body:JSON.stringify({id:monthly.accountId,holder:'Commun'})});
  assert.equal(response.status,200);
});
