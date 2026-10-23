import {createHash} from 'node:crypto';
import {createTwoFilesPatch} from 'diff';
import {getProblem} from './problem-history.js';
import {readReview,captureFromRecord} from './browser-review.js';


function problemUrl(url){const u=new URL(url);if(u.origin!=='https://programming.pku.edu.cn'||!/^\/probset\/[a-f0-9]{32}\/[a-f0-9]{32}\/ide\.do$/.test(u.pathname)||u.username||u.password)throw new Error('题目地址无效。');return u.origin+u.pathname;}
export async function listVersions(url){
  const problem=await getProblem(problemUrl(url)),groups=[];
  for(const attempt of problem.attempts){
    const previous=groups.at(-1);
    if(previous?.codeHash===attempt.codeHash){previous.eventId=attempt.id;previous.lastNumber=attempt.number;previous.savedAt=attempt.savedAt;previous.occurrenceCount++;if(attempt.verdict)previous.verdict=attempt.verdict.status;}
    else groups.push({eventId:attempt.id,snapshotId:attempt.snapshotId,codeHash:attempt.codeHash,firstNumber:attempt.number,lastNumber:attempt.number,savedAt:attempt.savedAt,occurrenceCount:1,verdict:attempt.verdict?.status,origin:attempt.origin});
  }
  return {url:problem.url,title:problem.title,totalEvents:problem.attempts.length,uniqueVersions:new Set(problem.attempts.map(a=>a.codeHash)).size,versions:groups.reverse().slice(0,200),truncated:groups.length>200};
}
export async function readVersion(url,eventId,currentCode=''){
  const problem=await getProblem(problemUrl(url)),attempt=problem.attempts.find(a=>a.id===eventId);
  if(!attempt)throw new Error('该题没有这个历史版本。');
  if(typeof currentCode!=='string'||currentCode.length>100000)throw new Error('待比较的当前代码无效。');
  const record=await readReview(attempt.snapshotId),capture=await captureFromRecord(record);
  if(problemUrl(capture.url)!==problemUrl(url)||record.codeHash!==createHash('sha256').update(capture.code).digest('hex'))throw new Error('历史快照校验失败，已停止读取。');
  return {eventId,number:attempt.number,savedAt:attempt.savedAt,title:capture.title,codeHash:record.codeHash,code:capture.code,standard:capture.standard,verdict:attempt.verdict,modelConfig:record.modelConfig,diff:createTwoFilesPatch('saved-version.cpp','current-buffer.cpp',capture.code,currentCode),sameCode:capture.code===currentCode};
}
