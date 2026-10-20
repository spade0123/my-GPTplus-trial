import {createHash} from 'node:crypto';

function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function resultFingerprint(runtime) {
  return hash(Object.fromEntries(['input','output','hints','error','status','text'].map(key=>[key,runtime?.[key]||''])));
}
export function attemptContentKey(event) {
  const verdict=event.verdict?Object.fromEntries(Object.entries(event.verdict).filter(([key])=>!['observedAt','capturedAt','identity','submissionId'].includes(key))):null;
  return hash({snapshotId:event.snapshotId,title:event.title||'',kind:event.kind,note:event.note||'',verdict,resultFingerprint:event.resultFingerprint||null});
}

export function groupIdenticalAttempts(attempts) {
  const groups=[],byContent=new Map();
  for(const attempt of attempts) {
    const key=attempt.contentKey||attemptContentKey(attempt);
    let group=byContent.get(key);
    if(!group) {
      group={...attempt,contentKey:key,occurrenceCount:0,occurrences:[],numbers:[]};
      byContent.set(key,group);groups.push(group);
    }
    group.occurrenceCount++;
    group.numbers.push(attempt.number);
    group.lastNumber=attempt.number;
    group.lastSavedAt=attempt.savedAt;
    // Keep every receipt and position so merging never breaks AC correlation or A -> B -> A.
    group.occurrences.push({id:attempt.id,number:attempt.number,savedAt:attempt.savedAt,submissionId:attempt.submissionId,
      ...(attempt.origin?{origin:attempt.origin}:{}),
      ...(attempt.verdict?{verdict:attempt.verdict}:{}),...(attempt.resultRuntimeFile?{resultRuntimeFile:attempt.resultRuntimeFile}:{})});
  }
  return groups;
}
