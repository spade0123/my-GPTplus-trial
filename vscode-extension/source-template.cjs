// Short, deterministic names without sending problem titles to an AI service.
const phrases=[
  ['根据日期求星期','weekday'],['计算鞍点','saddle-point'],['五户共井','well-puzzle'],
  ['将两个排序后的数组合并','merge-arrays'],['单词倒排','reverse-words'],['单词翻转','reverse-word'],
  ['进制计算','base-conversion'],['比饭量','appetite-order'],['二分查找','binary-search'],
  ['最长公共子序列','lcs'],['最大公约数','gcd'],['最小公倍数','lcm'],['斐波那契','fibonacci'],
  ['素数','prime'],['回文','palindrome'],['排序','sort'],['日期','date'],['矩阵','matrix'],
  ['字符串','string'],['数组','array'],['链表','linked-list'],['递归','recursion'],['迷宫','maze']
];
function sourceStem(title,number){
  const text=String(title||'');
  const phrase=phrases.find(([name])=>text.includes(name));if(phrase)return phrase[1];
  const ascii=text.replace(/\+/g,' plus ').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  if(/[a-z]/.test(ascii)&&!/[\u3400-\u9fff]/.test(text))return ascii.slice(0,36).replace(/-+$/,'');
  return Number.isSafeInteger(number)&&number>0?'problem-'+String(number).padStart(2,'0'):'problem';
}
const DEFAULT_TEMPLATE=[
  '//Powered by Grid-Code connector plugin v${pluginVersion}!',
  '#include <iostream>','','using namespace std;','','int main(){','','    return 0;','}'
];
function templateText(lines=DEFAULT_TEMPLATE){
  if(!Array.isArray(lines)||!lines.length||lines.length>2000||lines.some(line=>typeof line!=='string'))throw new Error('源码模板应为非空的文本行数组，最多 2000 行。');
  const text=lines.join('\n');if(!text.trim()||text.length>90000||text.includes('\0'))throw new Error('源码模板不能为空，且最多 90000 字符。');return text;
}
function cppTemplate(version,{text,lines,problemTitle='',problemId='',problemNumber='',fileName='',now=new Date()}={}){
  const safe=/^\d+\.\d+\.\d+$/.test(String(version))?String(version):'0.2.15';
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const values={pluginVersion:safe,problemTitle,problemId,problemNumber,fileName,date};
  const raw=text===undefined?templateText(lines):String(text).replace(/^\uFEFF/,'');
  if(!raw.trim()||raw.length>90000||raw.includes('\0'))throw new Error('源码模板不能为空，且最多 90000 字符。');
  const result=raw.replace(/\$\{(pluginVersion|problemTitle|problemId|problemNumber|fileName|date)\}/g,(_,key)=>String(values[key]??'').replace(/[\r\n\u0000-\u001f\u007f]/g,' ').replace(/\*\//g,'* /'));
  // Plain text substitution only. Unknown placeholders are left untouched.
  if(result.length>99999)throw new Error('占位符替换后的源码模板过长，请缩短模板或题目信息。');
  return result.endsWith('\n')?result:result+'\n';
}
module.exports={sourceStem,cppTemplate,DEFAULT_TEMPLATE,templateText};
