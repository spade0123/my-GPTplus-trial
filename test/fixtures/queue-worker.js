import fs from 'node:fs/promises';
import path from 'node:path';
import {dataDir} from '../../src/browser-review.js';
import {drainQueue} from '../../src/review-queue.js';
await drainQueue({compile:async()=>({status:'passed',ranProgram:false}),model:async()=>{
  await fs.writeFile(path.join(dataDir(),'model-started'),String(process.pid));
  let released=false;
  for(let i=0;i<1500;i++){try{await fs.access(path.join(dataDir(),'release-model'));released=true;break;}catch{}await new Promise(r=>setTimeout(r,20));}
  if(!released)throw new Error('模拟模型等待超时');
  return {markdown:'后台进程集成测试的模拟报告，不是用户真实作业分析。',topics:['testing'],evidence:'测试证据',next_step:'测试练习'};
}});
