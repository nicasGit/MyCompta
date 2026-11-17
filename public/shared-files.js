(function(root) {
  const MAX_FILE=15*1024*1024,MAX_TOTAL=100*1024*1024,TTL=24*60*60*1000;
  async function validate(files) {
    if (!files.length || files.length>20) throw new Error('Partagez de 1 à 20 PDF à la fois.');
    let total=0;
    for (const file of files) {
      if (!file || typeof file.slice!=='function' || !(file.type==='application/pdf'||/\.pdf$/i.test(file.name||''))) throw new Error('Le partage doit contenir des fichiers PDF.');
      if (!file.size || file.size>MAX_FILE) throw new Error('Chaque PDF doit faire au maximum 15 Mo.');
      total+=file.size;
      if (!(await file.slice(0,1024).text()).includes('%PDF-')) throw new Error('Un fichier partagé ne semble pas être un PDF valide.');
    }
    if (total>MAX_TOTAL) throw new Error('Le partage dépasse 100 Mo.');
    return files;
  }
  function open() {
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open('mycompta-shared-pdfs',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('pending',{keyPath:'id'});
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  }
  async function transaction(mode,run) {
    const db=await open();
    try { return await new Promise((resolve,reject)=>{
      const tx=db.transaction('pending',mode);let value;
      tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Stockage du partage interrompu.'));
      run(tx.objectStore('pending'),result=>{value=result;},tx);
    }); } finally { db.close(); }
  }
  async function list() {
    return transaction('readwrite',(store,done)=>{
      const request=store.getAll();request.onsuccess=()=>{
        const valid=[];
        for(const item of request.result){if(item.createdAt+TTL<Date.now())store.delete(item.id);else valid.push(item);}
        done(valid.sort((a,b)=>b.createdAt-a.createdAt));
      };
    });
  }
  async function save(files) {
    await validate(files);
    await list();
    const item={id:crypto.randomUUID(),createdAt:Date.now(),files};
    await transaction('readwrite',(store,done,tx)=>{
      const request=store.getAll();request.onsuccess=()=>{
        const size=request.result.reduce((sum,entry)=>sum+entry.files.reduce((n,file)=>n+file.size,0),0)+files.reduce((sum,file)=>sum+file.size,0);
        if(size>MAX_TOTAL){tx.abort();return;}
        store.put(item);done(item.id);
      };
    });
    return item.id;
  }
  const remove=id=>transaction('readwrite',(store)=>store.delete(id));
  const api={validate,save,list,remove};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.MyComptaSharedFiles=api;
})(globalThis);
