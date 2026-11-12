const { CATEGORIES } = require('./operations');
const key = name => name.normalize('NFKC').toLocaleLowerCase('fr');
function validateCategory(value) {
  const name = typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 80 || /[›\u0000-\u001f\u007f]/.test(name)) {
    throw Object.assign(new Error('Indiquez un nom de catégorie de 1 à 80 caractères.'), { status: 400 });
  }
  return name;
}
function categoryNames(rows = []) {
  const names = rows.some(row => (typeof row === 'string' ? row : row.name) === CATEGORIES[0]) ? [] : [...CATEGORIES];
  const seen = new Set(names.map(key));
  for (const row of rows) {
    const leaf = validateCategory(typeof row === 'string' ? row : row.name);
    const parent = typeof row === 'object' && row.parent ? validateCategory(row.parent) : '';
    const name = parent ? `${parent} › ${leaf}` : leaf;
    if (!seen.has(key(name))) { names.push(name); seen.add(key(name)); }
  }
  return names;
}
module.exports = { categoryNames, validateCategory, categoryKey: key };
