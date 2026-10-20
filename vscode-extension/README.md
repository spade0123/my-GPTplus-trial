# 编程网格 C++ 学习教练 · VS Code

这版面向 `https://programming.pku.edu.cn` 的题目 IDE，与仓库原有的 OpenJudge 插件分开安装。它保留 **快捷保存、提示、交流** 三个按钮，增加本机运行样例和从 VS Code 提交到编程网格。

## 安装

1. 安装 Node.js 22+、G++、已登录的 Codex，以及桌面版 VS Code 和 Chrome。在本项目根目录运行 `npm ci --ignore-scripts`。
2. 在本项目根目录运行 `powershell -ExecutionPolicy Bypass -File .\install-grid.ps1`。需要时可指定 `-NodePath`、`-CodexPath`、`-CompilerPath`。它注册独立的 `edu.pku.grid_vscode_coach` 本机连接，不会覆盖 OpenJudge 连接。
3. 在 Chrome 扩展管理页打开开发者模式，选择“加载已解压的扩展程序”，选择本项目的 `extension/` 目录。在 Chrome 自己登录编程网格并打开具体题目的 `/ide.do` 页面，点击“编程网格 · VS Code 连接”图标。
4. 在 VS Code 里通过“从 VSIX 安装”选择 `dist/pku-grid-cpp-coach-0.1.0.vsix`，打开 C++ 文件。如果安装后没有看到状态栏按钮，重新加载 VS Code 窗口。

## 它怎样工作

```text
编程网格题目 IDE ──Chrome 连接扩展──本机连接程序──VS Code 插件
       │                                      │               │
       └─题面、评测状态                       本机记录      当前编辑器代码
                                              │               │
                                              └──提示/交流─────┘
```

Chrome 负责读取题目网页；VS Code 负责读取当前编辑器内的完整代码，包括尚未保存到文件的改动。本机程序负责把同一题的题面、代码快照和交流记录放在一起。浏览器登录由网站自己处理，插件不收集密码。

**运行样例**只在本机编译运行当前代码，并将实际输出与题目样例比较；样例一致不等于网站评测通过。**提交到编程网格**先保存点击时的代码快照，再由已经登录的 Chrome 调用网站自己的提交接口。第一次点击只检查题目页面和 C++ 选项，第二次明确点击才发送。每次点击只发送一次；如果返回结果不确定，插件不会自动重试。刷新只查询这一次的提交编号。

网站返回的 AC/WA 等结果只与相同题号、相同代码关联。网站未提供的隐藏测试输入和标准输出不会被填入记录。当前适配以 C++、Windows 桌面版 VS Code 和 Chrome 为目标。

## 当前验证边界

公开网页脚本确认了提交路径 `submit.do`、字段 `programLanguage` / `sourceCode` / `type=json`，以及按提交编号查询 `/solution/{id}/status.do` 的流程。开发时没有使用用户账号进行真实提交；首次使用请先在浏览器确认题目开放、账号已登录，提交后核对网站的记录与 VS Code 显示是否一致。
