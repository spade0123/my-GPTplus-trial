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
