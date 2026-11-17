(() => {
  let activeId=null,activeFiles=[];
  const panel=document.querySelector('#shared-pdf-notice');
  async function clear() {
    if(activeId)await MyComptaSharedFiles.remove(activeId);
    activeId=null;activeFiles=[];panel.hidden=true;
  }
  document.querySelector('#discard-shared-pdf').onclick=async()=>{
    if(state.busy)return;
    try{await clear();MyComptaWorkflows.clearFiles();}catch(error){message(error.message,true);}
  };
  async function restore() {
    const params=new URLSearchParams(location.search);
    const id=params.get('shared'),error=params.get('share-error');
    if(id||error){params.delete('shared');params.delete('share-error');history.replaceState(null,'',location.pathname+(params.size?'?'+params:'')+location.hash);}
    if(error){showView('documents');message('Le partage du PDF a échoué : vérifiez le format, la limite de 15 Mo par fichier et l’espace disponible sur le téléphone, puis réessayez.',true);return;}
    try{
      const pending=await MyComptaSharedFiles.list();
      const item=id?pending.find(entry=>entry.id===id):pending[0];
      if(!item){if(id)message('Ce partage a expiré ou a déjà été importé. Partagez à nouveau le PDF.',true);return;}
      activeId=item.id;activeFiles=item.files;
      MyComptaWorkflows.selectFiles(item.files);
      document.querySelector('#upload-form').elements.source.value='Auto';
      document.querySelector('#shared-pdf-description').textContent=item.files.length+' PDF reçu(s) depuis le partage Android. Connectez-vous si nécessaire, puis cliquez sur Importer dans Drive. Copie temporaire sur ce téléphone pendant 24 h maximum.';
      panel.hidden=false;showView('documents');panel.scrollIntoView({block:'center'});
    }catch(error){if(id)message('Impossible de récupérer le PDF partagé : '+error.message,true);}
  }
  window.MyComptaSharedImport={clearImported:async files=>{
    if(activeId&&files.length===activeFiles.length&&files.every((file,index)=>file.name===activeFiles[index].name&&file.size===activeFiles[index].size&&file.lastModified===activeFiles[index].lastModified))await clear();
  }};
  restore();
})();
