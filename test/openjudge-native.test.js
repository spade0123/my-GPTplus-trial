import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {ROOT} from '../src/core.js';
import {frame,decoder} from '../src/native-protocol.js';
test('independent Windows native bridge rejects other origins and relays only explicit requests',{skip:process.platform!=='win32'},async t=>{
  const config=await fs.readFile(path.join(ROOT,'native/paths.json'),'utf8').then(JSON.parse).catch(()=>null);
  if(!config){t.skip('Run install-openjudge.ps1 first.');return;}
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'oj-native-'));
  const invalid=spawn(path.join(ROOT,'native/launcher.exe'),['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'],{windowsHide:true});invalid.stdin.end();invalid.stdout.resume();invalid.stderr.resume();
  assert.equal(await new Promise(r=>invalid.once('close',r)),2);
  const child=spawn(path.join(ROOT,'native/launcher.exe'),[`chrome-extension://${config.extensionId}/`],{windowsHide:true,env:{...process.env,PKU_DATA_DIR:dir}});
  const messages=[];child.stdout.on('data',decoder(m=>messages.push(m),e=>{throw e;}));child.stderr.resume();child.stdin.on('error',()=>{});
  const until=async fn=>{for(let i=0;i<150;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,30));}throw new Error('native bridge timeout');};
  try{
    child.stdin.write(frame({type:'bridge_open'}));await until(()=>messages.some(m=>m.type==='bridge_ready'));
    const id=randomUUID(),file=path.join(dir,'browser-bridge/requests',id+'.json');
    await fs.writeFile(file,JSON.stringify({id,action:'tabs',params:{},expiresAt:Date.now()+5000}));
    const request=await until(()=>messages.find(m=>m.type==='browser_request'&&m.id===id));assert.equal(request.action,'tabs');
    child.stdin.write(frame({type:'browser_reply',id,value:[{id:1,url:'http://noi.openjudge.cn/ch0101/10/'}]}));
    const response=await until(()=>fs.readFile(path.join(dir,'browser-bridge/responses',id+'.json'),'utf8').then(JSON.parse).catch(()=>null));assert.equal(response.value[0].id,1);
    assert.equal((await fs.readdir(dir)).some(name=>/^[a-f0-9]{64}\.json$/.test(name)),false);
  }finally{child.stdin.end();await new Promise(r=>child.exitCode!==null?r():child.once('close',r));await fs.rm(dir,{recursive:true,force:true});}
});
