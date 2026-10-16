import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {ROOT} from '../src/core.js';
const [nodePath,codex,compiler]=process.argv.slice(2);
if(!nodePath||!codex||!compiler)throw new Error('需要 node、codex、g++ 绝对路径');
const manifestFile=path.join(ROOT,'extension/manifest.json');
const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));
if(!manifest.key){const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});manifest.key=publicKey.export({type:'spki',format:'der'}).toString('base64');await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2));}
const extensionId=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)].flatMap(n=>[String.fromCharCode(97+(n>>4)),String.fromCharCode(97+(n&15))]).join('');
await fs.writeFile(path.join(ROOT,'native/node-path.txt'),nodePath);
await fs.writeFile(path.join(ROOT,'native/paths.json'),JSON.stringify({codex,compiler,extensionId},null,2));
await fs.writeFile(path.join(ROOT,'native/edu.pku.cpp_coach.json'),JSON.stringify({name:'edu.pku.cpp_coach',description:'PKU C++ personal review host',path:path.join(ROOT,'native/launcher.exe'),type:'stdio',allowed_origins:[`chrome-extension://${extensionId}/`]},null,2));
console.log(`扩展 ID：${extensionId}`);
