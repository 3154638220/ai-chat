# AI 私聊聊天伴侣 Web App

私用 AI 伴侣网页。它直接运行在你自己的服务器上，通过浏览器访问，不再依赖微信或 QQ。DeepSeek 走 OpenAI 兼容接口；聊天全文保存到本地 SQLite 文件，并用 AES-256-GCM 加密。

## 准备

1. 安装依赖：

```bash
npm install
```

2. 创建配置：

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

把下面这些值写入 `.env`：

- `DEEPSEEK_API_KEY`
- `WEB_LOGIN_PASSWORD`（至少 12 个字符）
- `MEMORY_ENCRYPTION_KEY`
- `WEB_HOST=0.0.0.0`
- `WEB_PORT=3000`

`OWNER_BIND_SECRET` 现在是可选项；如果不单独设置，就会复用 `WEB_LOGIN_PASSWORD`。

如果你希望她默认知道“她是谁、你是谁、你们是什么关系”，可以再补这些项：

- `ASSISTANT_IDENTITY`
- `ASSISTANT_PROFILE`
- `USER_IDENTITY`
- `USER_PROFILE`
- `RELATIONSHIP_BACKGROUND`

其中 `ASSISTANT_PROFILE` 适合放她的个人细节，比如性格、说话习惯、擅长什么、对你的相处方式。`USER_PROFILE` 适合放你的个人详细信息，比如爱好、特长、习惯、性格、学习或工作背景。它们都会在每一轮对话作为 system prompt 注入，模型会把它们当作默认已知背景，但只会在相关时自然使用，不会每次机械复述。

示例：

```env
ASSISTANT_IDENTITY=她叫林绪，比我大两届，是我熟悉的学姐。
ASSISTANT_PROFILE=性格克制冷静，观察力很强，习惯先接住情绪再说建议；很会照顾人，但表达偏淡，不会黏人。
USER_IDENTITY=我叫周沉。
USER_PROFILE=爱好是摄影、散步、科幻片；特长是写代码、做规划；性格偏内敛，遇到压力容易先自己扛着。
RELATIONSHIP_BACKGROUND=我们认识很多年，彼此默认知道对方身份和过往，相处熟悉又亲近。
```

3. 构建和测试：

```bash
npm run build
npm test
```

4. 启动：

```bash
npm start
```

启动后控制台会打印 Web 访问地址。浏览器打开对应地址，先输入 `WEB_LOGIN_PASSWORD` 登录，再直接开始聊天。

默认常用地址是：

- `http://127.0.0.1:3000`
- `http://你的服务器IP:3000`

## 私聊命令

- `/mode fast|pro|auto`：切换模型路由。
- `/pro <message>`：本条强制使用 `deepseek-v4-pro`。
- `/status`：查看登录、模型、记忆状态。
- `/reset-summary`：重建长期摘要，不删除原始加密消息。

## 后台运行

模板在 `deploy/ai-chat-girlfriend.service`。确认 `npm` 路径后复制到 systemd：

```bash
sudo cp deploy/ai-chat-girlfriend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ai-chat-girlfriend
journalctl -u ai-chat-girlfriend -f
```

## 风险说明

这个版本不再依赖第三方聊天平台账号风控，但它本质上是一个暴露在网络上的私有聊天网页。至少要注意两件事：

- 设置足够强的 `WEB_LOGIN_PASSWORD`
- 生产环境最好放到反向代理后面，并启用 HTTPS
