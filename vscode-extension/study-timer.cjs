const vscode=require('vscode');
const KEY='gridCoach.studyTimer.v1',MAX_DURATION=7*24*60*60*1000;
const positive=value=>Number.isFinite(value)&&value>=0;
const initial=()=>({mode:'stopwatch',stopwatch:{elapsed:0,startedAt:null},countdown:{duration:25*60*1000,remaining:25*60*1000,deadline:null,finished:false}});

// The extension owns the clock; the webview only paints timestamp differences.
// Persist timestamps so hiding the view or reloading VS Code cannot pause time.
class StudyTimer{
  constructor(context,onChange){
    this.context=context;this.onChange=onChange;this.queue=Promise.resolve();
    this.state=this.restore(context.workspaceState.get(KEY));
    this.interval=setInterval(()=>void this.enqueue(()=>this.checkFinished()).catch(()=>{}),1000);
    context.subscriptions.push({dispose:()=>clearInterval(this.interval)});
    void this.enqueue(()=>this.checkFinished()).catch(()=>{});
  }
  restore(saved){
    const state=initial();if(!saved||typeof saved!=='object')return state;
    if(['stopwatch','countdown'].includes(saved.mode))state.mode=saved.mode;
    const s=saved.stopwatch,c=saved.countdown;
    if(s&&positive(s.elapsed)&&(s.startedAt===null||positive(s.startedAt)))state.stopwatch={elapsed:s.elapsed,startedAt:s.startedAt};
    if(c&&positive(c.duration)&&c.duration>0&&c.duration<=MAX_DURATION&&positive(c.remaining)&&c.remaining<=c.duration&&(c.deadline===null||positive(c.deadline)))state.countdown={duration:c.duration,remaining:c.remaining,deadline:c.deadline,finished:c.finished===true};
    return state;
  }
  snapshot(){return structuredClone(this.state);}
  enqueue(action){
    const pending=this.queue.then(action);
    this.queue=pending.catch(error=>{void vscode.window.showErrorMessage('计时器保存失败：'+error.message);});
    return pending;
  }
  async publish(){
    await this.context.workspaceState.update(KEY,this.snapshot());
    await this.onChange(this.snapshot());
  }
  async checkFinished(){
    const c=this.state.countdown;
    if(c.deadline!==null&&c.deadline<=Date.now()){
      Object.assign(c,{remaining:0,deadline:null,finished:true});
      await this.publish();
      void vscode.window.showInformationMessage('编程网格：倒计时结束。');
    }
  }
  handle(message){return this.enqueue(async()=>{
    await this.checkFinished();
    const now=Date.now(),s=this.state.stopwatch,c=this.state.countdown;
    switch(message.action){
      case 'mode':if(!['stopwatch','countdown'].includes(message.mode))return;this.state.mode=message.mode;break;
      case 'stopwatch_start':if(s.startedAt===null)s.startedAt=now;break;
      case 'stopwatch_pause':if(s.startedAt!==null){s.elapsed+=Math.max(0,now-s.startedAt);s.startedAt=null;}break;
      case 'stopwatch_reset':Object.assign(s,{elapsed:0,startedAt:null});break;
      case 'countdown_start':{
        const duration=message.durationMs;
        if(!Number.isSafeInteger(duration)||duration<=0||duration>MAX_DURATION)throw new Error('倒计时时长须大于 0，最多 7 天。');
        if(c.deadline!==null)return;
        if(duration!==c.duration||c.remaining===0){c.duration=duration;c.remaining=duration;}
        c.finished=false;c.deadline=now+c.remaining;break;
      }
      case 'countdown_pause':if(c.deadline!==null){c.remaining=Math.max(0,c.deadline-now);c.deadline=null;}break;
      case 'countdown_reset':Object.assign(c,{remaining:c.duration,deadline:null,finished:false});break;
      default:return;
    }
    await this.publish();
  });}
}
module.exports={StudyTimer};
