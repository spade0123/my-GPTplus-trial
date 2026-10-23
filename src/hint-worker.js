import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './core.js';
import {drainHints,queuedHints,ensureHintWorker} from './hint-review.js';
import {closeDiscussionModel,warmDiscussionModel,closeHintModel,warmHintModel} from './model-runner.js';
const config=JSON.parse(await fs.readFile(path.join(ROOT,'native/paths.json'),'utf8'));
process.env.PKU_CODEX=config.codex;process.env.PKU_CXX=config.compiler;
const kind=process.argv[2]==='discussion'?'discussion':'hint';
let outcome;
try{outcome=await drainHints({kind,idleMs:90000,onStart:()=> (kind==='discussion'?warmDiscussionModel():warmHintModel()).catch(()=>{})});}finally{await Promise.all([closeDiscussionModel(),closeHintModel()]);}
if(!outcome.busy&&(await queuedHints()).some(job=>(job.kind||'hint')===kind&&!outcome.attempted.includes(job.id)))await ensureHintWorker(kind);
