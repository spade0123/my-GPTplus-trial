// Extension-owned old data only. No tabs, host pages, code injection, or models.
export function migrationKey(key){
  return typeof key==='string'&&(/^(?:preferredSource|standard|pku-site-cache-last-backup)$/.test(key)||/^pku-site-cache-backup-(?:[-a-f0-9]{36}|[a-f0-9]{64})$/i.test(key)||/^pku-submission-[-a-f0-9]{36}$/i.test(key)||/^pku-drafts:\d{1,30}:\/probset\/[a-f0-9]{32}\/[a-f0-9]{32}\/ide\.do$/.test(key));
}
const sha256=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
export async function transferRecords({areas,call,onProgress=()=>{}}){
  const result={moved:0,changed:0,failed:[],directory:null};
  for(const area of areas){
    let keys;try{keys=await area.keys();}catch(error){result.failed.push({area:area.name,error:error.message});continue;}
    for(const key of keys.filter(migrationKey)){
      try{
        const value=await area.get(key);if(value===undefined)continue;
        const text=JSON.stringify(value),bytes=new TextEncoder().encode(text),sha=await sha256(bytes);
        const meta={area:area.name,key,sizeBytes:bytes.length,sha256:sha};
        onProgress({key,stage:'saving'});
        const ready=await call({type:'migration_begin',...meta});
        for(let offset=0;offset<bytes.length;offset+=48000){
          const part=bytes.subarray(offset,offset+48000),base64=btoa(String.fromCharCode(...part));
          const saved=await call({type:'migration_chunk',uploadId:ready.uploadId,offset,base64});
          if(saved.received!==offset+part.length)throw new Error('本机未确认完整分块。');
        }
        await call({type:'migration_commit',uploadId:ready.uploadId});
        const confirmed=await call({type:'migration_verify',...meta});
        if(confirmed.type!=='migration_verified'||confirmed.sha256!==sha||confirmed.sizeBytes!==bytes.length)throw new Error('本机副本尚未核对成功，旧记录保留。');
        result.directory=confirmed.directory;
        // Storage adapters recheck the unchanged source immediately before delete.
        if(await area.removeIfUnchanged(key,text)){result.moved++;onProgress({key,stage:'moved'});}
        else{result.changed++;onProgress({key,stage:'changed'});}
      }catch(error){result.failed.push({area:area.name,key,error:error.message});onProgress({key,stage:'failed'});}
    }
  }
  return result;
}
