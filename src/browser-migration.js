import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {dataDir,acquireLock} from './browser-review.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const maxBytes=24*1024*1024;
export function migrationKey(key){
  return typeof key==='string'&&(/^(?:preferredSource|standard|pku-site-cache-last-backup)$/.test(key)||/^pku-site-cache-backup-(?:[-a-f0-9]{36}|[a-f0-9]{64})$/i.test(key)||/^pku-submission-[-a-f0-9]{36}$/i.test(key)||/^pku-drafts:\d{1,30}:\/probset\/[a-f0-9]{32}\/[a-f0-9]{32}\/ide\.do$/.test(key));
}
export function createMigrationSink({directory=path.join(dataDir(),'browser-migration'),now=Date.now}={}){
  const uploads=new Map();
  function metadata(value){
    if(!['local','session','indexeddb'].includes(value.area)||!migrationKey(value.key)||!Number.isInteger(value.sizeBytes)||value.sizeBytes<1||value.sizeBytes>maxBytes||!/^[a-f0-9]{64}$/.test(value.sha256||''))throw new Error('旧扩展备份的范围、大小或校验信息无效。');
    return {area:value.area,key:value.key,sizeBytes:value.sizeBytes,sha256:value.sha256};
  }
  function destination(meta){return path.join(directory,meta.area,digest(meta.key),meta.sha256+'.json');}
  async function verify(meta){
    const file=destination(meta),saved=JSON.parse(await fs.readFile(file,'utf8'));
    const bytes=Buffer.from(JSON.stringify(saved.value),'utf8');
    if(saved.sourceArea!==meta.area||saved.key!==meta.key||saved.sha256!==meta.sha256||saved.sizeBytes!==meta.sizeBytes||bytes.length!==meta.sizeBytes||digest(bytes)!==meta.sha256)throw new Error('本机副本核对失败，Chrome 中的旧记录不能删除。');
    return {type:'migration_verified',sha256:meta.sha256,sizeBytes:meta.sizeBytes,directory,file};
  }
  return {async handle(message){
    if(message.type==='migration_begin'){
      for(const [id,upload] of uploads)if(now()-upload.started>300000)uploads.delete(id);
      const meta=metadata(message);if(uploads.size>=4)throw new Error('正在迁出的备份过多，请稍后重试。');
      const uploadId=randomUUID();uploads.set(uploadId,{meta,parts:[],received:0,started:now()});return {type:'migration_ready',uploadId};
    }
    if(message.type==='migration_verify')return verify(metadata(message));
    if(!['migration_chunk','migration_commit'].includes(message.type))throw new Error('不支持的迁出操作。');
    const upload=uploads.get(message.uploadId);if(!upload)throw new Error('迁出连接已过期；Chrome 原记录仍应保留，请重新开始。');
    if(message.type==='migration_chunk'){
      if(typeof message.base64!=='string'||message.base64.length>64000||message.offset!==upload.received)throw new Error('迁出数据的顺序或分块大小无效。');
      const bytes=Buffer.from(message.base64,'base64');
      if(!bytes.length||bytes.toString('base64')!==message.base64||upload.received+bytes.length>upload.meta.sizeBytes)throw new Error('迁出数据不完整或损坏。');
      upload.parts.push(bytes);upload.received+=bytes.length;return {type:'migration_chunk_saved',received:upload.received};
    }
    uploads.delete(message.uploadId);
    const bytes=Buffer.concat(upload.parts),meta=upload.meta;
    if(bytes.length!==meta.sizeBytes||digest(bytes)!==meta.sha256)throw new Error('迁出数据大小或哈希不一致，尚未确认本机副本。');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);
    if(JSON.stringify(value)!==text)throw new Error('迁出数据格式不一致，Chrome 原记录保留。');
    const file=destination(meta);await fs.mkdir(path.dirname(file),{recursive:true});
    let release;
    for(let i=0;i<100;i++){release=await acquireLock(file+'.lock');if(release)break;await new Promise(r=>setTimeout(r,10));}
    if(!release)throw new Error('同一备份正在落盘，Chrome 原记录保留。');
    try{
      try{await fs.access(file);return await verify(meta);}catch(error){if(error.code!=='ENOENT')throw error;}
      const temporary=file+'.'+randomUUID()+'.tmp',handle=await fs.open(temporary,'wx',0o600);
      try{await handle.writeFile(JSON.stringify({schemaVersion:1,sourceArea:meta.area,key:meta.key,sha256:meta.sha256,sizeBytes:meta.sizeBytes,migratedAt:new Date(now()).toISOString(),value},null,2),'utf8');await handle.sync();}
      finally{await handle.close();}
      await fs.rename(temporary,file);
      return await verify(meta);
    }finally{await release();}
  }};
}
