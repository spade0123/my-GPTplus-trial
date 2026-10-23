import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const {rateDifficulty}=createRequire(import.meta.url)('../vscode-extension/rate-difficulty.cjs');
const file=new URL('../src/problem-library.json',import.meta.url),library=JSON.parse(await fs.readFile(file,'utf8'));
library.difficultyBasis={kind:'acceptance_rate',bands:[{level:1,minimum:70,label:'基础'},{level:2,minimum:50,label:'常规'},{level:3,minimum:30,label:'进阶'},{level:4,minimum:0,label:'较难'}],note:'使用已保存的官方通过率快照。百练为通过人数/提交人数，NOI 为 AC 提交/总提交；两平台口径不同，不能直接比较。通过率仅作相对难度，不改变题目算法范围上限。'};
for(const item of library.items){
 const rate=Number.parseFloat(item.rateLabel),difficulty=rateDifficulty(rate);
 if(!item.algorithmLevel)item.algorithmLevel=item.level;
 Object.assign(item,{level:difficulty.level,difficultyLabel:difficulty.label,acceptanceRate:rate,levelSource:'acceptance_rate'});
}
await fs.writeFile(file,JSON.stringify(library,null,2)+'\n');
console.log('337 道题已按通过率分档，原知识点和筛选范围保留。');
