export function openJudgeUrl(value,{kind='any'}={}){
  try{
    const u=new URL(value);
    if(!['http:','https:'].includes(u.protocol)||!['bailian.openjudge.cn','noi.openjudge.cn'].includes(u.hostname)||u.port||u.username||u.password||u.search||u.hash)return null;
    const match=u.pathname.match(/^\/([a-zA-Z0-9_-]+)\/(?:(\d+)\/|solution\/(\d+)\/|status\/)?$/);
    if(!match)return null;
    const type=match[2]?'problem':match[3]?'solution':u.pathname.endsWith('/status/')?'status':'group';
    if(kind!=='any'&&type!==kind)return null;
    return {url:u.href,host:u.hostname,group:match[1],kind:type,problemId:match[2]||null,submissionId:match[3]||null,key:u.hostname+u.pathname};
  }catch{return null;}
}
export const sameProblem=(a,b)=>{const x=openJudgeUrl(a,{kind:'problem'}),y=openJudgeUrl(b,{kind:'problem'});return Boolean(x&&y&&x.key===y.key);};
