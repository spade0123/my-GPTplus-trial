# WSL 适配专项检查（0.2.21）

## 环境边界

Windows Chrome、本机连接与 Codex；VS Code 使用本地 UI 扩展，课程项目经 Remote-WSL 访问。完整约定见 [开发环境](development-environment.md)。

## 检查结果与修复

| 环节 | 问题与处理 | 验证方式 |
| --- | --- | --- |
| 目录改名/文件整理 | 已打开面板仍持有旧 URI；现同步面板键、题目映射、创建记录及后台上下文 | 远程 URI 文件系统模拟，改名前后关联与未保存编辑断言 |
| 快速切题 | 异步绑定过程中网页可能已到另一题；保留逐步题号/标签检查，不打开过期题 | 模拟绑定时再次切题，确认旧源码未打开 |
| 已有源码 | 题单元数据读取失败可能阻止打开已关联的根目录源码 | 绑定文件无需读取题单名字即可恢复 |
| 工作区变化 | VS Code 工作区状态变化可能失去新文件路径缓存 | 题单标记保存完整题号到文件名索引，过滤路径穿越条目 |
| 后台编译诊断 | Windows 编译器可能误报 WSL 代码 | WSL/remote 快照单独标识并跳过 Windows 编译；正常本机快照保留既有检查 |
| 样例历史/执行 | Windows 本机样例结果可能套用在 WSL 快照 | 远程捕获不混入旧本机样例，不调用 Windows 运行器 |
| 构建路径 | Windows 任务不能用于 WSL，特殊字符和符号链接可能破坏输出路径 | Linux 任务配置断言 + 真实 WSL 临时目录编译/运行与符号链接拒绝 |
| 模板与导出 | Linux 模板路径和历史导出默认路径偏向 Windows | 模板 URI 断言；导出写入模拟 WSL 工作区 |
| 本机连接选择 | 远程项目选择器可能返回 Linux 路径给 Windows 服务 | 显式要求 Windows file URI，课程源码不受限制 |

## 执行的验证

运行 node --test，限定以下文件：

- test/wsl-support.test.js：12 项远程路径与组件验证。模拟文件对象访问远程 fsPath 会直接抛错，确保没有偷偷走 Windows 文件路径。
- test/wsl-build.integration.test.js：1 项真实 WSL Ubuntu 验证，在 /tmp/grid-wsl-audit.* 中创建自拟小程序，以 g++ 编译运行，验证结果 42、无 exe 后缀、参数和特殊文件名保留、拒绝自定义 -o 与符号链接输出；临时目录按限定前缀清理。
- test/grid-feedback.test.js、test/history.test.js、test/hint-guidance.test.js：24 项相关回归，网站响应/历史与提示使用夹具和模拟模型。

合计 **37 项通过，无跳过**。这不是全仓库测试结果。旧反馈测试夹具未加载 production 页面已有的 output-feedback.js，已按真实页面脚本依赖补齐，未减少断言。

## 未覆盖的部分

没有编译或整理用户的课程代码，没有自动操控 VS Code/Chrome UI；真实 Remote-WSL 编辑器的文件事件时序、个人任务定制及网站登录链路仍需使用反馈。WSL 实际编译验证仅使用隔离自拟程序。Remote-SSH、容器和浏览器版 VS Code 不宣称已完整适配。
