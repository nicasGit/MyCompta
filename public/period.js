(function (root) {
  const period = {
    shiftMonth(value, offset) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value || '') || !Number.isInteger(offset)) return '';
      const [year, month] = value.split('-').map(Number);
      const index = year * 12 + month - 1 + offset;
      const nextYear = Math.floor(index / 12);
      if (nextYear < 1 || nextYear > 9999) return '';
      return `${String(nextYear).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
    },
    previousMonth(now = new Date()) {
      const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
    },
    prefix(mode, month, now = new Date()) {
      return mode === 'year' ? String(now.getFullYear()) : month;
    },
    matches(date, prefix) {
      return typeof date === 'string' && date.startsWith(prefix + (prefix.length === 4 ? '-' : ''));
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = period;
  else root.MyComptaPeriod = period;
})(globalThis);
