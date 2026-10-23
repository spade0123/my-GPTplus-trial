class SubmissionMonitor{
 constructor({refresh,notify,delay=2000,limit=30,onError=()=>{}}){Object.assign(this,{refresh,notify,delay,limit,onError});this.jobs=new Map();this.latest=new Map();this.closed=false;}
 key(state){return state.uri+'\n'+state.problemUrl;}
 remember(state,result){
  if(this.closed||!result?.id)return;
  const key=this.key(state),previous=this.latest.get(key);
  if(previous&&previous.id!==result.id&&String(previous.createdAt)>String(result.createdAt))return;
  const value={...result,requestType:'oj_monitor',autoRefreshManaged:true};this.latest.set(key,value);this.notify(state,value);
  const pending=!result.error&&(!result.submission||['pending','unknown'].includes(result.submission.verdict?.status));
  const current=this.jobs.get(key);if(current?.id===result.id){if(!pending){clearTimeout(current.timer);this.jobs.delete(key);}return;}
  if(current)clearTimeout(current.timer);this.jobs.delete(key);
  if(pending){const job={id:result.id,state:{uri:state.uri,problemUrl:state.problemUrl},attempts:0};this.jobs.set(key,job);this.schedule(key,job);}
 }
 schedule(key,job){job.timer=setTimeout(async()=>{
  if(this.closed||this.jobs.get(key)!==job)return;
  try{const value=await this.refresh(job.id);if(this.closed||this.jobs.get(key)!==job)return;this.remember(job.state,value);}
  catch(e){this.onError(e);}
  if(this.jobs.get(key)===job){if(++job.attempts<this.limit)this.schedule(key,job);else this.jobs.delete(key);}
 },this.delay);job.timer.unref?.();}
 get(state){return this.latest.get(this.key(state));}
 dispose(){this.closed=true;for(const job of this.jobs.values())clearTimeout(job.timer);this.jobs.clear();this.latest.clear();}
}
module.exports={SubmissionMonitor};
