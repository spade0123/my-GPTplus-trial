import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,generateKeyPairSync} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),[node,codex,compiler]=process.argv.slice(2);
if(!node||!codex||!compiler)throw new Error('需要 Node、Codex 和编译器的可执行文件绝对路径。');
const patterns=['https://programming.pku.edu.cn/*'];
let key;try{const previous=JSON.parse(await fs.readFile(path.join(root,'extension/manifest.json'),'utf8'));if(previous.name==='编程网格 · VS Code 连接')key=previous.key;}catch{}
key||=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'der'}).toString('base64');
const manifest={manifest_version:3,name:'编程网格 · VS Code 连接',version:'0.2.4',description:'同步编程网格题面；点击按钮才发送当前 VS Code 代码到网站测试执行或正式评测。',minimum_chrome_version:'116',permissions:['scripting','nativeMessaging'],host_permissions:patterns,background:{service_worker:'grid-worker.js',type:'module'},action:{default_title:'连接编程网格与 VS Code'},key};
await fs.writeFile(path.join(root,'extension/manifest.json'),JSON.stringify(manifest,null,2));
const extensionId=[...createHash('sha256').update(Buffer.from(key,'base64')).digest().subarray(0,16)].flatMap(n=>[String.fromCharCode(97+(n>>4)),String.fromCharCode(97+(n&15))]).join('');
await fs.writeFile(path.join(root,'native/node-path.txt'),node);
await fs.writeFile(path.join(root,'native/paths.json'),JSON.stringify({variant:'programminggrid-vscode',codex,compiler,extensionId},null,2));
await fs.writeFile(path.join(root,'native/edu.pku.grid_vscode_coach.json'),JSON.stringify({name:'edu.pku.grid_vscode_coach',description:'PKU Programming Grid and VS Code bridge',path:path.join(root,'native/launcher.exe'),type:'stdio',allowed_origins:[`chrome-extension://${extensionId}/`]},null,2));
console.log(JSON.stringify({variant:'programminggrid-vscode',extensionId}));
