import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dataDir,writeRecord} from './browser-review.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
export const codeHash=code=>hash(code.replace(/\r\n/g,'\n').trim());
const key=(url,code)=>hash(url+':'+codeHash(code));
const normal=text=>text.replace(/\r\n?/g,'\n').replace(/\n$/,'');
export function compareSample(actual,expected){
  if(normal(actual)===normal(expected))return 'passed';
  if(actual.trim().split(/\s+/).join(' ')===expected.trim().split(/\s+/).join(' '))return 'whitespace';
  return 'wrong_answer';
}
async function execute(command,args,{cwd,input='',timeout=2500,limit=65536}={}){
  return new Promise(resolve=>{
    const start=Date.now(),child=spawn(command,args,{cwd,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']}),stdout=[],stderr=[];let bytes=0,reason,timer,finished=false;
    const stop=why=>{if(reason)return;reason=why;if(process.platform==='win32'&&child.pid){const killer=spawn('taskkill.exe',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill());}else child.kill('SIGKILL');};
    const collect=(list,buffer)=>{bytes+=buffer.length;if(bytes>limit){stop('output_limit');return;}list.push(buffer);};
    child.stdout.on('data',b=>collect(stdout,b));child.stderr.on('data',b=>collect(stderr,b));
    const finish=(exitCode,error)=>{if(finished)return;finished=true;clearTimeout(timer);resolve({exitCode,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')+(error?'\n'+error.message:''),reason,durationMs:Date.now()-start});};
    child.on('error',e=>finish(null,e));child.on('close',code=>finish(code));child.stdin.on('error',()=>{});child.stdin.end(input);timer=setTimeout(()=>stop('timeout'),timeout);
  });
}
export async function runSample(capture,{compiler=process.env.PKU_CXX||'g++',runTimeout=2500}={}){
  const base=path.resolve(os.tmpdir()),directory=await fs.mkdtemp(path.join(base,'openjudge-sample-'));
  try{
    const source=path.join(directory,'main.cpp'),binary=path.join(directory,process.platform==='win32'?'main.exe':'main');await fs.writeFile(source,capture.code);
    const compilation=await execute(compiler,['-std='+capture.standard,'-O0',source,'-o',binary],{cwd:directory,timeout:8000});
    const common={input:capture.problem.sampleInput,expected:capture.problem.sampleOutput,compiler:compilation.stderr,codeHash:codeHash(capture.code),ranProgram:false};
    if(compilation.exitCode!==0||compilation.reason)return {...common,status:compilation.reason||'compile_error',stage:'compile',actual:'',stderr:'',durationMs:compilation.durationMs};
    const result=await execute(binary,[],{cwd:directory,input:common.input,timeout:runTimeout});
    return {...common,ranProgram:true,status:result.reason|| (result.exitCode!==0?'runtime_error':compareSample(result.stdout,common.expected)),stage:'run',actual:result.stdout,stderr:result.stderr,exitCode:result.exitCode,durationMs:result.durationMs};
  }finally{if(path.dirname(directory)!==base||!path.basename(directory).startsWith('openjudge-sample-'))throw new Error('测试临时目录不符合范围。');await fs.rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{});}
}
export async function latestSample(url,code){try{return JSON.parse(await fs.readFile(path.join(dataDir(),'sample-runs',key(url,code)+'.latest.json'),'utf8'));}catch{return null;}}
export async function saveSampleRequest(capture,actionId){
  const directory=path.join(dataDir(),'sample-runs');await fs.mkdir(directory,{recursive:true});
  const id=hash('sample:'+actionId),file=path.join(directory,id+'.json');
  try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{}
  const record={id,actionId,status:'running',createdAt:new Date().toISOString(),capture,codeHash:codeHash(capture.code)};await writeRecord(file,record);return record;
}
export async function finishSample(record,result){
  const complete={...record,status:'complete',completedAt:new Date().toISOString(),result};
  const directory=path.join(dataDir(),'sample-runs');await writeRecord(path.join(directory,record.id+'.json'),complete);await writeRecord(path.join(directory,key(record.capture.url,record.capture.code)+'.latest.json'),complete);return complete;
}
