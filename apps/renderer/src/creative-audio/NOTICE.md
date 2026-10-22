# 音频移植来源

上游为 [huashu-motion@5f2608c2e12abcf518f74dde86093b19f7f88603](https://github.com/alchaincyf/huashu-motion/tree/5f2608c2e12abcf518f74dde86093b19f7f88603)，Copyright (c) 2026 Huashu，保留完整 [MIT 许可](LICENSE.huashu)。

| 本地文件 | 上游路径 | 采用与修改 |
| --- | --- | --- |
| `dsp.mjs`、`fx.mjs` | `cli/lib/dsp.js`、`fx.js` | 固定 48 kHz 合成、滤波、混响、延迟、chorus、saturation、宽度及压缩；相对模块路径改为 `.mjs`。 |
| `composer.mjs` | `cli/lib/composer.js` | ABC 解析和演奏；增加输入、操作、音符、声部及数值限额，修复未闭合字段循环，隔离对象键。 |
| `score.mjs` | `cli/lib/score.js` | 13 种程序曲式及合成音色；删除环境采样选择、自动换音和未知音色回退，真实采样改显式 ID。 |
| `composed.mjs` | `cli/lib/composed.js` | 配器、演奏、混响、谱面剪辑；去掉 HTML 读取和自动采样替换。 |
| `sound.mjs` | `cli/lib/sound.js` 的纯计算部分 | 23 种音效、5 种 kit、音量与混音算法；去掉浏览器、文件读写、FFmpeg、环境变量选择与本地工程命令。最终音量仍由现有可信冻结流程实测。 |
| `samples.mjs` | `cli/lib/samples.js` 的插值及音符包络 | 固定小样本目录和有界 PCM 解码；删除目录发现、出网、静默解码失败及 `Math.random` 回退。 |
| `beats.mjs` | `cli/lib/beats.js` | 谱通量、FFT、节拍及能量分析；去掉无限额外部解码，限于已审 30 秒 PCM，显式 confidence 和 4/4 假设。 |
| `voice.mjs` | `cli/lib/voice.js` 的文本、对齐和字幕部分 | 分句、停顿分配、已确认稿对齐、SRT；删除 HTML 修改、TTS、ASR 下载和系统配音；加入插值来源及对齐限额，保留标点。 |
| `examples/*.abc` | `skills/huashu-motion/references/scores/*.abc` | 原样保留 3 个乐谱技法示例及原注释，使用时按当前帧长和权利流程改编。 |
| `../../test/creative-audio/{composer,fx}.test.mjs` | `test/{composer,fx}.test.js` | 采用纯计算验证；去掉浏览器/宿主功能和机器相关墙钟门槛。 |

`index.mjs`、`tools.mjs`、容器工具入口及两首短工程示范谱是 PromoBento 的接入代码；其受请求/许可 Schema、有界任务及冻结契约约束。

## 六个真实乐器样本

采用 [VSCO 2 Community Edition@440300901dfe9275fd84e0b7763af1f8443ae62e](https://github.com/sgossner/VSCO-2-CE/tree/440300901dfe9275fd84e0b7763af1f8443ae62e)，作者 Versilian Studios / Sam Gossner。已在下载样本前读取该 commit 的原始 CC0 1.0 许可，保留 [VSCO-LICENSE](assets/VSCO-LICENSE)。六个 WAV 保持原始字节；[登记](assets/catalog.json)逐文件保存来源路径、版本、字节长度、摘要、音高和用途。生成音乐的许可链分别保留这些 CC0 录音与具体乐谱依据。

不含 Salamander Grand Piano、Greg Sullivan/Wurlitzer 的 CC-BY 采样，不含作者卡通形象、演示口播、未知演示配乐或 Kokoro/Whisper 模型。合成 piano/rhodes 没有借用这两套录音。
