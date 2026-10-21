import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createMigrationSink,migrationKey as nativeKey} from '../src/browser-migration.js';
import {transferRecords,migrationKey} from '../extension/transfer-records.js';
import {chromeDataArea} from '../extension/legacy-data-areas.js';
import {frame} from '../src/native-protocol.js';
const key='pku-drafts:123:/probset/d0ef3e0f7fa5481d896f9a07254c8ecd/da7f4a3eadf4448d98cca4006c43b640/ide.do';
const hash=value=>createHash('sha256').update(value).digest('hex');
function memory(values){const data=structuredClone(values);return {data,get:async k=>k===null?structuredClone(data):{[k]:structuredClone(data[k])},remove:async k=>{delete data[k];}};}
async function isolated(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pku-migration-'));try{await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}

test('large Unicode drafts migrate to verified files before deletion, without new Chrome writes or model calls',()=>isolated(async directory=>{
  const value={title:'测试题',versions:[{code:'// 中文😀'.repeat(35000),id:'version-one'}]},storage=memory({[key]:value,standard:'c++17',unknown_private_key:'preserve'});
  const sink=createMigrationSink({directory}),calls=[],files=[];
  const call=async message=>{assert.ok(frame(message).length<300000);calls.push(message.type);const reply=await sink.handle(message);if(reply.type==='migration_verified')files.push(reply.file);return reply;};
  const area=chromeDataArea('local',storage),remove=area.removeIfUnchanged;
  area.removeIfUnchanged=async(k,text)=>{assert.equal(calls.at(-1),'migration_verify');const exported=JSON.parse(await fs.readFile(files.at(-1),'utf8'));assert.equal(JSON.stringify(exported.value),text);return remove(k,text);};
  const result=await transferRecords({areas:[area],call});
  assert.equal(result.moved,2);assert.deepEqual(result.failed,[]);assert.equal(storage.data[key],undefined);assert.equal(storage.data.unknown_private_key,'preserve');
  assert.ok(calls.filter(t=>t==='migration_chunk').length>10);assert.equal(result.directory,directory);
  const first=files[0];assert.deepEqual(JSON.parse(await fs.readFile(first,'utf8')).value,value);
  // A retry from an unchanged source reuses the same verified file, never overwrites it.
  const original=await fs.readFile(first,'utf8');storage.data[key]=structuredClone(value);
  const repeated=await transferRecords({areas:[chromeDataArea('local',storage)],call});assert.equal(repeated.moved,1);assert.equal(await fs.readFile(first,'utf8'),original);
}));

test('native failure, corrupt confirmation, and concurrently changed records retain Chrome originals',()=>isolated(async directory=>{
  const initial={code:'int main(){return 0;}'};
  for(const failure of ['offline','wrong-hash','changed','disk']){
    const storage=memory({[key]:initial});let sink;
    if(failure==='disk'){const blocked=path.join(directory,'blocked');await fs.writeFile(blocked,'not a directory');sink=createMigrationSink({directory:blocked});}
    else sink=createMigrationSink({directory:path.join(directory,failure)});
    const call=async message=>{
      if(failure==='offline')throw new Error('native offline');
      const response=await sink.handle(message);
      if(message.type==='migration_verify'){
        if(failure==='wrong-hash')return {...response,sha256:'0'.repeat(64)};
        if(failure==='changed')storage.data[key]={code:'new unsaved version'};
      }
      return response;
    };
    const result=await transferRecords({areas:[chromeDataArea('local',storage)],call});
    assert.equal(result.moved,0);
    if(failure==='changed'){assert.equal(result.changed,1);assert.equal(storage.data[key].code,'new unsaved version');}
    else{assert.equal(result.failed.length,1);assert.deepEqual(storage.data[key],initial);}
  }
}));

test('migration keys cannot reach website storage, arbitrary files, or unknown extension records',()=>isolated(async directory=>{
  for(const invalid of ['problem_'+'a'.repeat(32),'data_code','_backup_123','../../passwords','pku-drafts:123:/../../file']){
    assert.equal(migrationKey(invalid),false);assert.equal(nativeKey(invalid),false);
    const sink=createMigrationSink({directory});
    await assert.rejects(sink.handle({type:'migration_begin',area:'local',key:invalid,sizeBytes:2,sha256:hash('{}')}),/范围/);
  }
  for(const allowed of [key,'preferredSource','standard','pku-site-cache-last-backup','pku-site-cache-backup-'+'b'.repeat(64),'pku-submission-00000000-0000-0000-0000-000000000000'])assert.equal(migrationKey(allowed),nativeKey(allowed));
  const sink=createMigrationSink({directory});await assert.rejects(sink.handle({type:'migration_begin',area:'website',key,sizeBytes:2,sha256:hash('{}')}),/范围/);
  const storage=memory({problem_a:'keep website-like key',unknown:'keep'});
  const result=await transferRecords({areas:[chromeDataArea('local',storage)],call:()=>{throw new Error('must not call native');}});assert.equal(result.moved,0);assert.equal(Object.keys(storage.data).length,2);
}));

test('bad chunk order, incomplete uploads and altered on-disk copies never receive a verified acknowledgement',()=>isolated(async directory=>{
  const sink=createMigrationSink({directory}),text='{"code":"test"}',meta={area:'local',key,sizeBytes:Buffer.byteLength(text),sha256:hash(text)};
  const ready=await sink.handle({type:'migration_begin',...meta});
  await assert.rejects(sink.handle({type:'migration_chunk',uploadId:ready.uploadId,offset:1,base64:Buffer.from(text).toString('base64')}),/顺序/);
  await assert.rejects(sink.handle({type:'migration_commit',uploadId:ready.uploadId}),/不一致/);
  const next=await sink.handle({type:'migration_begin',...meta});await sink.handle({type:'migration_chunk',uploadId:next.uploadId,offset:0,base64:Buffer.from(text).toString('base64')});
  const saved=await sink.handle({type:'migration_commit',uploadId:next.uploadId});assert.equal(saved.type,'migration_verified');
  const record=JSON.parse(await fs.readFile(saved.file,'utf8'));record.value.code='corrupted';await fs.writeFile(saved.file,JSON.stringify(record));
  await assert.rejects(sink.handle({type:'migration_verify',...meta}),/核对失败/);
}));
