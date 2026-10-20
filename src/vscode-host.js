import fs from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {ROOT} from './core.js';
import {ensureWorker} from './review-queue.js';
import {ensureHintWorker} from './hint-review.js';
import {createVscodeService} from './vscode-service.js';
import {watchProblemDisplay} from './problem-display.js';
const config=JSON.parse(await fs.readFile(path.join(ROOT,'native/paths.json'),'utf8'));
process.env.PKU_CODEX=config.codex;process.env.PKU_CXX=config.compiler;
const service=createVscodeService({launchReport:()=>ensureWorker(),launchHint:kind=>ensureHintWorker(kind)});
const notices=await watchProblemDisplay(value=>process.stdout.write(JSON.stringify({event:'problem_display',value})+'\n'));
createInterface({input:process.stdin,crlfDelay:Infinity}).on('close',()=>notices.dispose()).on('line',line=>{
  void (async()=>{
    let message;
    try{if(Buffer.byteLength(line)>350000)throw new Error('请求超过大小限制。');message=JSON.parse(line);const result=await service.handle(message);process.stdout.write(JSON.stringify({requestId:message.requestId,result})+'\n');}
    catch(e){process.stdout.write(JSON.stringify({requestId:message?.requestId,error:String(e.message).slice(0,2000)})+'\n');}
  })();
});
