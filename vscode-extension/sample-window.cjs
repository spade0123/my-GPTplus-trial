const {randomUUID}=require('node:crypto');
class SampleWindow{
  constructor({create,render,receive,collapse,onError=()=>{}}){Object.assign(this,{create,render,receive,collapse,onError});}
  open(details,providedPanel){
    const previous=this.state,panel=providedPanel||(previous&&!previous.disposed?previous.panel:this.create(details));
    if(previous)previous.disposed=true;
    const state={...details,panel,session:randomUUID(),disposed:false,ready:false,latest:{}};this.state=state;
    if(!previous||previous.panel!==panel){
      const disposed=panel.onDidDispose(()=>{if(this.state?.panel===panel){this.state.disposed=true;this.state=null;}disposed.dispose();messages.dispose();});
      const messages=panel.webview.onDidReceiveMessage(message=>{void this.handle(panel,message).catch(this.onError);});
    }
    panel.title='样例测试 · '+details.name;panel.webview.html=this.render(state);
    if(previous?.panel===panel)panel.reveal(panel.viewColumn);
    return state;
  }
  current(state){return this.state===state&&!state.disposed;}
  show(state,value){
    if(!this.current(state))return;
    state.latest=value;if(value.title)state.panel.title='样例测试 · '+value.title;
    if(state.ready)void state.panel.webview.postMessage({type:'sample_view',...value}).catch(this.onError);
  }
  async handle(panel,message){
    const state=this.state;
    if(!state||state.disposed||state.panel!==panel||message.viewSession!==state.session)return;
    if(message.type==='sample_ready'){state.ready=true;this.show(state,state.latest);return;}
    if(message.type==='sample_collapse'){panel.dispose();await this.collapse(state);return;}
    if(['oj_prepare','oj_submit','oj_refresh','open_link','run_sample','show_models','show_versions','copy_code'].includes(message.type))await this.receive(state,message);
  }
  dispose(){this.state?.panel.dispose();}
}
module.exports={SampleWindow};
