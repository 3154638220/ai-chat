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
