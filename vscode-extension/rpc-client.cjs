const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
class RpcClient{
  constructor(node,root,onError=()=>{},onEvent=()=>{}){
    this.next=0;this.pending=new Map();this.onError=onError;
    this.child=spawn(node,[require('node:path').join(root,'src/vscode-host.js')],{cwd:root,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    this.stderr='';this.child.stderr.on('data',b=>{this.stderr=(this.stderr+b.toString()).slice(-1500);});
    this.child.stdin.on('error',()=>{});
    this.lines=createInterface({input:this.child.stdout});this.lines.on('line',line=>{
      try{const reply=JSON.parse(line);if(reply.event){onEvent(reply);return;}const item=this.pending.get(reply.requestId);if(!item)return;clearTimeout(item.timer);this.pending.delete(reply.requestId);reply.error?item.reject(new Error(reply.error)):item.resolve(reply.result);}catch{}
    });
    const fail=why=>{for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error(why));}this.pending.clear();this.closed=true;this.onError(why);};
    this.child.once('error',e=>fail('本机程序无法启动：'+e.message));
    this.child.once('close',()=>fail('本机连接已关闭，请检查 Node 和安装配置。'+this.stderr));
  }
  request(message){
    if(this.closed)return Promise.reject(new Error('本机连接不可用，请重新打开教练。'));
    const id=++this.next;
    return new Promise((resolve,reject)=>{
      const timeout={list_problems:18000,activate_problem:22000,oj_submit:45000,oj_refresh:30000,oj_prepare:20000,grid_test:45000,grid_test_refresh:30000,run_sample:25000}[message.type]||22000;
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('本机程序未及时确认，本次操作尚未确认成功。'));},timeout);
      this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({...message,requestId:id})+'\n',e=>{if(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});
    });
  }
  dispose(){this.lines.close();this.child.stdin.end();}
}
module.exports={RpcClient};
