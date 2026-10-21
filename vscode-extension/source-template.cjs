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
function cppTemplate(version){
  const safe=/^\d+\.\d+\.\d+$/.test(String(version))?version:'0.2.13';
  return `//Powered by Grid-Code connector plugin v${safe}!\n#include <iostream>\n\nusing namespace std;\n\nint main(){\n\n    return 0;\n}\n`;
}
module.exports={sourceStem,cppTemplate};
