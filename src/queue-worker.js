import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './core.js';
import {drainQueue,ensureWorker,queuedReviews} from './review-queue.js';
import {processArchives,pendingArchives} from './final-archive.js';
const config=JSON.parse(await fs.readFile(path.join(ROOT,'native/paths.json'),'utf8'));
process.env.PKU_CODEX=config.codex;process.env.PKU_CXX=config.compiler;
let archives={observed:[]};
const outcome=await drainQueue({onIdle:async()=>{archives=await processArchives();}});
// A save may have landed just as the previous empty scan released its worker lock.
if(!outcome.busy&&((await queuedReviews()).some(job=>!outcome.attempted.includes(job.id))||(await pendingArchives()).some(job=>!archives.observed.includes(job.id))))await ensureWorker();
