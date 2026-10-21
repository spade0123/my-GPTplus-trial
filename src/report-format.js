import {z} from 'zod';

export const REPORT_SECTIONS = [
  {key:'redundancy', title:'代码中普遍的冗余部分'},
  {key:'input', title:'输入手段的优化与拓展'},
  {key:'language', title:'可替代原始实现的函数与关键字'},
  {key:'reference', title:'更简洁的解法与参考程序'},
  {key:'library', title:'头文件、函数与关键字分类拓展'},
  {key:'complexity', title:'时间与空间复杂度及优化方向'}
];

export const REPORT_GUIDE = `报告严格按以下六个板块组织，每个板块必须有内容；没有相关问题时如实写“本次未发现明显问题”或“现有信息不足”，不为了填满板块制造问题。可以用 Markdown 加粗、行内代码、表格、嵌套列表、带 cpp 语言标记的代码块和 LaTeX 公式。
1. 代码中普遍的冗余部分：结合行号指出重复判断、重复计算、无效变量、可合并循环等；先说明任何已确认的正确性或边界缺陷，再给小范围的原片段与改进片段、原因及验证方法。区分真实缺陷、待验证风险和风格选择。
2. 输入手段的优化与拓展：根据题目输入格式，比较实际代码与合适的 cin、getline、字符/字符串读取、EOF 或定长读取等方式，给贴合本题的小例子；说明空格、空行、换行残留及多组输入的影响。只有规模和用法适合时建议关闭流同步，说明混用 C/C++ 输入的限制，不一概而论。
3. 可替代原始实现的函数与关键字：逐项给出“当前手写实现/行号 → 对应标准函数或语言特性 → 简短等价写法 → 适用前提与边界”。可涉及 string、算法库、容器及 range-for、auto、const 等，但必须符合所选 C++ 标准。不根据代码推断用户一定不懂这些功能，将其表述为可以学习和节省实现时间的机会。
4. 更简洁的解法与参考程序：对实现明显繁琐或存在值得学习的简洁思路的题目，给出与题意、输入输出和 C++ 标准一致的完整可编译参考程序，包含头文件和 main，并解释关键思路、相对原解的收益及边界。用户已授权在此提供完整参考程序。题意或约束不足时先说明缺失；原解已清楚或没有实质改进时明确说明，不硬凑替代代码。只做了推导或编译检查时不能声称参考程序已运行、通过样例或 AC。
5. 头文件、函数与关键字分类拓展：优先覆盖实际使用的头文件和本次建议的函数，以表格按头文件/用途分类，给典型用法、返回值或边界、相关拓展；语言关键字单独归类并说明关键字属于 C++ 语言，不由头文件定义。控制在与本题紧密相关的范围；选最多三个优先补学主题，附练习和可检查的掌握标准。
6. 时间与空间复杂度及优化方向：明确定义 n、m 等规模变量，依据实际循环、库函数调用和数据结构推导原解与参考解的时间、额外空间和必要时递归栈开销，指出最坏情况、约束下的瓶颈、优化前提、收益与代价；给少量可推导预期结果的边界/反例建议，未执行的验证须标注。
如提供修改历史，应在对应板块内结合真实 diff、备注和运行/判题证据说明改动与 debug 过程。assistance 包含当时请求提示或交流时的源码快照关联、提问、即时提示和深入回复，应据此解释卡点与补学重点；提示内容只是建议，不能当成用户已经采纳或已经修复，须核对后续真实 diff 和测试证据。完全相同的内容已分组合并，occurrenceCount 和 numbers 表示次数与原位置；不要重复讲解同一内容，sequence 和 transitions 才表示真实发生顺序及改动，不能把 A → B → A 误写成没有回退；不要虚构用户的思考过程。`;

const StructuredReport = z.object({
  sections:z.object(Object.fromEntries(REPORT_SECTIONS.map(({key}) => [key,z.string().trim().min(1).max(20000)]))).strict(),
  topics:z.array(z.string()).max(8),
  evidence:z.string().max(8000), next_step:z.string().max(4000)
}).strict();

function sectionBody(markdown) {
  let fence;
  return markdown.split('\n').map(line => {
    const marker=line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence=marker[1];
      else if (marker[1][0]===fence[0] && marker[1].length>=fence.length) fence=undefined;
      return line;
    }
    // Section headings are added by the host; model subheadings stay nested.
    return fence ? line : line.replace(/^ {0,3}#{1,2}\s+/, '### ');
  }).join('\n');
}

export function formatModelReport(value) {
  const {sections, ...metadata} = StructuredReport.parse(value);
  const markdown = REPORT_SECTIONS.map(({key,title},i) => `## ${i+1}. ${title}\n\n${sectionBody(sections[key])}`).join('\n\n');
  if (markdown.length > 50000) throw new Error('报告过长，超过 50000 字符。');
  return {markdown, ...metadata};
}
