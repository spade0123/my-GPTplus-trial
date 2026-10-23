import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runSample} from '../src/sample-runner.js';
import {ROOT} from '../src/core.js';
const code='#include <iostream>\nusing namespace std;\nint main(){cout<<3;}',capture={url:'http://bailian.openjudge.cn/practice/1001/',title:'资源限制自拟测试',standard:'c++17',code,problem:{sampleInput:'',sampleOutput:'3'}};
test('real bounded Windows sample programs distinguish CE, TLE, MLE, RE, OLE and an ordinary sample pass',async t=>{
  const config=await fs.readFile(path.join(ROOT,'native/paths.json'),'utf8').then(JSON.parse).catch(()=>null);
  if(process.platform!=='win32'||!config?.compiler){t.skip('Windows and configured C++ compiler required.');return;}
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'oj-resource-test-')),before=process.env.PKU_DATA_DIR;process.env.PKU_DATA_DIR=temp;
  const run=source=>runSample({...capture,code:source},{compiler:config.compiler,memoryLimitMiB:32,runTimeout:350});
  try{
    const good=await run(code);assert.equal(good.status,'passed');assert.equal(good.ranProgram,true);assert.equal(good.memoryLimitEnforced,true);assert(good.peakMemoryBytes>0);assert.equal(good.limits.memoryMiB,32);
    const ce=await run('int main(){ missing_name; }');assert.equal(ce.status,'compile_error');assert.equal(ce.ranProgram,false);assert(ce.compiler.includes('missing_name'));
    const tle=await run('int main(){while(true){}}');assert.equal(tle.status,'timeout');assert(tle.durationMs>=350);
    const mle=await run('#include <vector>\n#include <cstring>\nusing namespace std;\nint main(){vector<char*> v;for(int i=0;i<200;i++){char* p=new char[1024*1024];memset(p,1,1024*1024);v.push_back(p);}}');assert.equal(mle.status,'memory_limit',JSON.stringify(mle));assert.equal(mle.memoryEvidence,'windows-job-limit');assert.equal(mle.memoryLimitEnforced,true);
    const re=await run('int main(){return 7;}');assert.equal(re.status,'runtime_error');assert.equal(re.exitCode,7);
    const fakeMemory=await run('#include <iostream>\nusing namespace std;\nint main(){cerr<<"std::bad_alloc";return 1;}');assert.equal(fakeMemory.status,'runtime_error');assert.equal(fakeMemory.memoryEvidence,null);
    const ole=await run('#include <iostream>\nusing namespace std;\nint main(){for(int i=0;i<200000;i++)cout<<"xxxxxxxx";}');assert.equal(ole.status,'output_limit');assert(ole.actual.length<=65536);
  }finally{if(before===undefined)delete process.env.PKU_DATA_DIR;else process.env.PKU_DATA_DIR=before;await fs.rm(temp,{recursive:true,force:true,maxRetries:4,retryDelay:150});}
});
test('an unavailable compiler is a test environment failure, not a false student CE',async()=>{
  const result=await runSample(capture,{compiler:path.join(os.tmpdir(),'missing-oj-compiler-'+Date.now()+'.exe')});assert.equal(result.status,'runner_error');assert.equal(result.ranProgram,false);
});
