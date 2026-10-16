import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ROOT} from '../src/core.js';
import {frame,decoder} from '../src/native-protocol.js';
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
