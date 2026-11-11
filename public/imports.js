(function (root) {
  async function run(files, source, upload, report = () => {}) {
    const results = [];
    for (const [index, file] of files.entries()) {
      report({ index, file, results });
      try {
        if (file.size > 15 * 1024 * 1024) throw new Error('Ce fichier dépasse 15 Mo.');
        const response = await upload(file, source);
        results.push({ name: file.name, response });
      } catch (error) { results.push({ name: file.name, error: error.message }); }
      report({ index, file, results });
    }
    return results;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { run };
  else root.MyComptaImports = { run };
})(globalThis);
