const HOST='programming.pku.edu.cn';
export function gridUrl(value,{kind='any'}={}){
  try{
    const u=new URL(value);
    if(u.protocol!=='https:'||u.hostname!==HOST||u.port||u.username||u.password||u.search||u.hash)return null;
    const m=u.pathname.match(/^\/(?:course\/)?probset\/([a-f0-9]{32})\/([a-f0-9]{32})\/(ide\.do|submit\.do)?$/i);
    if(!m)return null;
    const type=m[3]==='ide.do'?'problem':m[3]==='submit.do'?'submit':'statement';
    if(kind!=='any'&&kind!==type)return null;
    const key=`${HOST}/probset/${m[1].toLowerCase()}/${m[2].toLowerCase()}/`;
    return {url:u.href,host:HOST,group:m[1].toLowerCase(),problemId:m[2].toLowerCase(),kind:type,key,submitUrl:new URL('submit.do',u.href).href};
  }catch{return null;}
}
export const sameProblem=(a,b)=>{const x=gridUrl(a),y=gridUrl(b);return Boolean(x&&y&&x.key===y.key);};
