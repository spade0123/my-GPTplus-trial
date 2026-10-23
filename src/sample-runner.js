import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {dataDir,writeRecord} from './browser-review.js';
import {outputDifference} from './output-diff.js';
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
    const finish=(exitCode,error)=>{if(finished)return;finished=true;clearTimeout(timer);resolve({exitCode,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')+(error?'\n'+error.message:''),launchError:Boolean(error),reason,durationMs:Date.now()-start});};
    child.on('error',e=>finish(null,e));child.on('close',code=>finish(code));child.stdin.on('error',()=>{});child.stdin.end(input);timer=setTimeout(()=>stop('timeout'),timeout);
  });
}
const runnerBuilds=new Map();
async function windowsRunner(compiler){
  const source=new URL('../native/sample-runner.cpp',import.meta.url),text=await fs.readFile(source),directory=path.join(dataDir(),'runner-tools');
  const file=path.join(directory,'windows-'+hash(text.toString()+compiler).slice(0,20)+'.exe');
  if(runnerBuilds.has(file))return runnerBuilds.get(file);
  const building=(async()=>{
    try{await fs.access(file);return file;}catch{}
    await fs.mkdir(directory,{recursive:true});const temp=file+'.'+randomUUID()+'.exe';
    try{
      const result=await execute(compiler,['-std=c++17','-O2','-static','-municode',(await import('node:url')).fileURLToPath(source),'-o',temp],{cwd:directory,timeout:12000});
      if(result.exitCode!==0||result.reason||result.launchError)throw new Error('无法准备本机资源限制运行器：'+result.stderr.slice(0,2000));
      try{await fs.rename(temp,file);}catch(e){try{await fs.access(file);}catch{throw e;}}
      return file;
    }finally{await fs.rm(temp,{force:true}).catch(()=>{});}
  })();runnerBuilds.set(file,building);
  try{return await building;}catch(e){runnerBuilds.delete(file);throw e;}
}
export async function runSample(capture,{compiler=process.env.PKU_CXX||'g++',runTimeout=2500,memoryLimitMiB=256,input=capture.problem.sampleInput,expected=capture.problem.sampleOutput,testKind='sample'}={}){
  if(!Number.isInteger(runTimeout)||runTimeout<20||runTimeout>60000||!Number.isInteger(memoryLimitMiB)||memoryLimitMiB<16||memoryLimitMiB>2048)throw new Error('本机测试资源限制无效。');
  const base=path.resolve(os.tmpdir()),directory=await fs.mkdtemp(path.join(base,'openjudge-sample-'));
  try{
    const source=path.join(directory,'main.cpp'),binary=path.join(directory,process.platform==='win32'?'main.exe':'main');await fs.writeFile(source,capture.code);
    const compilation=await execute(compiler,['-std='+capture.standard,'-O0',source,'-o',binary],{cwd:directory,timeout:8000});
    const limits={timeMs:runTimeout,memoryMiB:process.platform==='win32'?memoryLimitMiB:null,outputKiB:64};
    const common={input,expected:expected??'',expectedProvided:expected!==null,testKind,compiler:compilation.stderr,codeHash:codeHash(capture.code),ranProgram:false,limits,peakMemoryBytes:null,memoryLimitEnforced:false};
    const compared=actual=>expected===null?'executed':compareSample(actual,expected);
    if(compilation.exitCode!==0||compilation.reason||compilation.launchError)return {...common,status:compilation.launchError?'runner_error':compilation.reason==='timeout'?'compile_timeout':compilation.reason==='output_limit'?'compile_output_limit':'compile_error',stage:'compile',actual:'',stderr:'',durationMs:compilation.durationMs};
    if(process.platform==='win32'){
      try{
        const helper=await windowsRunner(compiler),reportFile=path.join(directory,'resources.json');
        const result=await execute(helper,[binary,String(runTimeout),String(memoryLimitMiB*1024*1024),reportFile],{cwd:directory,input:common.input,timeout:runTimeout+2000});
        if(result.reason==='output_limit')return {...common,ranProgram:true,memoryLimitEnforced:true,status:'output_limit',stage:'run',actual:result.stdout,stderr:result.stderr,durationMs:result.durationMs};
        const resource=await fs.readFile(reportFile,'utf8').then(JSON.parse);
        if(resource.errorCode||resource.reason==='runner_error'||!resource.ranProgram)throw new Error('Windows 测试运行器未能执行程序，错误代码 '+resource.errorCode);
        return {...common,ranProgram:true,memoryLimitEnforced:true,status:resource.reason|| (resource.exitCode!==0?'runtime_error':compared(result.stdout)),stage:'run',actual:result.stdout,stderr:result.stderr,exitCode:resource.exitCode,durationMs:resource.durationMs,peakMemoryBytes:resource.peakMemoryBytes||null,memoryEvidence:resource.reason==='memory_limit'?'windows-job-limit':null};
      }catch(e){return {...common,status:'runner_error',stage:'runner',actual:'',stderr:e.message,durationMs:0};}
    }
    const result=await execute(binary,[],{cwd:directory,input:common.input,timeout:runTimeout});
    return {...common,ranProgram:!result.launchError,status:result.launchError?'runner_error':result.reason|| (result.exitCode!==0?'runtime_error':compared(result.stdout)),stage:'run',actual:result.stdout,stderr:result.stderr,exitCode:result.exitCode,durationMs:result.durationMs};
  }finally{if(path.dirname(directory)!==base||!path.basename(directory).startsWith('openjudge-sample-'))throw new Error('测试临时目录不符合范围。');await fs.rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{});}
}
export async function latestSample(url,code){try{return JSON.parse(await fs.readFile(path.join(dataDir(),'sample-runs',key(url,code)+'.latest.json'),'utf8'));}catch{return null;}}
export async function latestLocalRun(url,code){
  const sample=await latestSample(url,code);let custom;
  try{custom=JSON.parse(await fs.readFile(path.join(dataDir(),'sample-runs',key(url,code)+'.custom.latest.json'),'utf8'));}catch{}
  return [sample,custom].filter(Boolean).sort((a,b)=>String(b.completedAt||b.createdAt).localeCompare(String(a.completedAt||a.createdAt)))[0]||null;
}
export async function saveSampleRequest(capture,actionId,testSpec){
  const directory=path.join(dataDir(),'sample-runs');await fs.mkdir(directory,{recursive:true});
  const id=hash('sample:'+actionId),file=path.join(directory,id+'.json');
  try{const prior=JSON.parse(await fs.readFile(file,'utf8'));if(prior.codeHash!==codeHash(capture.code)||prior.capture.url!==capture.url||JSON.stringify(prior.testSpec)!==JSON.stringify(testSpec))throw new Error('同一测试事件不能用于不同代码或测试数据。');return prior;}catch(error){if(error.code!=='ENOENT')throw error;}
  const record={id,actionId,status:'running',createdAt:new Date().toISOString(),capture,testSpec,codeHash:codeHash(capture.code)};await writeRecord(file,record);return record;
}
export async function finishSample(record,result){
  if(result.expectedProvided!==false&&typeof result.expected==='string'&&typeof result.actual==='string')result={...result,difference:outputDifference(result.actual,result.expected)};
  const complete={...record,status:'complete',completedAt:new Date().toISOString(),result};
  const directory=path.join(dataDir(),'sample-runs');await writeRecord(path.join(directory,record.id+'.json'),complete);await writeRecord(path.join(directory,key(record.capture.url,record.capture.code)+(record.testSpec?'.custom.latest.json':'.latest.json')),complete);return complete;
}
