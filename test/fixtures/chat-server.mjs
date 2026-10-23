import {createInterface} from 'node:readline';
let next=0;
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line),p=m.params||{},reply=result=>send({id:m.id,result});
 if(m.method==='initialize')reply({userAgent:'test'});
 else if(m.method==='config/read')reply({config:{mcp_servers:{existing:{enabled:true}}}});
 else if(m.method==='thread/start'){
  if(p.config?.mcp_servers?.existing?.enabled!==false)return send({id:m.id,error:{message:'server not isolated'}});
  reply({thread:{id:'t'+(++next),ephemeral:true},sandbox:{type:process.argv.includes('--unsafe')?'dangerFullAccess':'readOnly'}});
 }else if(m.method==='turn/start'){
  const threadId=p.threadId,turnId='turn-'+threadId,itemId='answer-'+threadId;
  reply({turn:{id:turnId,status:'inProgress'}});
  const question=JSON.parse(p.input[0].text).question;
  if(JSON.parse(p.input[0].text).task==='solution_direction_hint'){
   const first='## 解题方向\n读入两个整数，再相加并输出。',answer=first+'\n\n## 对照你的代码\nmain 直接返回，尚未读入数据。\n\n## 下一步\n在 return 前声明 a、b，读入后输出 a+b。\n\n## 手算验证\n1 2 的预期输出为 3，手算未运行。';
   setTimeout(()=>send({method:'item/agentMessage/delta',params:{threadId,turnId,itemId,delta:first}}),5);
   setTimeout(()=>{send({method:'item/completed',params:{threadId,turnId,item:{id:itemId,type:'agentMessage',text:answer}}});send({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});},80);return;
  }
  if(question==='disconnect'){process.exit(1);return;}
  setTimeout(()=>send({method:'item/agentMessage/delta',params:{threadId,turnId,itemId,delta:'先检查边界。'}}),5);
  if(question==='timeout')return;
  if(question==='tool')send({id:'tool-request',method:'item/commandExecution/requestApproval',params:{threadId,turnId}});
  setTimeout(()=>{
   if(question!=='fail'){
    send({method:'item/agentMessage/delta',params:{threadId,turnId,itemId,delta:'然后手算两轮。'}});
    send({method:'item/completed',params:{threadId,turnId,item:{id:itemId,type:'agentMessage',text:'先检查边界。然后手算两轮。'}}});
   }
   send({method:'turn/completed',params:{threadId,turn:{id:turnId,status:question==='fail'?'failed':'completed'}}});
  },80);
 }else if(m.method==='turn/interrupt')reply({});
});
