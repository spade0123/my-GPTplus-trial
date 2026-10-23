import {load} from 'cheerio';
import {openJudgeUrl} from './openjudge-url.js';
export function parseProblemStatistics(html,problemUrl){
  const problem=openJudgeUrl(problemUrl,{kind:'problem'});if(!problem)throw new Error('题目地址无效。');
  const $=load(html),pathname=new URL(problem.url).pathname;
  const matches=$('a[href]').toArray().some(a=>{try{const u=new URL($(a).attr('href'),problem.url);return u.host===problem.host&&[pathname,pathname+'statistics/'].includes(u.pathname);}catch{return false;}});
  if(!matches)throw new Error('官方统计页题号未能确认，未显示通过率。');
  const rows=$('#side table tbody tr').toArray().filter(tr=>$(tr).find('.result').length&&$(tr).find('.count').length);
  if(!rows.length)throw new Error('官方统计暂不可用，没有使用旧题库数值代替。');
  let total=0,accepted=0;
  for(const row of rows){
    const count=$(row).find('.count').text().trim().replaceAll(',',''),label=$(row).find('.result').text().trim();
    if(!/^\d+$/.test(count)||!Number.isSafeInteger(Number(count)))throw new Error('官方统计格式不完整。');
    total+=Number(count);if(label==='Accepted')accepted+=Number(count);
  }
  if(!Number.isSafeInteger(total)||accepted>total)throw new Error('官方统计数值无效。');
  return {problemUrl:problem.url,sourceUrl:problem.url+'statistics/',accepted,total,rate:total?100*accepted/total:null,metric:'accepted-submissions/total-submissions'};
}
export async function readProblemStatistics(problemUrl,{request=fetch}={}){
  const problem=openJudgeUrl(problemUrl,{kind:'problem'});if(!problem)throw new Error('仅支持百练 / NOI 的具体题目。');
  const url=problem.url+'statistics/';
  const response=await request(url,{method:'GET',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(6500)});
  if(!response.ok)throw new Error('读取官方统计失败（HTTP '+response.status+'）。');
  if(response.url&&response.url!==url)throw new Error('统计页发生跳转，未显示其他题目的数值。');
  let bytes=0;const chunks=[];
  for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>2*1024*1024)throw new Error('官方统计页过大，已停止读取。');chunks.push(Buffer.from(chunk));}
  return {...parseProblemStatistics(Buffer.concat(chunks).toString('utf8'),problem.url),checkedAt:new Date().toISOString()};
}
