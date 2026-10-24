# 开发环境约定

用户的课程作业项目在 **WSL** 中，通过 VS Code 远程资源管理器的 **Remote-WSL** 打开。后续实现必须覆盖这条工作流，不能默认源码在 Windows 磁盘路径中。

## 组件的位置

| 组件 | 所在环境 | 职责 |
| --- | --- | --- |
| Chrome 与网格连接扩展 | Windows | 使用现有登录，读取题目与网格判题回复 |
| Grid-Code VS Code UI 扩展 | Windows 本地 UI 扩展宿主 | 显示题面、切题、读取当前文档，联系本机服务 |
| 本机连接与 Codex | Windows | 浏览器消息与 AI 调用，按 URI 保存文件关联 |
| 课程源码、题单目录、tasks.json | WSL | 用户的实际课程工作区 |
| Ctrl+Shift+B 的编译器 | WSL | 使用 Linux g++，输出到题单 build 目录 |

## 文件与关联

远程文件形如 vscode-remote://wsl+发行版/home/.../题目.cpp。必须保留完整 URI 的 scheme、authority 和 path；使用 vscode.workspace.fs、openTextDocument、WorkspaceEdit 读写和改名，不把远程 fsPath 交给 Windows Node fs。

跨环境允许传递源码正文或不透明 URI 关联键，不把 Linux 文件当成 Windows 可执行程序。目录边界检查比较同一文件系统的 authority 和路径；WSL 路径使用 POSIX 路径规则。源码、题单目录和任务配置都通过 VS Code 的远程文件接口写入 WSL。

## 构建

生成 .vscode/grid-build.sh 与默认 process 构建任务。VS Code 在 WSL 任务环境执行 /bin/sh，脚本调用 WSL 的 g++，把结果写入源码旁 build/源码名。脚本由插件管理、更新时覆盖自身旧版本；遇到非插件脚本或符号链接不覆盖。g++ 路径可用 gridCoach.build.wslCompiler 指定，参数由 gridCoach.build.arguments 配置。

Windows 本地工作区仍使用安装时的 Windows Node/g++ 和 build/源码名.exe。Remote-SSH/容器的构建策略尚未完整适配，不能声称所有远程环境都已验证。

## 当前验证边界

0.2.21 按用户要求完成 37 项专项与相关回归验证，含真实 WSL 临时目录的自拟程序编译运行。没有运行用户课程代码或迁移其作业目录，也未自动操控编辑器 UI。详情见 [WSL 检查记录](wsl-audit.md)。未经用户要求不运行测试或编译课程代码。

参考：[VS Code 远程扩展架构](https://code.visualstudio.com/api/advanced-topics/remote-extensions)、[Remote-WSL 文档](https://code.visualstudio.com/docs/remote/wsl)。


## Windows 原生项目同样支持

用户目前的课程项目位于 WSL；这不限制同学使用 Windows 本地项目。用普通 VS Code 窗口打开 C:/ 或 D:/ 下的项目即可，源码 URI 为 file:，不需要 Remote-WSL。

| 功能 | Windows 原生项目 | Remote-WSL 项目 |
| --- | --- | --- |
| 切题、源码关联、题单目录 | Windows file: URI，经 VS Code 文件接口读写 | vscode-remote: URI，经 VS Code 远程文件接口读写 |
| 自动创建的题目源码 | 编程网格/题单名字/英文题名.cpp | 同样的目录结构，存储在 WSL |
| Ctrl+Shift+B | Windows Node 调用安装时指定的 Windows g++ | /bin/sh 调用 WSL g++ |
| 编译产物 | 题单目录/build/源码名.exe | 题单目录/build/源码名 |
| 题面参考图、网格云端测试与提交、AI 页面 | Windows Chrome → Windows 本机连接 → VS Code UI | 相同链路，源码正文通过 VS Code 远程接口提供 |

Windows 需按 README 运行 install-grid.ps1，配置本机 Node、Codex 和 g++ 的真实路径。已有用户任务可以继续使用；若要应用产物集中策略，执行“编程网格：配置 Ctrl+Shift+B 编译到 build”。不需要单独的 Windows 版 VSIX，当前安装包同时包含两种构建分支。

0.2.22 发布前确认以上路径与组件分支仍存在；参考图功能通过语法检查并已打包安装，实际网站图片显示及 Windows 原生 UI / 编译联调尚待使用确认。先前 0.2.21 的 WSL 专项验证不能替代 Windows 原生端到端验证。
