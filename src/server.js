import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs/promises';
import { reviewHistory } from './browser-review.js';
import {timeline,problemSummary} from './problem-history.js';
import { COURSE, CODE_ROOT, TOPICS, REVIEW_GUIDE, fetchPage, readCode, inspectCode, compilerCheck, saveReview, learningPlan } from './core.js';

const server = new McpServer({ name: 'pku-cpp-coach', version: '1.4.0' }, { instructions: REVIEW_GUIDE });
function tool(name, description, schema, handler, readOnly = true, openWorld = false) {
  server.registerTool(name, { description, inputSchema: schema, annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: openWorld } }, async args => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await handler(args), null, 2) }] }; }
    catch (e) { return { isError: true, content: [{ type:'text', text: e.message }] }; }
  });
}
tool('list_assignments', '读取指定计算概论课程的公开作业列表、页面分组及截止日期（北京时间）。', {}, async () => { const { text, ...page } = await fetchPage(COURSE); return page; }, true, true);
tool('read_course_page', '读取北大作业集或题目页面和可访问链接。登录页不等于题面；需用户粘贴受限题目。', { url: z.string().url() }, async ({url}) => fetchPage(url), true, true);
tool('list_local_cpp', '列出本地作业目录第一层 C++ 文件；子目录文件可直接用相对路径分析。', {}, async () => ({ directory: CODE_ROOT, files: (await fs.readdir(CODE_ROOT, {withFileTypes:true})).filter(x=>x.isFile() && /\.(cpp|cc|cxx|h|hpp)$/i.test(x.name)).map(x=>x.name) }));
tool('analyze_cpp', '为 C++ 作业生成带行号代码、编译器诊断、启发式风险和学习审查框架，由 Codex 完成语义分析。code/file 二选一；建议同时提供 statement。不会执行学生程序。', {
  code: z.string().min(1).max(100000).optional(), file: z.string().min(1).max(1000).optional(),
  statement: z.string().max(60000).optional(), problem_url: z.string().url().optional(),
  standard: z.enum(['c++11','c++14','c++17','c++20']).default('c++17'), compile: z.boolean().default(true)
}, async ({code, file, statement, problem_url, standard, compile}) => {
  if ((code !== undefined) === (file !== undefined)) throw new Error('code 和 file 必须且只能提供一个。');
  code = code ?? await readCode(file);
  if (Buffer.byteLength(code) > 100000) throw new Error('代码超过 100KB。');
  let page, pageError;
  if (problem_url) { try { page = await fetchPage(problem_url); } catch(e) { pageError=e.message; } }
  return { code: code.split('\n').map((line,i)=>`${i+1}: ${line}`).join('\n'), statement: statement || null, page, pageError,
    missingStatement: !statement && (!page || page.loginRequired), standard,
    compiler: compile ? await compilerCheck(code, standard) : {status:'skipped',ranProgram:false},
    ...inspectCode(code), topicCatalog: TOPICS, reviewGuide: REVIEW_GUIDE };
});
tool('save_review', '用户希望保存复盘时，记录已讨论的问题、证据与学习主题；不保存源码。写入本地个人记录。', {
  title: z.string().min(1).max(200), topics: z.array(z.enum(Object.keys(TOPICS))).min(1).max(8),
  evidence: z.string().min(1).max(5000), next_step: z.string().min(1).max(2000)
}, saveReview, false);
tool('learning_plan', '汇总保存的复盘，按反复出现的知识主题给出学习顺序、练习和自测标准。', {}, learningPlan);
tool('review_history', '按时间范围读取保存的题目分析，用于每周总结。默认不返回源码。queued/pending=已保存等待处理，running=后台生成中，failed=报告失败但源码保留，complete=报告完成。时间范围为起点包含、终点不包含。', {
  since:z.string().datetime({offset:true}).optional(),until:z.string().datetime({offset:true}).optional(),limit:z.number().int().min(1).max(100).default(30),includeSource:z.boolean().default(false)
}, reviewHistory);
tool('problem_timeline','读取单题的保存、提交和判题时间线及最终归档状态。默认不返回过程源码。',{url:z.string().url(),includeSource:z.boolean().default(false)},async({url,includeSource})=>includeSource?timeline(url):problemSummary(url));
tool('coach_status', '检查服务配置与编译器是否可用。', {}, async () => ({ course: COURSE, codeDirectory: CODE_ROOT, compiler: await compilerCheck('int main(){return 0;}'), privacy: '题面、源码和诊断由 Codex 分析。作业源码、修改历史、报告和最终归档均保存在本地；没有 GitHub 上传功能。', execution: '仅编译检查，不执行代码或提交作业。' }));
server.registerPrompt('review_homework', { description: '按课程要求审阅 C++ 作业，输出改进方向与补学计划。', argsSchema: { focus: z.string().optional() } }, ({focus}) => ({messages:[{role:'user',content:{type:'text',text:`${REVIEW_GUIDE}\n本次侧重：${focus || '正确性、优化与补学知识点'}。请先获取用户代码与题面，再调用 analyze_cpp。`}}]}));
await server.connect(new StdioServerTransport());
