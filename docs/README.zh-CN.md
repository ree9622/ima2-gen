# ima2-gen

[![npm version](https://img.shields.io/npm/v/ima2-gen)](https://www.npmjs.com/package/ima2-gen)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)

> **其他语言**: [English](../README.md) · [한국어](README.ko.md) · [日本語](README.ja.md)

面向 OpenAI **GPT Image 2** (`gpt-image-2`) 图像生成的极简 CLI + Web UI。支持 OAuth（通过 ChatGPT Plus/Pro 免费）或 API Key。并行生成、多图参考、CLI 自动化、历史持久化。

![ima2-gen 截图](../assets/screenshot.png)

---

## 快速开始

```bash
# 无需安装，直接运行
npx ima2-gen serve

# 或全局安装
npm install -g ima2-gen
ima2 serve
```

首次运行时会提示选择认证方式:

```
  请选择认证方式:
    1) API Key  — 粘贴 OpenAI API key (付费)
    2) OAuth    — 使用 ChatGPT 账号登录 (免费)
```

Web UI 地址: `http://localhost:3333`。

---

## 功能

截图中展示的所有功能均已正式上线。

### 认证
- **OAuth** — 使用 ChatGPT Plus/Pro 账号登录，每张图像 $0
- **API Key** — 粘贴 `sk-...` key，按调用计费

左侧面板实时显示状态（绿点=就绪，红点=禁用）。默认禁用 API key，OAuth 为主路径。

### 生成选项
| 选项 | 可选值 |
|------|--------|
| **Quality** | Low(快速) · Medium(平衡) · High(最佳) |
| **Size** | `1024²` `1536×1024` `1024×1536` `1360×1024` `1024×1360` `1824×1024` `1024×1824` `2048²` `2048×1152` `1152×2048` `3824×2160` `2160×3824` · `auto` · 自定义 |
| **Format** | PNG · JPEG · WebP |
| **Moderation** | Low(限制较少) · Auto(标准) |
| **Count** | 1 · 2 · 4 并行 |

所有尺寸遵循 gpt-image-2 约束: 每边为 16 的倍数，长短比 ≤ 3:1，总像素 655,360–8,294,400。

### 工作流
- **多参考图** — 最多附加 5 张参考图，可拖放到左侧面板任意位置
- **prompt+上下文** — 一次请求中混合文本和参考图
- **Use current** — 一键将选中图像作为新参考重用
- 画布上直接 **Download** · **Copy to clipboard** · **Copy prompt**
- 底部 **固定画廊条** — 绝不滚动的固定位置
- **画廊弹窗 (+)** — 网格视图查看整个历史
- **会话持久化** — 生成中刷新页面，pending 任务会自动恢复

### CLI (无头自动化)
```bash
ima2 gen "a shiba in space" -q high -o shiba.png
ima2 gen "merge these" --ref a.png --ref b.png -n 4 -d out/
ima2 ls -n 10
ima2 ps
ima2 ping
```

完整命令矩阵见下 ↓

---

## CLI 命令

### 服务器命令
| 命令 | 别名 | 说明 |
|------|------|------|
| `ima2 serve` | — | 启动 Web 服务器（首次运行自动设置） |
| `ima2 setup` | `login` | 重新配置认证方式 |
| `ima2 status` | — | 显示当前配置和认证状态 |
| `ima2 doctor` | — | 诊断环境与依赖 |
| `ima2 open` | — | 在浏览器中打开 Web UI |
| `ima2 reset` | — | 清除已保存配置 |
| `ima2 --version` | `-v` | 显示版本 |
| `ima2 --help` | `-h` | 显示帮助 |

### 客户端命令（需要 `ima2 serve` 在运行）
| 命令 | 说明 |
|------|------|
| `ima2 gen <prompt>` | 从 CLI 生成图像 |
| `ima2 edit <file>` | 编辑已有图像（需 `--prompt`） |
| `ima2 ls` | 列出最近历史（表格或 `--json`） |
| `ima2 show <name>` | 查看一条历史项（`--reveal`） |
| `ima2 ps` | 列出活动任务（`--kind`, `--session`） |
| `ima2 ping` | 对正在运行的服务器做健康检查 |

运行中的服务器会在 `~/.ima2/server.json` 自我广告。客户端自动发现；也可通过 `--server <url>` 或 `IMA2_SERVER=...` 覆盖。

### 退出码
`0` 成功 · `2` 参数错误 · `3` 服务器不可达 · `4` APIKEY_DISABLED · `5` 4xx · `6` 5xx · `7` 安全拒绝 · `8` 超时。

---

## 路线图

公开路线图，可能调整。版本号反映实际发布周期。

### ✅ 已发布
- **0.06** 会话 DB — 基于 SQLite 的历史 + sidecar JSON
- **0.07** 多参考图 — 最多 5 张，i2i 合并到统一流程
- **0.08** Inflight 跟踪 — 刷新安全的 pending 状态，阶段跟踪
- **0.09** 节点模式（仅开发） — 用于分支生成的图形画布
- **0.09.1** CLI 集成 — `gen / edit / ls / show / ps / ping` + `/api/health` + 端口广告

### 🚧 0.10 — Compare & Reuse (当前周期)
- **F3 Prompt 预设** — 保存/应用 `{prompt, refs, quality, size}` 包
- **F3 Gallery groupBy** — `preset / date / compareRun` 分组
- **F2 批量 A/B 对比** — 一个 prompt 衍生 2–6 个并行变体，键盘裁决（`1-6`, `Space`=优胜, `V`=变体, `P`=保存预设）
- **F4 Export 包** — 将所选图像打包 zip（`manifest.json` + 每图 prompt `.txt`）
- 每个服务器动词都配套发布对应 CLI 镜像（`ima2 preset / compare / export`）

### 🔭 0.11 — 卡片新闻模式
- Instagram 轮播生成（4 / 6 / 10 张）
- 通过 `file_id` 扇出保证风格一致（不用 `previous_response_id`，不用 seed）
- 并行重生成卡片而不破坏风格链

### 🔭 0.12 — 风格套件
- 通过风格参考上传固化 house-style 预设
- 对身份敏感的编辑可选 `input_fidelity: "high"`

### 🗂 待办
- Web UI 明暗主题切换
- 键盘快捷键备忘单覆盖层
- 协作会话（WebSocket 共享 SQLite）
- 自定义后处理插件系统

---

## 架构

```
ima2 serve
  ├── Express 服务器 (:3333)
  │   ├── GET  /api/health         — version, uptime, activeJobs, pid
  │   ├── GET  /api/providers      — 可用认证方式
  │   ├── GET  /api/oauth/status   — OAuth 代理健康检查
  │   ├── POST /api/generate       — text+ref → image (n 并行)
  │   ├── POST /api/edit           — 重参考的编辑路径
  │   ├── GET  /api/history        — 分页的 sidecar 列表
  │   ├── GET  /api/inflight       — 进行中任务 (kind/session 过滤)
  │   ├── GET  /api/sessions/*     — 节点图会话 (仅开发)
  │   ├── GET  /api/billing        — API 额度 / 费用
  │   └── 静态文件 (public/)        — Web UI
  │
  ├── openai-oauth 代理 (:10531)   — 内嵌 OAuth 中继
  └── ~/.ima2/server.json          — CLI 自动发现用的端口广告
```

**节点模式**仅用于开发 (`npm run dev`)，在会话 DB + 多用户方案就绪前，npm 发布版中被禁用。

---

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | — | OpenAI API key（跳过 OAuth） |
| `PORT` | `3333` | Web 服务器端口 |
| `OAUTH_PORT` | `10531` | OAuth 代理端口 |
| `IMA2_SERVER` | — | 客户端: 覆盖目标服务器 URL |

---

## API 价格（仅 API Key 模式）

| Quality | 1024×1024 | 1024×1536 | 1536×1024 | 2048×2048 | 3840×2160 |
|---------|-----------|-----------|-----------|-----------|-----------|
| Low     | $0.006    | $0.005    | $0.005    | $0.012    | $0.023    |
| Medium  | $0.053    | $0.041    | $0.041    | $0.106    | $0.200    |
| High    | $0.211    | $0.165    | $0.165    | $0.422    | $0.800    |

**OAuth 模式免费** — 从你现有的 ChatGPT Plus/Pro 订阅中扣除。

---

## 开发

```bash
git clone https://github.com/lidge-jun/ima2-gen.git
cd ima2-gen
npm install
npm run dev    # --watch + 节点模式启用
npm test       # 51+ 测试
```

---

## 故障排查

**端口被占用 / "为什么跑在 3457?"**
→ 默认端口是 `3333`。如果 shell 里设置了 `PORT`（例如从 `cli-jaw` 这类其它服务器继承），ima2 就会用它。取消设置或 `PORT=3333 ima2 serve`。

**`ima2 ping` 提示服务器不可达**
→ 确认 `ima2 serve` 正在运行? 查看 `~/.ima2/server.json`。可用 `ima2 ping --server http://localhost:3333` 覆盖。

**OAuth 登录不工作**
→ 手动运行 `npx @openai/codex login`，然后 `ima2 serve`。

**图像无法生成**
→ 运行 `ima2 status` 核对配置。API key 必须以 `sk-` 开头。

---

## 许可证

MIT
