const {StudyTimer}=require('./study-timer.cjs');
const INDEX='gridCoach.questionTimes.v1',SCOPE='gridCoach.timerScope.v1';
const running=state=>state.stopwatch.startedAt!==null||state.countdown.deadline!==null;
function identity(url){try{const m=new URL(url).pathname.match(/\/probset\/([a-f0-9]{32})\/([a-f0-9]{32})\/ide\.do$/i);return m?{group:m[1].toLowerCase(),key:m[1].toLowerCase()+'/'+m[2].toLowerCase(),url}:null;}catch{return null;}}
class ProblemTimers{
  constructor(context,{onState,onTimes}){
    Object.assign(this,{context,onState,onTimes});this.questions=new Map();this.assignments=new Map();this.scope=context.workspaceState.get(SCOPE,'problem');
    this.times={...context.workspaceState.get(INDEX,{})};this.writes=Promise.resolve();this.changes=Promise.resolve();
    this.fallback=new StudyTimer(context,()=>this.publishState());
  }
  question(target){
    if(!this.questions.has(target.key)){
      const timer=new StudyTimer(this.context,async state=>{
        this.times[target.key]={url:target.url,elapsed:state.spent.elapsed,startedAt:state.spent.startedAt};
        const snapshot=structuredClone(this.times);
        this.writes=this.writes.catch(()=>{}).then(()=>this.context.workspaceState.update(INDEX,snapshot));await this.writes;
        await this.onTimes(this.timeSnapshot());if(this.current?.key===target.key&&this.scope==='problem')await this.publishState();
      },{key:'gridCoach.questionTimer.v1.'+target.key,label:'本题计时'});
      this.questions.set(target.key,timer);
    }
    return this.questions.get(target.key);
  }
  assignment(group){
    if(!this.assignments.has(group)){
      const entry={timer:null,wasRunning:false,deadline:null};
      entry.timer=new StudyTimer(this.context,async state=>{
        const active=running(state),was=entry.wasRunning,oldDeadline=entry.deadline;
        entry.wasRunning=active;entry.deadline=state.countdown.deadline;
        if(this.current?.group===group&&active!==was){
          const question=this.question(this.current);
          if(active&&!running(question.state))await question.handle({action:'stopwatch_start'});
          if(!active)await question.handle({action:'suspend',...(state.countdown.finished&&oldDeadline?{at:oldDeadline}:{})});
        }
        if(this.current?.group===group&&this.scope==='assignment')await this.publishState();
      },{key:'gridCoach.assignmentTimer.v1.'+group,label:'整套计时'});
      entry.wasRunning=running(entry.timer.state);entry.deadline=entry.timer.state.countdown.deadline;
      this.assignments.set(group,entry);
    }
    return this.assignments.get(group).timer;
  }
  selected(){return this.current?(this.scope==='assignment'?this.assignment(this.current.group):this.question(this.current)):this.fallback;}
  stateSnapshot(){return {...this.selected().snapshot(),scope:this.scope,scopeLabel:this.scope==='assignment'?'整套':'本题',contextKey:this.current?.key||'',hasProblem:Boolean(this.current)};}
  timeSnapshot(){return {type:'problem_timing',items:Object.values(this.times)};}
  async publishState(){await this.onState(this.stateSnapshot());}
  setProblem(url){
    const next=identity(url);
    this.changes=this.changes.catch(()=>{}).then(async()=>{
      if(this.current?.key===next?.key)return;
      if(this.current)await this.question(this.current).handle({action:'suspend'});
      else {
        await this.fallback.handle({action:'suspend'});
        for(const entry of Object.values(this.times)){
          const old=identity(entry.url);if(!old||old.key===next?.key||entry.startedAt===null)continue;
          const total=this.context.workspaceState.get('gridCoach.assignmentTimer.v1.'+old.group),deadline=total?.countdown?.deadline;
          const at=deadline&&deadline<Date.now()&&total.stopwatch?.startedAt===null?deadline:Date.now();
          await this.question(old).handle({action:'suspend',at});
        }
      }
      this.current=next;
      if(next){
        const total=this.assignment(next.group);await total.checkFinished();
        const question=this.question(next);await question.checkFinished();
        // Reopening the page resumes from stored timestamps; moving between
        // questions only runs the currently visible question while a set runs.
        if(running(total.state)&&!running(question.state))await question.handle({action:'stopwatch_start'});

      }
      await this.publishState();await this.onTimes(this.timeSnapshot());
    });
    return this.changes;
  }
  async handle(message){
    await this.changes;
    if(message.action==='scope'){
      if(!['problem','assignment'].includes(message.scope))return;
      if(message.scope==='assignment'&&!this.current)throw new Error('请先打开题目，再使用整套计时。');
      this.scope=message.scope;await this.context.workspaceState.update(SCOPE,this.scope);await this.publishState();return;
    }
    if(this.scope==='assignment'&&!this.current)throw new Error('请先打开题目，再使用整套计时。');
    if(message.contextKey!==(this.current?.key||''))throw new Error('题目已改变，请重试计时操作。');
    const {at,...safe}=message;await this.selected().handle(safe);
  }
}
module.exports={ProblemTimers};
