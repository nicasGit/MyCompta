const test = require('node:test');
const assert = require('node:assert/strict');
const period = require('../public/period');

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
