import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,generateKeyPairSync} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),[node,codex,compiler]=process.argv.slice(2);
if(!node||!codex||!compiler)throw new Error('需要 Node、Codex 和编译器的可执行文件绝对路径。');
const patterns=['http://bailian.openjudge.cn/*','https://bailian.openjudge.cn/*','http://noi.openjudge.cn/*','https://noi.openjudge.cn/*'];
let key;try{const previous=JSON.parse(await fs.readFile(path.join(root,'extension/manifest.json'),'utf8'));if(previous.name==='OpenJudge · VS Code 连接')key=previous.key;}catch{}
key||=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'der'}).toString('base64');
const manifest={manifest_version:3,name:'OpenJudge · VS Code 连接',version:'2.1.0',description:'切换题目时只读同步题面到 VS Code 左侧；按钮读取评测，不修改网页、不保存 Chrome 数据。',minimum_chrome_version:'116',permissions:['scripting','nativeMessaging'],host_permissions:patterns,background:{service_worker:'openjudge-worker.js',type:'module'},action:{default_title:'连接 OpenJudge 与 VS Code'},key};
await fs.writeFile(path.join(root,'extension/manifest.json'),JSON.stringify(manifest,null,2));
const extensionId=[...createHash('sha256').update(Buffer.from(key,'base64')).digest().subarray(0,16)].flatMap(n=>[String.fromCharCode(97+(n>>4)),String.fromCharCode(97+(n&15))]).join('');
await fs.writeFile(path.join(root,'native/node-path.txt'),node);
await fs.writeFile(path.join(root,'native/paths.json'),JSON.stringify({variant:'openjudge-vscode',codex,compiler,extensionId},null,2));
await fs.writeFile(path.join(root,'native/edu.openjudge.cpp_coach.json'),JSON.stringify({name:'edu.openjudge.cpp_coach',description:'OpenJudge and VS Code private read-only bridge',path:path.join(root,'native/launcher.exe'),type:'stdio',allowed_origins:[`chrome-extension://${extensionId}/`]},null,2));
console.log(JSON.stringify({variant:'openjudge-vscode',extensionId}));
