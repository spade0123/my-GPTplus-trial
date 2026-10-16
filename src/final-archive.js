import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ROOT} from './core.js';
import {Report,processAlive} from './browser-review.js';
import {problemManifests,timeline,updateProblem,codeDiff} from './problem-history.js';
import {runModel} from './model-runner.js';

export async function pendingArchives() {
  const result=[];
  for(const p of await problemManifests())for(const f of p.finalizations)if(['queued','waiting_reports'].includes(f.status)||(f.status==='building'&&!processAlive(f.workerPid)))result.push({url:p.url,problemId:p.id,...f});
  return result;
}
async function patchFinal(url,id,fields){return updateProblem(url,p=>{const f=p.finalizations.find(x=>x.id===id);if(!f)throw new Error('完成记录不存在。');Object.assign(f,fields);return {...f};});}
const sha=text=>createHash('sha256').update(text).digest('hex');
const bundleFiles=['DEBUG.md','README.md','solution.cpp'];
export async function readBundle(directory) {
  const markerText=await fs.readFile(path.join(directory,'.pku-coach.json'),'utf8'),marker=JSON.parse(markerText);
  if(JSON.stringify(marker.files.map(f=>f.path).sort())!==JSON.stringify(bundleFiles))throw new Error('归档文件列表与最终版本范围不一致。');
  const files=[];
  for(const entry of marker.files){const content=await fs.readFile(path.join(directory,entry.path),'utf8');if(sha(content)!==entry.sha256)throw new Error('归档内容已改变，请检查后重试。');files.push({path:entry.path,content});}
  if(sha(JSON.stringify(marker.files))!==marker.bundleHash)throw new Error('归档校验标记无效。');
  files.push({path:'.pku-coach.json',content:markerText});return {marker,files};
}
function cell(value){return String(value||'').replace(/\r?\n/g,' ').replace(/\|/g,'\\|');}
export async function makeBundle(problem,finalization,{model=runModel,archiveRoot=process.env.PKU_ARCHIVE_DIR||path.join(ROOT,'archives')}={}) {
  const attempts=problem.attempts.filter(a=>a.number<=finalization.eventNumber),last=attempts.at(-1);
  const problemUuid=new URL(problem.url).pathname.split('/')[3];
  const directory=path.join(archiveRoot,problemUuid,finalization.id);
  try {
    const {marker}=await readBundle(directory);
    if(marker.archiveId!==finalization.id||marker.finalCodeHash!==last.codeHash)throw new Error('本地归档冲突。');
    return {directory,marker};
  }catch(e){if(e.code!=='ENOENT')throw e;}
  const history=attempts.map((a,i)=>({number:a.number,kind:a.kind,note:a.note,codeHash:a.codeHash,savedAt:a.savedAt,verdict:a.verdict,analysisEvidence:a.record.evidence||null,reportStatus:a.record.status,diff:i?codeDiff(attempts[i-1].record.code,a.record.code).slice(0,6000):null,runtime:{input:(a.runtime.input||'').slice(0,2000),output:(a.runtime.output||'').slice(0,3000),hints:(a.runtime.hints||'').slice(0,2000),error:(a.runtime.error||'').slice(0,3000),status:a.runtime.status||''}}));
  const selected=history.length>20?[...history.slice(0,2),...history.slice(-18)]:history;
  const report=Report.parse(await model({task:'final_debug_retrospective',capture:{url:problem.url,title:problem.title,code:last.record.code,problem:last.record.problem,statement:last.record.statement,standard:last.record.standard,runtime:last.runtime},diagnostics:last.record.compiler||null,debugHistory:{totalAttempts:attempts.length,omittedFromModelContext:history.length-selected.length,attempts:selected},completionEvidence:finalization.verdict}));
  const files={};
  files['solution.cpp']=last.record.code+'\n';
  const table=['| 次数 | 时间（UTC） | 阶段 | 源码哈希 | 修改备注 |','| --- | --- | --- | --- | --- |'];
  const debug=['# 代码修改与 debug 时间线','','记录仅反映已保存/已提交的快照；没有记录的中间编辑和个人推理不可还原。',''];
  for(let i=0;i<attempts.length;i++) {
    const a=attempts[i],kind={draft:'过程保存',submission:'提交评测',ac:'页面评测 AC',legacy:'旧版记录'}[a.kind]||a.kind;
    table.push(`| ${a.number} | ${a.savedAt} | ${kind} | ${a.codeHash.slice(0,12)} | ${cell(a.note)} |`);
    debug.push(`## 第 ${a.number} 次：${kind}`,'',`时间：${a.savedAt}；源码哈希：${a.codeHash}。`,'',`备注：${a.note||'未填写；不推断用户的修改意图。'}`,'');
    if(a.verdict)debug.push(`页面评测：${a.verdict.status}（${cell(a.verdict.text)}）。`,'');
    if(i)debug.push(a.codeHash===attempts[i-1].codeHash?'源码未变化，本次主要记录提交或运行状态。':'源码发生变化；逐行 diff 和过程源码独立保存在本地。','');
    if(a.record.evidence)debug.push(a.record.evidence,'');
  }
  files['DEBUG.md']=debug.join('\n');
  files['README.md']=[`# ${problem.title}`,'',`题目来源：[北大课程平台](${problem.url})。`,'','完成依据：页面评测区域显示 AC，且关联的提交源码哈希与最终代码一致；不是学习教练独立重跑在线评测。','',`最终代码：[solution.cpp](solution.cpp)；修改和 debug 总结：[DEBUG.md](DEBUG.md)。过程源码和运行快照独立保存在本地。`,'',report.markdown,'','## 保存与提交记录','',...table,'','## 本地构建','',`语言标准：${last.record.standard||'c++17'}。`,'','```sh',`g++ -std=${last.record.standard||'c++17'} -Wall -Wextra solution.cpp -o solution`,'```',''].join('\n');
  const entries=Object.entries(files).sort(([a],[b])=>a.localeCompare(b)).map(([name,content])=>({path:name,sha256:sha(content)}));
  const marker={schemaVersion:1,archiveId:finalization.id,problemUuid,sourceUrl:problem.url,finalCodeHash:last.codeHash,bundleHash:sha(JSON.stringify(entries)),files:entries};
  files['.pku-coach.json']=JSON.stringify(marker,null,2)+'\n';
  const staging=directory+`.building-${randomUUID()}`;await fs.mkdir(staging,{recursive:true});
  for(const [name,content] of Object.entries(files)){const target=path.join(staging,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content,{flag:'wx'});}
  await fs.rename(staging,directory);
  return {directory,marker};
}
export async function processArchives({model=runModel,archiveRoot}={}) {
  const observed=[],processed=[];
  for(const item of await pendingArchives()) {
    observed.push(item.id);
    const problem=await timeline(item.url,{throughNumber:item.eventNumber});
    if(problem.attempts.some(a=>['queued','pending','running'].includes(a.record.status))){await patchFinal(item.url,item.id,{status:'waiting_reports'});continue;}
    try {
      await patchFinal(item.url,item.id,{status:'building',workerPid:process.pid,error:null});
      const bundle=await makeBundle(problem,item,{model,archiveRoot});
      await patchFinal(item.url,item.id,{status:'complete',localDirectory:bundle.directory,bundleHash:bundle.marker.bundleHash,completedAt:new Date().toISOString(),error:null});
      processed.push(item.id);
    }catch(e){await patchFinal(item.url,item.id,{status:'failed',error:String(e.message).slice(0,2000)});}
  }
  return {observed,processed};
}
export async function retryArchive(url,id) {return patchFinal(url,id,{status:'queued',error:null});}
