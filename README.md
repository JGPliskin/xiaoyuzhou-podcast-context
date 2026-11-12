# 小宇宙播客转录下载工具

零依赖 Node.js 脚本，用来下载小宇宙官方已有文稿并保存为本地文件。某一集如果没有小宇宙官方文稿，脚本会明确报错。

## 推荐流程

### 1. 配置登录凭证

**方式 A：从浏览器 Cookie 导入（推荐）**

目前小宇宙网页端短信登录通常需要前端人机校验（原 `podcaster-api` 免验证码发码接口也已返回 404）。可按下面步骤获取凭证：

1. 在浏览器打开 `https://podcaster.xiaoyuzhoufm.com` 并完成登录（扫码或短信验证）。
2. 按 `F12` 打开开发者工具，进入 **Application → Cookies → `https://podcaster.xiaoyuzhoufm.com`**，复制 `x-jike-access-token` 和 `x-jike-refresh-token` 的值。
3. 运行命令保存凭证：

```bash
node xiaoyuzhou-transcript.mjs auth set-token "<x-jike-access-token>" "<x-jike-refresh-token>"
```

**方式 B：短信验证码登录（如接口可用）**

```bash
node xiaoyuzhou-transcript.mjs auth send-code 13800138000
node xiaoyuzhou-transcript.mjs auth login 13800138000 123456
```

凭证会保存在：

```text
~/.opencli/xiaoyuzhou.json
```

### 2. 下载单集或整档播客

**下载单集**（传单集 URL 或 ID）：

```bash
node xiaoyuzhou-transcript.mjs \
  "https://www.xiaoyuzhoufm.com/episode/699f1af58c5f11f410f84650" \
  -o downloads
```

**批量下载整档播客**（传播客主页 URL 或 `--podcast <pid>`）：

```bash
node xiaoyuzhou-transcript.mjs \
  "https://www.xiaoyuzhoufm.com/podcast/6970a289446d2fd0646e978c" \
  -o downloads \
  -f txt,raw.txt
```

默认输出 `.json`、`.raw.json`、带时间戳 `.txt`、纯文本 `.raw.txt` 和 `.srt`，可通过 `-f, --formats` 指定需要的格式；批量模式下会自动跳过已存在文件、遇到无官方文稿的单集跳过并汇总、遇到 `429` 自动退避重试（可通过 `--delay`、`--limit`、`--force` 调整行为）。

## 兜底用法

公开单集页能暴露 `transcriptMediaId`，但不直接暴露字幕 CDN 的 highlight id。脚本默认通过你的登录凭证调用小宇宙官方字幕接口来换取字幕 URL。

如果已经有 HAR、字幕 CDN URL 或 highlight id，也仍然可以直接使用：

```bash
node xiaoyuzhou-transcript.mjs \
  "https://www.xiaoyuzhoufm.com/episode/699f1af58c5f11f410f84650" \
  --har "2026-06-23-190955.har" \
  -o downloads
```

```bash
node xiaoyuzhou-transcript.mjs \
  "https://www.xiaoyuzhoufm.com/episode/699f1af58c5f11f410f84650" \
  --transcript-url "https://transcript-highlight.xyzcdn.net/cdn/episode/get-highlight/..." \
  -o downloads
```

如果已经知道 highlight id：

```bash
node xiaoyuzhou-transcript.mjs \
  "https://www.xiaoyuzhoufm.com/episode/699f1af58c5f11f410f84650" \
  --highlight-id "699f1af9e329a4d9e4ba87da" \
  -o downloads
```

## 说明

`episodeId` 和字幕 CDN 的 `highlight id` 不是同一个值。默认用法不需要知道 highlight id，脚本会通过官方字幕接口获取。

检查本地凭证状态：

```bash
node xiaoyuzhou-transcript.mjs auth status
```
