const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { parseTopCardPages } = require('../parsers/topcard');
const { extractPdf } = require('../services/pdf');
const { contentHash } = require('../services/document-duplicates');
const { createApp } = require('../app');
const item = (text, x, y, width = 40) => ({ text, x, y, width });
const exportHeader = [item('Achat',85,700),item('Texte comptable',125,700),item('Montant',337,700),item('Débit',422,700,24),item('Crédit',490,700,26),item('Ecriture',523,700)];
const exportRow = (amount, credit = false) => [item('13.09.26',85,600),item('Magasin Exemple CHE',125,600),item(amount,credit ? 486 : 416,600,30),item('14.09.26',521,600),item('4353 79XX XXXX 1234, ALICE EXEMPLE',125,580)];
const invoiceHeader = [item('Date',52,700),item('Détails',135,700),item('Montant CHF',485,700,60)];

test('TopCard export uses debit/credit positions and rejects ambiguous columns', () => {
  const read = items => parseTopCardPages([{ num: 1, items: [...exportHeader, ...items] }]);
  assert.equal(read(exportRow('12.50')).operations[0].type, 'expense');
  assert.equal(read(exportRow('12.50', true)).operations[0].type, 'income');
  assert.equal(read(exportRow('12.50')).operations[0].date, '2026-09-13');
  assert.equal(read(exportRow('12.50')).operations[0].cardLast4, '1234');
  assert.equal(read([...exportRow('12.50'),item('12.50',486,600,30)]).operations.length, 0);
  assert.equal(read(exportRow('abc')).rejected, 1);
});

test('monthly TopCard uses purchase dates, CHF amounts and card continuation, excluding summaries', () => {
  const row = (y, amount, purchase = '13.09.2026') => [item('14.09.2026',52,y),item('Magasin Exemple',135,y),item(amount,515,y,30),item('EUR',390,y),item('99.00',450,y,25),item('Grand magasin',135,y-10),item(purchase,135,y-20)];
  const result = parseTopCardPages([
    { num:1, items:[...invoiceHeader,...row(600,'999.00')] },
    { num:2, items:[item('Détail de la facture',50,730),...invoiceHeader,item('ALICE EXEMPLE, Carte de crédit Supercard Visa, 4353 79XX XXXX',135,665),item('1234',135,655),...row(600,'12.50')] },
    { num:3, items:[...invoiceHeader,...row(600,'-5.00'),item('Total de carte',135,530),item('7.50',515,530,30)] }
  ]);
  assert.deepEqual(result.operations.map(o=>[o.amount,o.type,o.date,o.cardLast4]), [[12.5,'expense','2026-09-13','1234'],[5,'income','2026-09-13','1234']]);
  assert.equal(result.rejected, 0);
  const hash = contentHash('TopCard', result.operations);
  assert.equal(contentHash('TopCard',result.operations.map(o=>({...o,label:'Different portal label'}))),hash);
  assert.notEqual(contentHash('TopCard',result.operations.map(o=>({...o,cardLast4:'5678'}))),hash);
});

const files = ['topcard.pdf','Auswertungen.pdf'].map(name => path.join(__dirname,'../aCharger',name));
test('provided private TopCard samples reconcile and cannot be imported twice across formats', { skip: !files.every(file => fs.existsSync(file)) }, async t => {
  const bytes = files.map(file => fs.readFileSync(file));
  const parsed = await Promise.all(bytes.map(buffer => extractPdf(buffer,'TopCard')));
  for (const result of parsed) {
    assert.equal(result.operations.length,29);
    assert.equal(result.operations.reduce((sum,o)=>sum+Math.round(o.amount*100),0),113721);
    assert.equal(result.statementMonth,'2026-10');
    assert.equal(result.suggestedName,'TopCard - 2026-10-13.pdf');
    assert.equal(result.operations[0].date,'2026-09-13');
    assert.equal(result.operations[0].cardLast4,'1078');
  }
  const data = { documents:[],operations:[],suppliers:[] };
  let uploads = 0;
  const store = { read:async()=>structuredClone(data),uploadPdf:async()=>{ uploads++;return {id:'pdf'}; },renamePdf:async()=>{},appendImport:async(document,operations)=>{ data.documents.push(document);data.operations.push(...operations); } };
  const server = createApp(store).listen(0,'127.0.0.1');
  t.after(()=>{server.closeAllConnections();server.close();});
  await once(server,'listening');
  const upload = buffer => fetch(`http://127.0.0.1:${server.address().port}/api/documents?source=TopCard`, {method:'POST',headers:{'X-MyCompta':'1','Content-Type':'application/pdf'},body:buffer});
  assert.equal((await upload(bytes[0])).status,201);
  const duplicate = await upload(bytes[1]);
  assert.equal(duplicate.status,200);
  assert.equal((await duplicate.json()).duplicateReason,'content');
  assert.equal(uploads,1);
  assert.equal(data.operations.length,29);
});
