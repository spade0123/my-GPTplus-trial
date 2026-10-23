import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './core.js';
import { frame, decoder } from './native-protocol.js';
import { readReview,reviewSummary,reviewHistory } from './browser-review.js';
import {ensureWorker,retryReview} from './review-queue.js';
import {saveAttempt,problemSummary,recordVerdict} from './problem-history.js';
import {retryArchive,pendingArchives} from './final-archive.js';
import {queueHint,queueDiscussion,discussionHistory,hintHistory,assistHistory,readHint,hintSummary,ensureHintWorker,queuedHints} from './hint-review.js';
import {createMigrationSink} from './browser-migration.js';
import {readModelSettings,readModelCatalog,saveModelSettings} from './model-settings.js';
import {listVersions,readVersion} from './version-history.js';
const config=JSON.parse(await fs.readFile(path.join(ROOT,'native/paths.json'),'utf8'));
if(process.argv[2]!==`chrome-extension://${config.extensionId}/`)process.exit(2);
process.env.PKU_CODEX=config.codex;process.env.PKU_CXX=config.compiler;
const send=value=>process.stdout.write(frame(value));
const migration=createMigrationSink();
process.stdin.on('data',decoder(async message=>{
  const reply=value=>send({...value,requestId:message.requestId,requestType:message.type,actionId:message.actionId});
  if(message.type==='status'){reply({type:'status',version:'1.9.0',ready:true});return;}
  try {
    if(message.type==='model_settings'){reply({type:'model_settings',settings:await readModelSettings(),catalog:await readModelCatalog({refresh:Boolean(message.refresh)})});return;}
    if(message.type==='save_model_settings'){reply({type:'model_settings_saved',settings:await saveModelSettings(message.settings)});return;}
    if(message.type==='versions'){reply({type:'versions',...await listVersions(message.url)});return;}
    if(message.type==='version_read'){reply({type:'version_read',...await readVersion(message.url,message.eventId,message.currentCode)});return;}
    if(['migration_begin','migration_chunk','migration_commit','migration_verify'].includes(message.type)){
      reply(await migration.handle(message));return;
    }
    if(['save','analyze','quick_save','hint','discuss','submission','finish','retry'].includes(message.type)) {
      if(message.type==='finish')await recordVerdict(message.capture.url,message.submissionId,message.verdict,message.runtime||{});
      const result=message.type==='retry'?await retryReview(message.id):await saveAttempt(message.capture,{kind:message.type==='finish'?'ac':message.type==='submission'?'submission':'draft',note:message.note||'',eventId:message.eventId,submissionId:message.submissionId,verdict:message.verdict,origin:message.type==='discuss'?'discussion':message.type==='hint'?'hint_request':message.type==='quick_save'?'quick_save':undefined});
      let workerError,hintWorkerError,hint,hintError;
      if(['hint','discuss'].includes(message.type))try{
        const options={judgeEvidence:message.judgeEvidence,question:message.question,purpose:message.purpose,selectedCode:message.selectedCode,eventId:result.eventId,attemptNumber:result.attemptNumber,requestedAt:message.requestedAt,force:message.force===true};
        hint=hintSummary(message.type==='hint'?await queueHint(result.id,options):await queueDiscussion(result.id,options));
      }catch(error){hintError=error.message;}
      const launches=await Promise.allSettled([ensureWorker(),hint&&hint.status==='queued'?ensureHintWorker(hint.kind||'hint'):Promise.resolve()]);
      if(launches[0].status==='rejected')workerError=launches[0].reason.message;
      if(launches[1].status==='rejected')hintWorkerError=launches[1].reason.message;
      reply({type:'saved',...reviewSummary(result),cached:Boolean(result.cached),workerError,hint,hintError,hintWorkerError,attemptNumber:result.attemptNumber,eventId:result.eventId,finalizationId:result.finalizationId});
    }else if(message.type==='discussion_history'){
      reply({type:'discussion_history',...await discussionHistory(message.url)});
    }else if(message.type==='hint_history'){
      reply({type:'hint_history',...await hintHistory(message.url)});
    }else if(message.type==='assist_history'){
      reply({type:'assist_history',...await assistHistory(message.url)});
    }else if(['hint_status','hint_retry'].includes(message.type)){
      let hint=await readHint(message.id);
      if(message.type==='hint_retry'&&hint.status==='failed')hint=hint.kind==='discussion'?await queueDiscussion(hint.snapshotId,{question:hint.question,purpose:hint.purpose,selectedCode:hint.selectedCode,eventId:hint.eventId}):await queueHint(hint.snapshotId,{judgeEvidence:hint.judgment});
      reply({type:'hint_status',...hintSummary(hint)});
      if(hint.status==='queued')await ensureHintWorker(hint.kind||'hint');
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
      for(const kind of new Set((await queuedHints()).map(job=>job.kind||'hint')))await ensureHintWorker(kind);
    }else if(message.type==='review') {
      const result=await readReview(message.id);reply({type:'review_status',...reviewSummary(result)});
      if(['queued','pending','running'].includes(result.status))await ensureWorker();
    }else reply({type:'error',error:'不支持的操作'});
  }catch(e){reply({type:'error',error:String(e.message).slice(0,2000)});}
},e=>{send({type:'error',error:e.message});process.exitCode=1;process.stdin.destroy();}));
