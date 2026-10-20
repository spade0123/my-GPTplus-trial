# OpenJudge + VS Code C++ 学习教练

Chrome 打开 **百练 / NOI OpenJudge**，VS Code 写 C++，通过右下角状态栏的 **快捷保存、提示、交流** 三个按钮记录和复盘。

这是独立适配版：[openjudge-vscode 分支](https://github.com/spade0123/my-GPTplus-trial/tree/openjudge-vscode)。[原北大编程网格版本](https://github.com/spade0123/my-GPTplus-trial/tree/mcp)继续保留，不需要替换或卸载。

## 三个按钮

| 按钮 | 行为 |
| --- | --- |
| 快捷保存 | 保存当前编辑器的完整代码，包括尚未写入源文件的修改；记录题面与可核对的评测，加入后台分析队列，不打开详情。 |
| 提示 | 结合本轮代码、题意及可见评测给解题方向和局部改法；恢复上次提示，可主动重新生成；完整解答需另点按钮。 |
| 交流 | 打开提示面板里的对话区。每轮问题与当时完整源码、选中片段和评测证据一同保存，供后续报告参考。 |

问答使用插件自己的编辑器面板，输入框在对话上方，带“收起”。恢复历史不重复调用模型。代码高亮并附复制按钮；完整解答先给代码，不加注释，使用 `using namespace std;` 和 `cnt+1` 形式的紧凑运算符排版，保留 C++ 必需的空格。

## 读取和保存的边界

- **网站只读**：没有常驻题目脚本，不在网页添加按钮、样式或编辑器；只响应 VS Code 点击读取指定页面，必要时仅对同站点题面/提交详情发 GET。不读取或改写网站的 localStorage、sessionStorage、IndexedDB，不清缓存，不调用测试、保存或提交功能。
- **VS Code 源码只读**：按按钮时读取完整缓冲区，不覆盖、自动保存、格式化、运行或提交源码；不修改 `settings.json`、快捷键、主题、工作区、运行或调试配置。仅增加插件自己的命令、三个状态栏按钮和问答面板。
- **本机文件存储**：源码快照、题面、运行证据、问答、debug 时间线与报告存在本程序目录，不存 Chrome。VS Code 的插件专属目录只可保存所选本机程序位置；源码和对话仍写入本机程序的 `data/`。
- **模型生成**：分析通过已登录的本机 Codex 调用模型，使用相应账户额度，并非离线模型。深度报告默认 `gpt-6.1-sol`、`xhigh`；交互沿用流式快速回复。完整提示和解答不能保证 3—5 秒内结束。
- **GitHub 只放工具与文档**：没有自动上传作业功能；源码快照、历史、运行信息、报告和最终归档均排除在发布清单之外。

## 安装（Windows 桌面版）

需要 Node.js 22+、Google Chrome、VS Code、`g++` 和已登录的 Codex 可执行程序。

1. 下载或克隆 **openjudge-vscode** 分支到独立文件夹。
2. 在本分支根目录执行 `npm ci --ignore-scripts`。
3. 运行 `.\install-openjudge.ps1`。可显式传入 `-NodePath`、`-CodexPath`、`-CompilerPath`，使用实际可执行文件的绝对路径；Codex 不应是 PowerShell 包装脚本。脚本只注册 `edu.openjudge.cpp_coach`，不会替换旧版 `edu.pku.cpp_coach`。
4. Chrome 打开 `chrome://extensions`，启用开发者模式，加载本分支的 **extension** 文件夹。在 OpenJudge 页点击“OpenJudge · VS Code 连接”图标；角标 `ON` 表示就绪。
5. VS Code 扩展菜单选择“从 VSIX 安装”，安装 [dist/openjudge-cpp-coach-0.1.0.vsix](dist/openjudge-cpp-coach-0.1.0.vsix)。安装包只含 VS Code 界面，需与本机程序和 Chrome 连接配套。
6. 打开可信工作区中的 C++ 文件，首次点击按钮时选择 Chrome 对应题目。连接位置通常自动发现，也可运行“OpenJudge：选择本机程序目录”。

完整说明见 [VS Code 适配与限制](vscode-extension/README.md)。源码构建安装包：

```powershell
npm run build:vscode
cd vscode-extension
npx --yes @vscode/vsce package --no-dependencies --skip-license
```

## 题目、代码与 AC

支持 `bailian.openjudge.cn` 和 `noi.openjudge.cn` 的具体题目与提交详情，例如 `/practice/1001/`、`/ch0101/10/` 和同题集的 `/solution/提交编号/`。

每个源码文件单独绑定题目；站点/题集不同的同题号也分开。复用 `main.cpp` 写另一题时，在教练面板内“关联/更换题目”。关联标签切到另一题会拒绝保存，避免混存。

提示、解答或交流每次动作重新采集网页评测与当前代码。题面分开保存 **描述、输入、输出、样例输入、样例输出**，保留样例缩进和换行；评测、编译错误另存，不与样例混合。

Chrome 打开对应提交详情后，可在教练中“选择提交详情标签”。只有 **题号相符、提交源码完整可读、与本轮 VS Code 代码一致** 才关联 AC/WA/CE 等结果；匹配的 AC 在本机后台生成完成归档与 README。源码缺失或网页结构无法核对时标“未核对”，不把旧 AC 当修改后代码的结果。

提交详情通常需要自己在 Chrome 登录。连接不处理密码；网站未展示的标准输出、运行输入和隐藏测试记录为缺失，不拿样例冒充实际输出。

## 保存与报告

多题独立保存，同题不同版本按时间排列，diff、运行信息和问答用于复盘修改及 debug。完全相同内容合并展示，保留次数和原顺序；不同运行证据或问题单独记录，保留 A→B→A 的回退。

保存完成即返回，深度分析在后台继续，失败仍保留原始快照。后台逐次分析存入 `data/`；定期总结输出 Markdown 与已渲染 HTML 到 `reports/`，维护 `index.html`。**定期报告由桌面 Codex 的计划任务生成，VS Code 扩展本身没有定时服务。**

沿用北京时间 **周三 11:30、周五 08:30**。在 Codex 中建立两次计划任务，使用 [定期报告任务说明](docs/periodic-reports.md)，将项目目录替换成自己的安装目录。其他人下载仓库后需自行建立任务，不继承作者账户或日程；本机任务需要电脑开机、桌面应用运行且目录可访问。[官方计划任务说明](https://learn.chatgpt.com/docs/automations?surface=app)

报告前六部分整体归纳，具体题目统一放末尾：

1. 代码中普遍的冗余部分。
2. 输入手段的优化与拓展。
3. 可替代原始实现的函数与关键字。
4. 更简洁的解法与参考程序。
5. 头文件、函数与关键字分类拓展。
6. 时间与空间复杂度及优化方向。

末尾逐题附录先放完整原题、样例和本人代码，再说明改动、问答证据、问题及参考程序。HTML 每题默认折叠，仅显示标题，可同时展开多个，打印时展开；Markdown、公式和代码渲染沿用原版。

| 目录 | 内容 |
| --- | --- |
| `data/` | 完整代码快照、独立运行记录、逐次分析和题目时间线。 |
| `data/assistance/`、`data/hints/` | 提示/交流请求、流式进度、回复及快照关联。 |
| `data/vscode-context/` | 文件题目绑定与对话草稿；不改源文件。 |
| `archives/` | 匹配 AC 后的本机完成归档与 README。 |
| `reports/` | 定期学习报告、索引和周期状态。 |

这些目录均为本机私有数据，已加入 `.gitignore`。

## 兼容与验证

首版适配 Windows 桌面 VS Code + Chrome。编译器只做编译检查，不运行学生程序；测试和提交继续使用原来的工具。不自动读取其他扩展的 Output、Debug Console 或终端滚动历史；缺失的运行信息不编造。VS Code 网页版和 SSH/WSL/容器远程源码未适配。

已核对公开题目的实际 `dt/dd` 结构。登录后的用户提交页无法通过匿名请求读取，判题解析采用保守核对；实际登录页面结构不同会显示未核对或错误，需要进一步适配，不能声称所有历史提交均已实测。

已通过 125 个测试，并在隔离 Chrome/VS Code 配置中用虚构题目验证原生连接、三按钮、未保存源码、提示/交流/解答、语法渲染、磁盘草稿、匹配 AC 与收起。检查网页 DOM/存储零修改、源码文件保持原样。测试不使用个人作业，不消耗真实模型额度。

运行 `npm test`；原生连接测试需先运行安装脚本。技术资料：[Webview](https://code.visualstudio.com/api/extension-guides/webview)、[状态栏](https://code.visualstudio.com/api/ux-guidelines/status-bar)、[终端读取边界](https://code.visualstudio.com/api/references/vscode-api#TerminalShellExecution)。
