# 2026-10-23 S1 前置探针

开始 S1 之前，在 Cloudflare 账户上实测三项[云端动效管线改造方案](../../plans/cloud-motion-v3.md)依赖但还没测过的能力：Workers AI 语音识别、Browser Run，以及生产形态镜像的冷启动。这些都是临时探针，不是产品代码。

## 运行

- **代码**：
  - 语音与 Browser Run：[probe.mjs](../../../research/pre-s1-probe/probe.mjs)、[工作流](../../../.github/workflows/pre-s1-probe.yml)；提交 `7d65a8d` 为第一轮，`1ebf1fb` 改用数字写法的参考文本并加入词表提示。
  - 冷启动：[G1 预探针](../../../apps/render-container/probes/g1-pre/)的 `coldStart` 项（提交 `4631a70`），[工作流](../../../.github/workflows/g1-pre-probe.yml)以 `only=coldStart` 手动运行，结束后删除 Worker 与容器应用。
- **GitHub Actions 运行**：
  - 语音与 Browser Run：[39916005742](https://github.com/ten2ten2/promobento/actions/runs/39916005742)（第一轮）、[39916567470](https://github.com/ten2ten2/promobento/actions/runs/39916567470)（第二轮，报告取这一轮）。
  - 冷启动：[39916102267](https://github.com/ten2ten2/promobento/actions/runs/39916102267)。
- **原始报告**：[speech-browser-report.json](speech-browser-report.json)、[cold-start-report.json](cold-start-report.json)。Worker 地址已脱敏；合成音频和第三方网页截图只留在 CI 产物里，不进 Git。
- **费用**：Workers AI 与 Browser Run 合计不到 0.01 美元；冷启动约 25 个 standard-3 实例各运行数秒。

## 语音识别

用 Workers AI 的 MeloTTS 合成中、英、日三段 6–9 秒的宣传口播，每段有两个版本：干净的，以及叠加两个持续音和粉噪声（约低于人声 12 dB）的"配乐底"版本。参考文本里的数字用阿拉伯数字，英文按词算 WER，中日文按字算 CER，忽略标点、大小写和空格。

| 模型 | 英文 WER | 中文 CER | 日文 CER | 耗时 | 价格 |
| --- | --- | --- | --- | --- | --- |
| `whisper-large-v3-turbo` + 词表提示 | 0（干净 / 配乐底） | 0.088 / 0.118 | 0.081 / 0.189 | 0.6–2.5 s | $0.000513/分钟 |
| `whisper-large-v3-turbo` | 0.143 / 0.143 | 0.118 / 0.147 | 0.081 / 0.189 | 1.0–1.8 s | 同上 |
| `whisper` | 0.143 / 0.143 | 0.353 / 0.353 | 0.243 / 0.189 | 0.7–29 s | 未标价 |
| `deepgram/nova-3` | 0.143 / 0.143 | 不支持中文 | 0.189 / 0.189 | 0.1–0.6 s | $0.0052/分钟 |

- **词表提示**是把题目里的产品名（`LeetCode, DeepSeek, MiniMax, Duolingo, JLPT N2, IELTS, 128K`）作为 Whisper 的 `initial_prompt`。它把 "Leak Code" 纠正为 LeetCode、"DeepSick" 纠正为 DeepSeek，其他错误不变。
- **剩下的错误**：
  - 中文同音字：写→鞋/携带，免费→免贼（配乐底）；
  - 日文：N2 识别成「2」，「十分」写成「10分」，配乐底下「能力」识别成「売り億」。
- **逐词时间**：turbo 每段返回 24–31 个带时间戳的词，可以直接用于字幕和 `OM.cue` 锚点。
- **nova-3** 中文报 "No such model/language/tier combination"，日文输出带空格的汉字数字。
- **局限**：合成人声比真人清楚，部分错误可能出在 TTS 发音上；两轮之间 TTS 重新合成，结果略有差异。真人录音的准确率要在 S3 用真实素材复测。

**结论**：沿用方案的 `whisper-large-v3-turbo`，并把 brief 里已确认的产品名、术语作为 `initial_prompt` 传入。中日文的残余错误说明转写稿必须先经用户确认，才能用于字幕和事实绑定（方案第 8 节已这样规定）。nova-3 不作为备选。

## Browser Run

REST 接口在 `/browser-rendering/` 下可用，部署 Token 有权限；`/browser-run/` 路径未测试，因为第一个路径已成功。

| 页面 | Markdown | 截图 | 计费浏览器时间 |
| --- | --- | --- | --- |
| example.com | 200，991 字符，2.4 s | 200，90 KB | 2.2 s |
| duolingo.com | 200，13,145 字符，8.5 s | 200，99 KB | 8.0 s |
| deepseek.com | 200，但正文是 "Application error: a client-side exception has occurred" | 200，12 KB | 2.8 s |
| minimax.io | 200，12,502 字符，2.9 s | 200，309 KB | 2.5 s |
| leetcode.com | 200，5,174 字符，5.0 s | 200，202 KB | 4.7 s |

**结论**：网址抓取可用。但有的站点在无头浏览器里前端报错，返回 200 却没有正文（deepseek.com）。抓取结果要检查正文是否有效，无效时提示用户上传截图或粘贴文字，不能把报错页当作素材或事实来源。

## 冷启动

镜像与 G1 预探针相同：Node 22、Chrome for Testing 151、ffmpeg、字体和上游站点，共 1.05 GB，接近生产渲染镜像。每个样本都是新的 Durable Object 和新实例（standard-3，2 vCPU、8 GB），依次计时：

1. 实例启动到控制器就绪；
2. 以独立 uid 启动沙箱内的 Chromium；
3. 加载一个 2D 模板，seek 到第 0 帧并截一张 JPEG。

| 段 | p50 | p95 | 最大 | 样本 |
| --- | --- | --- | --- | --- |
| 实例就绪 | 1.24 s | 8.95 s | 11.3 s | 25 |
| Chromium 启动 | 0.85 s | 1.16 s | 1.23 s | 25 |
| 页面加载 | 0.75 s | 0.85 s | 1.34 s | 25 |
| 首帧合计（启动、加载、截图） | 2.07 s | 2.48 s | 2.87 s | 25 |
| 从发起启动到拿到首帧 | 3.77 s | 11.9 s | 13.8 s | 25 |

- 样本：顺序 10 个；6 个一批并发两批（相当于一次渲染的分段数）；空闲 10 分钟后再顺序 3 个。
- **慢启动**：超过 8 秒的 3 次都出现在部署后的前 7 次启动里（第 1 个顺序样本，以及第一批并发中的 2 个）。之后 19 次全部在 2.3 秒以内，空闲 10 分钟后也没有再变慢。看起来是镜像首次分发到所在地点的开销，本次未能确认。
- 两批并发的总耗时分别为 12.2 s（含 2 个慢启动）和 5.2 s。

**结论**：

- 每个分段的固定开销通常约 4 秒，长尾约 12–14 秒。对"30 秒纯 2D 成片 ≤ 60 秒"的目标来说可以接受。方案第 5.3 节"实例冷启动加握手 30 秒"的期限有足够余量。
- 部署后应先启动几个实例预热，避免第一批客户任务遇到慢启动。G1 时要用生产镜像复测，并确认慢启动是否来自镜像分发。
