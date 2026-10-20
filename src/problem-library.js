import fs from 'node:fs/promises';
import {openJudgeUrl} from './openjudge-url.js';
let library;
export function readProblemLibrary(){
  library||=fs.readFile(new URL('./problem-library.json',import.meta.url),'utf8').then(JSON.parse).then(value=>{
    const seen=new Set();for(const item of value.items){if(typeof item.key!=='string'||seen.has(item.key)||!openJudgeUrl(item.url,{kind:'problem'}))throw new Error('题库条目无效。');seen.add(item.key);}
    return value;
  });return library;
}
export async function libraryProblem(key){
  if(typeof key!=='string'||key.length>100)throw new Error('请选择题库中的题目。');
  const item=(await readProblemLibrary()).items.find(p=>p.key===key);if(!item)throw new Error('这道题不在内置题库中。');return item;
}
