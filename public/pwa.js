(() => {
  const button = document.querySelector('#install-app');
  const dialog = document.querySelector('#install-dialog');
  const confirm = document.querySelector('#confirm-install');
  const standalone = matchMedia('(display-mode: standalone)');
  let promptEvent = null;
  const installed = () => standalone.matches || navigator.standalone === true;
  const refresh = () => { button.hidden = installed(); };
  refresh();
  standalone.addEventListener('change', refresh);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    promptEvent = event;
    confirm.hidden = false;
    refresh();
  });
  window.addEventListener('appinstalled', () => {
    promptEvent = null;
    confirm.hidden = true;
    button.hidden = true;
    dialog.close();
  });
  button.addEventListener('click', () => {
    document.querySelector('#install-secure').hidden = window.isSecureContext;
    dialog.showModal();
  });
  document.querySelector('#close-install').addEventListener('click', () => dialog.close());
  confirm.addEventListener('click', async () => {
    if (!promptEvent) return;
    const event = promptEvent;
    promptEvent = null;
    confirm.hidden = true;
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === 'accepted') dialog.close();
    } catch {
      // The browser instructions remain available if the native prompt fails.
    }
  });
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' })
      .catch(error => console.warn('Installation MyCompta :', error));
  }
})();
