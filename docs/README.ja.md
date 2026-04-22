# ima2-gen

[![npm version](https://img.shields.io/npm/v/ima2-gen)](https://www.npmjs.com/package/ima2-gen)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)

> **他の言語で読む**: [English](../README.md) · [한국어](README.ko.md) · [简体中文](README.zh-CN.md)

OpenAI **GPT Image 2** (`gpt-image-2`) 画像生成のためのミニマルな CLI + Web UI。OAuth（ChatGPT Plus/Pro 経由で無料）または API キーに対応。並列生成、複数参照画像、CLI 自動化、履歴の永続化をサポート。

![ima2-gen スクリーンショット](../assets/screenshot.png)

---

## クイックスタート

```bash
# インストール不要で即実行
npx ima2-gen serve

# もしくはグローバルインストール
npm install -g ima2-gen
ima2 serve
```

初回起動時に認証方式を選択します:

```
  認証方式を選択してください:
    1) API Key  — OpenAI API キーを貼り付け（有料）
    2) OAuth    — ChatGPT アカウントでログイン（無料）
```

Web UI は `http://localhost:3333` で開きます。

---

## 機能

スクリーンショットに写っている機能はすべて現行版で動作します。

### 認証
- **OAuth** — ChatGPT Plus/Pro アカウントでログイン、1 枚あたり $0
- **API Key** — `sk-...` キーを貼り付け、呼び出しごとに課金

左パネルに状態がリアルタイム表示（緑=準備完了、赤=無効）。API キーはデフォルトで無効化、OAuth がメイン経路。

### 生成コントロール
| 項目 | 選択肢 |
|------|--------|
| **Quality** | Low（高速）· Medium（バランス）· High（最高） |
| **Size** | `1024²` `1536×1024` `1024×1536` `1360×1024` `1024×1360` `1824×1024` `1024×1824` `2048²` `2048×1152` `1152×2048` `3824×2160` `2160×3824` · `auto` · カスタム |
| **Format** | PNG · JPEG · WebP |
| **Moderation** | Low（緩め）· Auto（標準） |
| **Count** | 1 · 2 · 4 並列 |

すべてのサイズは gpt-image-2 の制約に準拠: 各辺が 16 の倍数、長短比 ≤ 3:1、総ピクセル 655,360–8,294,400。

### ワークフロー
- **マルチリファレンス** — 最大 5 枚の参照画像を添付、左パネルのどこへでもドラッグ&ドロップ
- **プロンプト+コンテキスト** — テキストと参照画像を 1 リクエストで統合
- **Use current** — 選択中の画像をワンクリックで新しい参照として再利用
- キャンバスから直接 **Download** · **Copy to clipboard** · **Copy prompt**
- 下部の **固定ギャラリーストリップ** — 絶対にスクロールしない固定位置
- **ギャラリーモーダル (+)** — 履歴全体をグリッドで表示
- **セッション永続化** — 生成中にリロードしても保留中のジョブは自動復元

### CLI (ヘッドレス自動化)
```bash
ima2 gen "a shiba in space" -q high -o shiba.png
ima2 gen "merge these" --ref a.png --ref b.png -n 4 -d out/
ima2 ls -n 10
ima2 ps
ima2 ping
```

全コマンド一覧は下記 ↓

---

## CLI コマンド

### サーバーコマンド
| コマンド | エイリアス | 説明 |
|---------|---------|------|
| `ima2 serve` | — | Web サーバー起動（初回は自動セットアップ） |
| `ima2 setup` | `login` | 認証方式の再設定 |
| `ima2 status` | — | 現在の設定と認証状態 |
| `ima2 doctor` | — | 環境と依存関係の診断 |
| `ima2 open` | — | ブラウザで Web UI を開く |
| `ima2 reset` | — | 保存された設定をクリア |
| `ima2 --version` | `-v` | バージョン表示 |
| `ima2 --help` | `-h` | ヘルプ表示 |

### クライアントコマンド (`ima2 serve` が必要)
| コマンド | 説明 |
|---------|------|
| `ima2 gen <prompt>` | CLI から画像を生成 |
| `ima2 edit <file>` | 既存画像を編集（`--prompt` 必須） |
| `ima2 ls` | 最近の履歴（テーブルまたは `--json`） |
| `ima2 show <name>` | 履歴アイテムを表示（`--reveal`） |
| `ima2 ps` | 進行中ジョブ一覧（`--kind`, `--session`） |
| `ima2 ping` | 稼働中サーバーのヘルスチェック |

稼働中のサーバーは `~/.ima2/server.json` で自己広告します。クライアントは自動検出、`--server <url>` または `IMA2_SERVER=...` で上書き可能。

### 終了コード
`0` 成功 · `2` 不正な引数 · `3` サーバー到達不能 · `4` APIKEY_DISABLED · `5` 4xx · `6` 5xx · `7` 安全拒否 · `8` タイムアウト。

---

## ロードマップ

公開ロードマップ — 変更されることがあります。バージョン番号は実際のリリースサイクルを反映。

### ✅ リリース済み
- **0.06** セッション DB — SQLite ベースの履歴 + サイドカー JSON
- **0.07** マルチリファレンス — 最大 5 枚、i2i を統一フローに統合
- **0.08** Inflight 追跡 — リロード耐性のある pending 状態、フェーズ追跡
- **0.09** ノードモード（開発用） — 分岐生成用のグラフベースキャンバス
- **0.09.1** CLI 統合 — `gen / edit / ls / show / ps / ping` + `/api/health` + ポート広告

### 🚧 0.10 — Compare & Reuse（現行サイクル）
- **F3 プロンプトプリセット** — `{prompt, refs, quality, size}` バンドル保存/適用
- **F3 ギャラリー groupBy** — `preset / date / compareRun` グルーピング
- **F2 バッチ A/B 比較** — 1 プロンプトから 2〜6 並列バリアント、キーボード判定（`1-6`, `Space`=勝者, `V`=変形, `P`=プリセット保存）
- **F4 Export バンドル** — 選択画像を zip 化（`manifest.json` + 画像別プロンプト `.txt`）
- 全サーバー動詞に CLI ミラーを同梱（`ima2 preset / compare / export`）

### 🔭 0.11 — カードニュースモード
- Instagram カルーセル生成（4 / 6 / 10 枚）
- `file_id` ファンアウトによるスタイル一貫性（`previous_response_id`・seed 不使用）
- スタイルチェーンを壊さない並列カード再生成

### 🔭 0.12 — スタイルキット
- スタイル参照アップロードによるハウススタイルプリセット
- アイデンティティ重視編集向けのオプション `input_fidelity: "high"`

### 🗂 バックログ
- Web UI ダーク/ライト切替
- キーボードショートカットのチートシートオーバーレイ
- 共同セッション（WebSocket 経由の SQLite 共有）
- カスタム後処理用プラグインシステム

---

## アーキテクチャ

```
ima2 serve
  ├── Express サーバー (:3333)
  │   ├── GET  /api/health         — version, uptime, activeJobs, pid
  │   ├── GET  /api/providers      — 利用可能な認証方式
  │   ├── GET  /api/oauth/status   — OAuth プロキシのヘルスチェック
  │   ├── POST /api/generate       — text+ref → image（n 並列）
  │   ├── POST /api/edit           — 参照中心の編集パス
  │   ├── GET  /api/history        — ページング済みサイドカー一覧
  │   ├── GET  /api/inflight       — 進行中ジョブ（kind/session フィルタ）
  │   ├── GET  /api/sessions/*     — ノードグラフセッション（開発用）
  │   ├── GET  /api/billing        — API クレジット / コスト
  │   └── 静的ファイル (public/)   — Web UI
  │
  ├── openai-oauth プロキシ (:10531) — 埋込 OAuth リレー
  └── ~/.ima2/server.json          — CLI 自動検出用ポート広告
```

**ノードモード**は開発用のみ (`npm run dev`)。セッション DB + マルチユーザー対応が完了するまで npm 公開版では無効化。

---

## 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `OPENAI_API_KEY` | — | OpenAI API キー（OAuth をスキップ） |
| `PORT` | `3333` | Web サーバーポート |
| `OAUTH_PORT` | `10531` | OAuth プロキシポート |
| `IMA2_SERVER` | — | クライアント: 対象サーバー URL の上書き |

---

## API 料金（API キーモードのみ）

| Quality | 1024×1024 | 1024×1536 | 1536×1024 | 2048×2048 | 3840×2160 |
|---------|-----------|-----------|-----------|-----------|-----------|
| Low     | $0.006    | $0.005    | $0.005    | $0.012    | $0.023    |
| Medium  | $0.053    | $0.041    | $0.041    | $0.106    | $0.200    |
| High    | $0.211    | $0.165    | $0.165    | $0.422    | $0.800    |

**OAuth モードは無料** — 既存の ChatGPT Plus/Pro 契約から課金されます。

---

## 開発

```bash
git clone https://github.com/lidge-jun/ima2-gen.git
cd ima2-gen
npm install
npm run dev    # --watch + ノードモード有効
npm test       # 51+ テスト
```

---

## トラブルシューティング

**ポートが使用中 / 「なぜ 3457?」**
→ デフォルトは `3333`。シェルで `PORT` が設定されていると（例: `cli-jaw` などの別サーバーから継承）その値を使います。解除するか `PORT=3333 ima2 serve` で実行。

**`ima2 ping` がサーバー到達不能**
→ `ima2 serve` は起動中? `~/.ima2/server.json` を確認。`ima2 ping --server http://localhost:3333` で上書き可。

**OAuth ログイン不可**
→ `npx @openai/codex login` を手動実行後 `ima2 serve`。

**画像が生成されない**
→ `ima2 status` で設定確認。API キーは `sk-` で始まる必要があります。

---

## ライセンス

MIT
