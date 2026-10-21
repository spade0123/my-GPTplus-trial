import {createHash} from 'node:crypto';
import {getProblem} from './problem-history.js';
import {readReview,formatProblem} from './browser-review.js';

const statement=record=>(record.problem?formatProblem(record.problem):record.statement||'').replace(/\r\n/g,'\n').trim();
// Only the user's own saved, judge-associated AC source for this exact problem
// can serve as a verified reference. Generated suggestions are not answer keys.
export async function hintAnswerContext(capture){
  const problem=await getProblem(capture.url);
  for(const event of [...problem.attempts].reverse()){
    if(event.kind!=='submission'||event.verdict?.source!=='judge-dom'||event.verdict.status!=='AC'||!/^[-a-f0-9]{36}$/i.test(event.submissionId||''))continue;
    try{
      const record=await readReview(event.snapshotId);
      if(record.url!==capture.url||statement(record)!==statement(capture)||typeof record.code!=='string')continue;
      const codeHash=createHash('sha256').update(record.code).digest('hex');
      if(codeHash!==record.codeHash||codeHash!==event.codeHash)continue;
      return {basis:'saved-ac',reference:{source:'own-saved-submission',submissionId:event.submissionId,snapshotId:event.snapshotId,codeHash,standard:record.standard,code:record.code.slice(0,16000),truncated:record.code.length>16000}};
    }catch{/* A missing or damaged reference must not block current-code hints. */}
  }
  return {basis:'problem-inference',reference:null};
}
