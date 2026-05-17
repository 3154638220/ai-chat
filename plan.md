# AI 私聊聊天伴侣 Web App 方案

## Summary
- 在 `/home/ubuntu/ai-chat` 从零创建 Node.js/TypeScript 项目；当前服务器有 Node `18.19.1`、npm `9.2.0`，无 Docker/PM2。
- 默认直接运行在服务器上，通过网页访问；不再依赖微信或 QQ。
- DeepSeek 走 OpenAI 兼容接口：`https://api.deepseek.com`；默认 `deepseek-v4-flash`，深聊/手动模式用 `deepseek-v4-pro`，不使用将于 2026-07-24 废弃的 `deepseek-chat`。
- 长期完整记忆落本地 SQLite，聊天正文用 Node `crypto` AES-256-GCM 应用层加密。

## Key Changes
- 新建机器人主流程：Wechaty 扫码登录、监听私聊、忽略自己/群聊/非 owner、串行处理消息、异常时返回简短失败提示。
- 新建 owner 绑定机制：第一次私聊发送 `/bind <OWNER_BIND_SECRET>` 后保存联系人 ID；之后只回复该联系人。
- 新建 AI 对话层：加载温柔自然的伴侣人格 prompt，组合最近对话、长期摘要和当前消息；普通消息走 flash，`/mode pro` 或 `/pro ...` 走 pro。
- 新建记忆层：`settings`、`messages`、`memory_summaries` 三类数据；完整消息密文保存，近期上下文按需解密，定期生成长期摘要。
- 新建运行配置：`.env.example`、构建脚本、systemd service 模板；生产运行用 `npm run build` + `npm start`，服务由 systemd 托管。

## Interfaces
- 环境变量：
  - `DEEPSEEK_API_KEY`
  - `DEEPSEEK_BASE_URL=https://api.deepseek.com`
  - `DEEPSEEK_FAST_MODEL=deepseek-v4-flash`
  - `DEEPSEEK_PRO_MODEL=deepseek-v4-pro`
  - `WEB_HOST=0.0.0.0`
  - `WEB_PORT=3000`
  - `WEB_CONTACT_ID=web-owner`
  - `WEB_HISTORY_LIMIT=60`
  - `WEB_LOGIN_PASSWORD`
  - `OWNER_BIND_SECRET`
  - `MEMORY_ENCRYPTION_KEY`
  - `MODEL_ROUTING=auto`
- 私聊命令：
  - `/mode fast|pro|auto`
  - `/pro <message>`
  - `/status`
  - `/reset-summary`
  - `/bind <secret>`：首次绑定 owner
  - `/mode fast|pro|auto`：切换模型路由
  - `/pro <message>`：本条强制用 pro
  - `/status`：查看登录、模型、记忆状态
  - `/reset-summary`：重建长期摘要，不删除原始加密消息

## Test Plan
- 单元测试：owner 绑定、非 owner 忽略、群聊忽略、加密写入/解密读取、模型路由、上下文拼装。
- DeepSeek client 使用 mock 测试：超时、限流、空回复、API error 都能返回可控提示并写日志。
- Wechaty 使用 mock puppet 做本地集成测试：模拟扫码登录、私聊消息、命令消息、重启后 owner 和记忆仍存在。
- 手工验收：机器人号扫码登录；主号发送 `/bind`；普通聊天能回复；重启服务后仍只回复 owner；直接查看 SQLite 看不到明文聊天正文。

## Assumptions
- 你会获取可用的 Wechaty/PadLocal/Paimon puppet service token；该路线依赖非微信官方个人号自动化能力，存在失效和账号风控风险。
- 使用单独机器人微信号，不托管你的主号。
- v1 不做主动早晚安、不自动加好友、不回复群聊，以降低打扰和风控。
- 参考资料：DeepSeek 官方文档 https://api-docs.deepseek.com/ ，Wechaty token/puppet 文档 https://wechaty.js.org/docs/puppet-services/tokens ，Wechaty README https://github.com/wechaty/wechaty
