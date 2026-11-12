const test = require('node:test');
const assert = require('node:assert/strict');
const period = require('../public/period');

test('month navigation advances and retreats through year boundaries without skipping short months', () => {
  assert.equal(period.shiftMonth('2026-12', 1), '2027-01');
  assert.equal(period.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(period.shiftMonth('2026-03', -1), '2026-02');
  assert.equal(period.shiftMonth('2026-02', 1), '2026-03');
  assert.equal(period.shiftMonth('2026-13', 1), '');
  assert.equal(period.shiftMonth('0001-01', -1), '');
});

test('previous month handles January and month ends using local calendar dates', () => {
  assert.equal(period.previousMonth(new Date(2026, 10, 11)), '2026-10');
  assert.equal(period.previousMonth(new Date(2026, 0, 31)), '2025-12');
  assert.equal(period.previousMonth(new Date(2026, 2, 31)), '2026-02');
});

test('annual view uses the current year independently of the selected month', () => {
  const now = new Date(2026, 0, 3);
  assert.equal(period.prefix('year', '2025-12', now), '2026');
  assert.equal(period.prefix('month', '2025-12', now), '2025-12');
  const dates = ['2025-12-31', '2026-01-01', '2026-10-15', '2026-11-01'];
  assert.deepEqual(dates.filter(date => period.matches(date, '2026')), dates.slice(1));
  assert.deepEqual(dates.filter(date => period.matches(date, '2026-10')), ['2026-10-15']);
});
