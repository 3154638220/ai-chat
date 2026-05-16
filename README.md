# AI 微信聊天女友 Bot

私用微信 AI 伴侣机器人。它使用单独机器人微信号登录 Wechaty puppet service，只对白名单 owner 回复；DeepSeek 走 OpenAI 兼容接口；聊天全文保存到本地 SQLite 文件，并用 AES-256-GCM 加密。

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

把 DeepSeek key、Wechaty puppet token、`OWNER_BIND_SECRET` 和生成的 `MEMORY_ENCRYPTION_KEY` 写入 `.env`。

3. 构建和测试：

```bash
npm run build
npm test
```

4. 启动：

```bash
npm start
```

控制台会打印 Wechaty 扫码链接。用机器人微信号扫码登录后，用你的主号给机器人私聊发送：

```text
/bind 你的_OWNER_BIND_SECRET
```

绑定后只会回复这个微信联系人。

## 微信内命令

- `/bind <secret>`：首次绑定 owner。
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

个人微信没有官方机器人接口，Wechaty puppet service 属于非官方自动化路线，可能受微信风控或服务可用性影响。默认配置不主动发消息、不回群、不自动加好友，只回复绑定 owner。
