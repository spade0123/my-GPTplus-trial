import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './core.js';
import { frame, decoder } from './native-protocol.js';
import { readReview,reviewSummary,reviewHistory } from './browser-review.js';
import {ensureWorker,retryReview} from './review-queue.js';
import {saveAttempt,problemSummary,recordVerdict} from './problem-history.js';
import {retryArchive,pendingArchives} from './final-archive.js';
const config=JSON.parse(await fs.readFile(path.join(ROOT,'native/paths.json'),'utf8'));
if(process.argv[2]!==`chrome-extension://${config.extensionId}/`)process.exit(2);
process.env.PKU_CODEX=config.codex;process.env.PKU_CXX=config.compiler;
const send=value=>process.stdout.write(frame(value));
process.stdin.on('data',decoder(async message=>{
  const reply=value=>send({...value,requestId:message.requestId,requestType:message.type});
  if(message.type==='status'){reply({type:'status',version:'1.4.0',ready:true});return;}
  try {
    if(['save','analyze','submission','finish','retry'].includes(message.type)) {
      if(message.type==='finish')await recordVerdict(message.capture.url,message.submissionId,message.verdict,message.runtime||{});
      const result=message.type==='retry'?await retryReview(message.id):await saveAttempt(message.capture,{kind:message.type==='finish'?'ac':message.type==='submission'?'submission':'draft',note:message.note||'',eventId:message.eventId,submissionId:message.submissionId,verdict:message.verdict});
      let workerError;
      try{await ensureWorker();}catch(e){workerError=e.message;}
      reply({type:'saved',...reviewSummary(result),cached:Boolean(result.cached),workerError,attemptNumber:result.attemptNumber,eventId:result.eventId,finalizationId:result.finalizationId});
    }else if(message.type==='verdict') {
      await recordVerdict(message.url,message.submissionId,message.verdict,message.runtime||{});reply({type:'verdict_saved'});
    }else if(['problem','retry_archive'].includes(message.type)) {
      if(message.type==='retry_archive')await retryArchive(message.url,message.archiveId);
      reply({type:'problem_status',...await problemSummary(message.url)});
      if((await pendingArchives()).some(f=>f.url===message.url))await ensureWorker();
    }else if(message.type==='recent') {
      const history=await reviewHistory({limit:20});
      reply({type:'recent',records:history.records.filter(r=>/^[a-f0-9]{64}$/.test(r.id)).map(r=>{const summary=reviewSummary(r);delete summary.analysis;return summary;})});
      if(history.records.some(r=>['queued','pending','running'].includes(r.status)))await ensureWorker();
    }else if(message.type==='review') {
      const result=await readReview(message.id);reply({type:'review_status',...reviewSummary(result)});
      if(['queued','pending','running'].includes(result.status))await ensureWorker();
    }else reply({type:'error',error:'不支持的操作'});
  }catch(e){reply({type:'error',error:String(e.message).slice(0,2000)});}
},e=>{send({type:'error',error:e.message});process.exitCode=1;process.stdin.destroy();}));
