const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate } = require('../public/operation-totals');
test('filtered operation totals keep currencies separate, use cents and exclude ignored rows and transfers', () => {
  const base = { amount: 0.1, currency: 'CHF', type: 'expense', status: 'validated' };
  assert.deepEqual(calculate([base, { ...base, amount: 0.2 }, { ...base, amount: 0.1, type: 'income' },
    { ...base, amount: 25, currency: 'EUR' }, { ...base, amount: 100, type: 'transfer' },
    { ...base, amount: 100, type: 'card_payment' }, { ...base, amount: 100, status: 'ignored' }]), [
    { currency: 'CHF', expenses: 0.3, income: 0.1, net: -0.2 },
    { currency: 'EUR', expenses: 25, income: 0, net: -25 }
  ]);
  assert.deepEqual(calculate([]), []);
});

test('net is positive for a surplus and zero when income equals expenses',()=>{
  const base={currency:'CHF',status:'validated'};
  assert.equal(calculate([{...base,type:'income',amount:2000},{...base,type:'expense',amount:621.50}])[0].net,1378.50);
  assert.equal(calculate([{...base,type:'income',amount:100},{...base,type:'expense',amount:100}])[0].net,0);
});
