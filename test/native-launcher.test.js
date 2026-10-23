import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {ROOT} from '../src/core.js';
import {frame,decoder} from '../src/native-protocol.js';
import {transferRecords} from '../extension/transfer-records.js';
import {chromeDataArea} from '../extension/legacy-data-areas.js';
test('compiled Windows launcher carries native binary messages and rejects other origins',{skip:process.platform!=='win32'},async t=>{
  const config=await fs.readFile(path.join(ROOT,'native/paths.json'),'utf8').then(JSON.parse).catch(()=>null);
  if(!config){t.skip('Run native/prepare.js and build launcher first.');return;}
  async function probe(origin){return new Promise((resolve,reject)=>{
    const child=spawn(path.join(ROOT,'native/launcher.exe'),[origin],{windowsHide:true});const messages=[];
    const timeout=setTimeout(()=>{child.kill();reject(new Error('launcher timeout'));},15000);
    child.stdout.on('data',decoder(v=>messages.push(v),reject));child.stderr.resume();child.stdin.on('error',()=>{});
    child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);resolve({code,messages});});
    child.stdin.end(frame({type:'status'}));
  });}
  const valid=await probe(`chrome-extension://${config.extensionId}/`);
  assert.equal(valid.code,0);assert.equal(valid.messages[0].ready,true);
  const invalid=await probe('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/');
  assert.equal(invalid.code,2);assert.equal(invalid.messages.length,0);
});

test('real native migration saves and verifies extension records on disk before browser deletion, without starting analysis',{skip:process.platform!=='win32'},async t=>{
  const config=await fs.readFile(path.join(ROOT,'native/paths.json'),'utf8').then(JSON.parse).catch(()=>null);
  if(!config){t.skip('Native host is not configured.');return;}
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pku-native-migration-'));
  const child=spawn(path.join(ROOT,'native/launcher.exe'),[`chrome-extension://${config.extensionId}/`],{env:{...process.env,PKU_DATA_DIR:directory},windowsHide:true});
  const pending=new Map();
  const rejectAll=error=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();};
  child.stdout.on('data',decoder(reply=>{const item=pending.get(reply.requestId);if(!item)return;pending.delete(reply.requestId);clearTimeout(item.timer);reply.type==='error'?item.reject(new Error(reply.error)):item.resolve(reply);},rejectAll));
  child.stderr.resume();child.stdin.on('error',rejectAll);child.on('error',rejectAll);child.on('exit',()=>rejectAll(new Error('native host exited')));
  const call=message=>new Promise((resolve,reject)=>{const requestId=randomUUID(),timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('native timeout'));},15000);pending.set(requestId,{resolve,reject,timer});child.stdin.write(frame({...message,requestId}));});
  try{
    const key='pku-site-cache-backup-'+'c'.repeat(64),value={entries:[{key:'problem_'+'a'.repeat(32),value:'自拟缓存😀'.repeat(20000)}]};
    const stored={[key]:value};let file;
    const area=chromeDataArea('indexeddb',{get:async k=>k===null?structuredClone(stored):{[k]:structuredClone(stored[k])},remove:async k=>{delete stored[k];}});
    const result=await transferRecords({areas:[area],call:async message=>{const reply=await call(message);if(reply.file)file=reply.file;return reply;}});
    assert.equal(result.moved,1);assert.deepEqual(result.failed,[]);assert.equal(stored[key],undefined);
    assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')).value,value);
    assert.deepEqual(await fs.readdir(directory),['browser-migration']);
  }finally{child.stdin.end();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});await fs.rm(directory,{recursive:true,force:true});}
});
