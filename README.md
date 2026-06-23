# 小宇宙播客转录下载工具

零依赖 Node.js 脚本，用来下载小宇宙官方已有文稿并保存为本地文件。

不下载音频，不做本地 ASR。某一集如果没有小宇宙官方文稿，脚本会明确报错。

## 推荐流程

先登录一次：

```bash
node xiaoyuzhou-transcript.mjs auth send-code 13800138000
node xiaoyuzhou-transcript.mjs auth login 13800138000 123456
```

凭证会保存在：

```text
~/.opencli/xiaoyuzhou.json
```

之后下载任意有官方文稿的单集，只需要传单集 URL：

```bash
node xiaoyuzhou-transcript.mjs \
  "https://www.xiaoyuzhoufm.com/episode/699f1af58c5f11f410f84650" \
  -o downloads
```

输出 `.json`、`.raw.json`、带时间戳 `.txt`、纯文本 `.raw.txt` 和 `.srt`。

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
