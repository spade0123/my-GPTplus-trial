# OpenJudge C++ 学习教练 · VS Code

在 Chrome 打开百练或 NOI OpenJudge，在 VS Code 写 C++。右下角状态栏保留三个按钮：**快捷保存 / 提示 / 交流**。

源码取自当前 VS Code 编辑器，包括尚未保存到源码文件的修改；题面和可见的评测信息由独立 Chrome 扩展只读采集。记录保存在本机程序目录的 `data/`，不写 Chrome，不上传 GitHub。

## 安装

1. 下载仓库的 `openjudge-vscode` 分支；在根目录安装 Node.js 依赖：`npm ci --ignore-scripts`。
2. 安装 Node.js 22+、C++ 编译器和已登录的 Codex。本机程序通过 Codex 账户生成回复，会使用相应额度。
3. 在项目根目录运行 `install-openjudge.ps1`，可通过 `-NodePath`、`-CodexPath`、`-CompilerPath` 显式指定工具路径。该脚本只注册 `edu.openjudge.cpp_coach`，不替换原北大插件。
4. 在 Chrome 扩展管理中“加载已解压的扩展程序”，选择本分支的 `extension` 目录；在 OpenJudge 页点击 **OpenJudge · VS Code 连接** 图标。
5. 在 VS Code 扩展菜单选择“从 VSIX 安装”，安装本分支 `dist/` 内的 `openjudge-cpp-coach-0.1.0.vsix`。Windows 会从独立连接的注册信息自动发现本机程序；也可运行命令“OpenJudge：选择本机程序目录”。
6. 打开 C++ 文件，第一次点按钮时从列表选择 Chrome 中对应的具体题目页。每个文件独立关联；复用同一个 `main.cpp` 做另一题时，请使用“关联/更换题目”。

源码项目构建安装包：在根目录运行 `node tools/build-vscode.mjs`，然后在本目录使用官方 `@vscode/vsce` 的 `vsce package --no-dependencies`。

## 使用

- **快捷保存**：记录本轮完整代码、题面和运行证据，后台继续分析，当前源码文件不被改写。
- **提示**：恢复本题上次提示和解答；首次无历史时生成提示。需要按新代码更新时，点击“按当前代码重新提示”。
- **交流**：直接展开提示面板内的交流区域。输入框在历史上方，问题与当时源码一同保存；收起后可继续，已发送问答可从磁盘恢复。
- **给出解答**：代码放最前，无注释、使用紧凑运算符写法，保留 `using namespace std;`；高亮和复制保持原始代码内容。
- **提交详情**：在 Chrome 打开当前题目的 `/solution/编号/` 页面。可在面板中选择其标签；未显式选择时尝试读取同题集内当前打开的活动提交详情。
- **收起**：关闭本题教练面板并回到源码；草稿文字先保存到本机，不保存到源码文件。

## 兼容范围与限制

| 功能 | 适配方式与边界 |
| --- | --- |
| 三按钮 | 使用 VS Code 右下角状态栏；VS Code 没有受支持的网页浮层 API，问答显示在代码旁的编辑器面板。 |
| 题面 | 分别保留描述、输入、输出、样例输入和样例输出。样例缩进不被去掉；题面提示不混入执行输出。 |
| 代码 | 每次动作重新读取本次编辑器缓冲区，不依赖磁盘旧版本，不自动回填参考答案。 |
| AC/WA/CE/TLE 等 | 读取网页可见状态；只有题号、提交详情和提交源码与当前完整代码一致时才关联，AC 才触发本机完成归档。源码不可见时标“未核对”，不会假报 AC。 |
| 登录 | 需要在 Chrome 自己登录 OpenJudge。连接只读已有登录态的页面；不会处理密码或绕过登录。 |
| 运行输出 | 读取提交页公开显示的编译错误/评测状态。网站没有显示的标准输出、隐藏测试和运行输入无法读取；不会拿题目样例冒充实际输出。 |
| VS Code 终端 | 不自动读取其他扩展的 Output、Debug Console 或终端滚动历史；这类数据没有统一可靠的读取接口。静态诊断会单独标注。 |
| 测试与提交 | 保持原插件边界，不自动运行学生程序，不点击网页提交。继续用原来的运行/提交工具。 |
| 历史与报告 | 新版本在自己的 `data/` 和 `reports/` 中保存，与原版隔离；分析、debug 时间线、去重、六板块报告和数学/Markdown 渲染继续复用原有逻辑。定期报告需由 Codex 中对应的自动化读取此目录。 |
| 平台 | 首版以 Windows 桌面版 VS Code + Google Chrome 验证。VS Code 网页版、SSH/容器/WSL 远程文件和其他浏览器不属于已验证范围。 |
| 时延 | 本机先保存，模型在后台流式回复；完整提示或完整程序不能保证 3—5 秒结束。恢复历史不重复调用模型。 |

原版本仍位于仓库的 `mcp` 分支；本版本只在 `openjudge-vscode` 分支开发。

[VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)、[终端读取 API 的范围](https://code.visualstudio.com/api/references/vscode-api#TerminalShellExecution)。
