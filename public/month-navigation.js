// Navigation changes display periods only, never stored statement metadata.
document.querySelectorAll('#month, #coverage-start, #coverage-end, #reconciliation-start, #reconciliation-end').forEach(input => {
  const group = document.createElement('span');
  group.className = 'month-stepper';
  const label = input.getAttribute('aria-label') || (input.id.endsWith('start') ? 'Depuis' : 'Jusqu’à');
  input.before(group);
  for (const offset of [-1, 1]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary month-step';
    button.textContent = offset < 0 ? '‹' : '›';
    const title = `${label} : mois ${offset < 0 ? 'précédent' : 'suivant'}`;
    button.setAttribute('aria-label', title);
    button.title = title;
    button.addEventListener('click', event => {
      event.preventDefault();
      const value = MyComptaPeriod.shiftMonth(input.value || MyComptaPeriod.previousMonth(), offset);
      if (!value || (input.min && value < input.min) || (input.max && value > input.max)) return;
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    group.append(button);
    if (offset < 0) group.append(input);
  }
});
