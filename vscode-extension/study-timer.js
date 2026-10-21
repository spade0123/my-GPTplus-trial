(()=>{
  const api=globalThis.gridProblemApi,$=id=>document.getElementById(id);
  let state,pending=false,errorText='';
  const format=(ms,ceil=false)=>{
    const total=Math.max(0,ceil?Math.ceil(ms/1000):Math.floor(ms/1000));
    return [Math.floor(total/3600),Math.floor(total/60)%60,total%60].map(value=>String(value).padStart(2,'0')).join(':');
  };
  function paint(){
    if(!state)return;
    const countdown=state.mode==='countdown',s=state.stopwatch,c=state.countdown,now=Date.now();
    const running=countdown?c.deadline!==null:s.startedAt!==null;
    $('timerStopwatch').setAttribute('aria-pressed',String(!countdown));
    $('timerCountdown').setAttribute('aria-pressed',String(countdown));
    $('timerDuration').hidden=!countdown;
    $('timerDisplay').textContent=countdown?format(c.deadline===null?c.remaining:c.deadline-now,true):format(s.elapsed+(s.startedAt===null?0:Math.max(0,now-s.startedAt)));
    $('timerDisplay').classList.toggle('finished',countdown&&c.finished);
    $('timerStart').textContent=running?'暂停':countdown&&c.finished?'重新开始':(countdown?c.remaining<c.duration:s.elapsed>0)?'继续':'开始';
    $('timerStart').disabled=pending;$('timerReset').disabled=pending;
    $('timerMinutes').disabled=c.deadline!==null;$('timerSeconds').disabled=c.deadline!==null;
    $('timerStatus').textContent=errorText||(countdown&&c.finished?'倒计时结束':running?'计时中 · 隐藏题面后继续':countdown&&c.remaining<c.duration||!countdown&&s.elapsed>0?'已暂停':'准备就绪');
    $('timerStopwatch').textContent='秒表'+(s.startedAt!==null?' ●':'');
    $('timerCountdown').textContent='倒计时'+(c.deadline!==null?' ●':'');
  }
  function send(action,extra={}){
    if(pending)return;errorText='';pending=true;paint();api.postMessage({type:'timer_action',action,...extra});
  }
  window.addEventListener('message',event=>{
    if(event.data?.type==='timer_state'){
      const next=event.data.state;
      if(!state||state.countdown.duration!==next.countdown.duration){$('timerMinutes').value=Math.floor(next.countdown.duration/60000);$('timerSeconds').value=Math.floor(next.countdown.duration/1000)%60;}
      state=next;pending=false;errorText='';paint();
    }
    if(event.data?.type==='timer_error'){pending=false;errorText=event.data.error;$('timerStatus').textContent=errorText;$('timerStart').disabled=false;$('timerReset').disabled=false;}
  });
  $('timerStopwatch').onclick=()=>send('mode',{mode:'stopwatch'});
  $('timerCountdown').onclick=()=>send('mode',{mode:'countdown'});
  $('timerStart').onclick=()=>{
    if(!state)return;
    if(state.mode==='stopwatch')return send(state.stopwatch.startedAt===null?'stopwatch_start':'stopwatch_pause');
    if(state.countdown.deadline!==null)return send('countdown_pause');
    const minutes=Number($('timerMinutes').value),seconds=Number($('timerSeconds').value),durationMs=(minutes*60+seconds)*1000;
    if(!Number.isInteger(minutes)||minutes<0||!Number.isInteger(seconds)||seconds<0||seconds>59||durationMs<=0||durationMs>7*24*60*60*1000){errorText='请输入有效时长：秒为 0–59，总时长大于 0、最多 7 天。';paint();return;}
    send('countdown_start',{durationMs});
  };
  $('timerReset').onclick=()=>{if(state)send(state.mode+'_reset');};
  setInterval(()=>{if(!pending&&state&&(state.stopwatch.startedAt!==null||state.countdown.deadline!==null))paint();},200);
  api.postMessage({type:'timer_ready'});
})();
