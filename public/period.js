(function (root) {
  const period = {
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
