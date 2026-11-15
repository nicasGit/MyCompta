const {test}=require('node:test');
const assert=require('node:assert/strict');
const {aggregate}=require('../public/balance-data');
test('annual balance keeps monthly cents, currencies and years separate and excludes internal movements',()=>{
  const operation=overrides=>({date:'2026-01-10',type:'expense',amount:0.10,currency:'CHF',status:'validated',...overrides});
  const rows=[operation({}),operation({amount:0.20}),operation({type:'income',amount:100}),
    operation({date:'2026-02-10',amount:200}),operation({date:'2026-02-15',type:'income',amount:20}),
    ...['transfer','card_payment'].map(type=>operation({type,amount:900})),
    operation({status:'ignored',amount:900}),operation({isSavings:true,amount:900}),
    operation({date:'2025-01-01',amount:900}),operation({currency:'EUR',amount:90})];
  const data=aggregate(rows,2026,'CHF');
  assert.equal(data.months.length,12);
  assert.equal(data.months[0].expenses,0.3);
  assert.equal(data.months[0].income,100);
  assert.equal(data.months[0].net,99.7);
  assert.equal(data.months[1].net,-180);
  assert.equal(data.income,120);
  assert.equal(data.expenses,200.3);
  assert.equal(data.net,-80.3);
  assert.equal(data.months[2].count,0);
  assert.equal(aggregate(rows,2026,'EUR').expenses,90);
  assert.equal(aggregate([],2026,'CHF').net,0);
});
