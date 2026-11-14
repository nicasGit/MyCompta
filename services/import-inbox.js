const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const valid=id=>/^[0-9a-f-]{36}$/.test(id);
class ImportInbox {
  constructor(directory){this.directory=directory;this.memory=new Map();}
  async list(){
    if(!this.directory)return [...this.memory.values()].map(({buffer,...item})=>item);
    await fs.mkdir(this.directory,{recursive:true});
    const files=await fs.readdir(this.directory),items=[];
    for(const file of files.filter(file=>file.endsWith('.json')&&valid(file.slice(0,-5)))){
      items.push(JSON.parse(await fs.readFile(path.join(this.directory,file),'utf8')));
    }
    return items.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(id){
    if(!valid(id))throw Object.assign(new Error('Import introuvable.'),{status:404});
    if(!this.directory){const item=this.memory.get(id);if(item)return item;}
    else try{return {...JSON.parse(await fs.readFile(path.join(this.directory,id+'.json'),'utf8')),buffer:await fs.readFile(path.join(this.directory,id+'.pdf'))};}catch(error){if(error.code!=='ENOENT')throw error;}
    throw Object.assign(new Error('Import introuvable.'),{status:404});
  }
  async save(buffer,values,error){
    const hash=crypto.createHash('sha256').update(buffer).digest('hex'),items=await this.list(),old=items.find(item=>item.hash===hash);
    if(!old&&(items.length>=100||items.reduce((sum,item)=>sum+item.size,0)+buffer.length>250*1024*1024))throw new Error('Zone tampon pleine (100 PDF / 250 Mo). Supprimez des imports en erreur.');
    const now=new Date().toISOString();
    const item={...values,corrections:values.corrections??old?.corrections??[],id:old?.id||crypto.randomUUID(),hash,size:buffer.length,createdAt:old?.createdAt||(old?undefined:now),updatedAt:now,error:error.message,diagnostics:error.diagnostics||old?.diagnostics||null};
    if(!this.directory)this.memory.set(item.id,{...item,buffer:Buffer.from(buffer)});
    else{
      await fs.writeFile(path.join(this.directory,item.id+'.pdf'),buffer,{mode:0o600});
      const temporary=path.join(this.directory,item.id+'.json.tmp');
      await fs.writeFile(temporary,JSON.stringify(item),{mode:0o600});
      await fs.rename(temporary,path.join(this.directory,item.id+'.json'));
    }
    return item;
  }
  async remove(id){
    await this.get(id);
    if(!this.directory)this.memory.delete(id);
    else{await fs.unlink(path.join(this.directory,id+'.json'));await fs.unlink(path.join(this.directory,id+'.pdf'));}
  }
}
module.exports={ImportInbox};
