(() => {
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const colors = ['#5750b8', '#247b65', '#bd581f', '#2477ab', '#b33f76', '#826311', '#555e77', '#7a45ad'];
  const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
  let operations = [], selected = null;
  function render(next) {
    operations = next;
    const yearSelect = $('#annual-year'), currencySelect = $('#annual-currency');
    const year = yearSelect.value || String(new Date().getFullYear()), currency = currencySelect.value || 'CHF';
    const years = [...new Set([String(new Date().getFullYear()), ...operations.map(o => o.date.slice(0, 4))])].sort().reverse();
    yearSelect.innerHTML = years.map(y => `<option>${escape(y)}</option>`).join('');
    yearSelect.value = years.includes(year) ? year : years[0];
    const currencies = [...new Set(['CHF', ...operations.map(o => o.currency)])];
    currencySelect.innerHTML = currencies.map(c => `<option>${escape(c)}</option>`).join('');
    currencySelect.value = currencies.includes(currency) ? currency : 'CHF';
    draw();
  }
  function draw() {
    const year = $('#annual-year').value, currency = $('#annual-currency').value;
    const rows = MyComptaAnnualData.aggregate(operations, year, currency);
    if (selected === null && rows.length) selected = new Set(rows.slice(0, 5).map(row => row.category));
    const money = value => new Intl.NumberFormat('fr-CH', { style: 'currency', currency }).format(value);
    $('#annual-categories').innerHTML = rows.map((row, i) => `<label><input type="checkbox" data-annual-category="${escape(row.category)}" ${selected.has(row.category) ? 'checked' : ''}><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="${colors[i % colors.length]}"/></svg>${escape(row.category)}</label>`).join('');
    const visible = rows.filter(row => selected.has(row.category));
    if (!visible.length) {
      $('#annual-chart').innerHTML = `<p class="muted">${rows.length ? 'Choisissez au moins une catégorie ci-dessus.' : 'Aucune dépense enregistrée pour cette année et cette devise.'}</p>`;
      $('#annual-table').innerHTML = '';
      return;
    }
    const max = Math.max(1, ...visible.flatMap(row => row.values));
    const x = index => 85 + index * 69, y = value => 270 - value / max * 225;
    let svg = `<svg viewBox="0 0 900 325" role="img" aria-labelledby="annual-svg-title annual-svg-desc"><title id="annual-svg-title">Évolution des dépenses par catégorie en ${year}, en ${currency}</title><desc id="annual-svg-desc">Une courbe par catégorie sélectionnée. Les montants exacts sont disponibles dans le tableau sous le graphique.</desc>`;
    for (let i = 0; i <= 4; i++) {
      const value = max * i / 4;
      svg += `<line x1="85" x2="844" y1="${y(value)}" y2="${y(value)}" stroke="#dce3ed"/><text x="76" y="${y(value) + 4}" text-anchor="end" fill="currentColor" font-size="12">${escape(new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 0 }).format(value))}</text>`;
    }
    months.forEach((month, index) => { svg += `<text x="${x(index)}" y="300" text-anchor="middle" fill="currentColor" font-size="12">${month}</text>`; });
    for (const row of visible) {
      const index = rows.indexOf(row), color = colors[index % colors.length];
      svg += `<polyline points="${row.values.map((value, month) => `${x(month)},${y(value)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="3" ${index >= colors.length ? 'stroke-dasharray="7 4"' : ''}/>`;
      row.values.forEach((value, month) => { svg += `<circle cx="${x(month)}" cy="${y(value)}" r="5" fill="${color}"><title>${escape(row.category)} · ${months[month]} ${year} : ${escape(money(value))}</title></circle>`; });
    }
    $('#annual-chart').innerHTML = svg + '</svg>';
    $('#annual-table').innerHTML = `<table><caption>Montants mensuels en ${escape(currency)} · ${year}</caption><thead><tr><th scope="col">Catégorie</th>${months.map(month => `<th scope="col">${month}</th>`).join('')}</tr></thead><tbody>${visible.map(row => `<tr><th scope="row">${escape(row.category)}</th>${row.values.map(value => `<td class="amount">${escape(money(value))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  $('#annual-year').onchange = () => { selected = null; draw(); };
  $('#annual-currency').onchange = () => { selected = null; draw(); };
  $('#annual-categories').addEventListener('change', event => {
    const category = event.target.dataset.annualCategory;
    if (category === undefined) return;
    if (event.target.checked) selected.add(category); else selected.delete(category);
    draw();
  });
  window.MyComptaAnnual = { render };
})();
