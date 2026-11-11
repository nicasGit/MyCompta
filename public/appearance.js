(() => {
  const key = 'mycompta.appearance';
  let current = 'colorful';
  try { if (localStorage.getItem(key) === 'classic') current = 'classic'; } catch {}
  document.documentElement.dataset.appearance = current;
  document.addEventListener('DOMContentLoaded', () => {
    const inputs = document.querySelectorAll('input[name="appearance"]');
    const apply = theme => {
      document.documentElement.dataset.appearance = theme;
      document.querySelector('meta[name="theme-color"]').content = theme === 'colorful' ? '#5750b8' : '#285fa8';
      inputs.forEach(input => { input.checked = input.value === theme; });
    };
    apply(current);
    inputs.forEach(input => input.addEventListener('change', () => {
      apply(input.value);
      const status = document.querySelector('#appearance-status');
      try {
        localStorage.setItem(key, input.value);
        status.textContent = 'Ambiance enregistrée sur cet appareil. Vous pouvez en changer à tout moment.';
      } catch {
        status.textContent = 'Ambiance appliquée. Le navigateur ne permet pas de mémoriser ce choix sur cet appareil.';
      }
    }));
  });
})();
