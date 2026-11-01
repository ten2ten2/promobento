# 保留音频辅助与样本来源

当前影片的声音由[完整 huashu 原生运行时](../../native-motion/README.md)生成，调用边界见[渲染服务说明](../../../apps/render-container/README.md)。本目录保留音频目录、采样辅助和原始样本，供既有素材与历史记录使用；旧 AudioPlan 合成、ABC 演奏适配及节拍分析入口已退役。

[试听包装工具](../../../research/evals/prepare-audio-review.mjs)继续读取 `catalog.mjs` 的风格目录，整理已经生成的 13 段试听样本。负责人决定、原作 ABC 与派生 WAV 的依据见[试听决定](../../../docs/evidence/2026-10-24-s1-audio-review/owner-decision.json)和[原作记录](../../../docs/evidence/2026-10-24-s1-audio-review/original-score-test-clearance.json)。历史作品、冻结输入、来源记录和已发布执行环境继续保留。

## 辅助模块来源

上游为 [huashu-motion@5f2608c2e12abcf518f74dde86093b19f7f88603](https://github.com/alchaincyf/huashu-motion/tree/5f2608c2e12abcf518f74dde86093b19f7f88603)，Copyright (c) 2026 Huashu，保留完整 [MIT 许可](LICENSE.huashu)。

| 本地文件 | 上游路径 | 采用与修改 |
| --- | --- | --- |
| `dsp.mjs` | `cli/lib/dsp.js` | 采样辅助共用的固定 48 kHz DSP，保留合成、滤波、包络和插值基础。 |
| `samples.mjs` | `cli/lib/samples.js` 的插值及音符包络 | 固定小样本目录和有界 PCM 解码；删除目录发现、出网、静默解码失败及 `Math.random` 回退。 |

`catalog.mjs` 与类型声明保留旧风格、音效名称及样本时间常量；它们不构成新的影片执行器。

## 六个真实乐器样本

采用 [VSCO 2 Community Edition@440300901dfe9275fd84e0b7763af1f8443ae62e](https://github.com/sgossner/VSCO-2-CE/tree/440300901dfe9275fd84e0b7763af1f8443ae62e)，作者 Versilian Studios / Sam Gossner。已在下载样本前读取该 commit 的原始 CC0 1.0 许可，保留 [VSCO-LICENSE](../samples/VSCO-LICENSE)。六个 WAV 保持原始字节；[登记](../samples/catalog.json)逐文件保存来源路径、版本、字节长度、摘要、音高和用途。生成音乐的许可链分别保留这些 CC0 录音与具体乐谱依据。

不含 Salamander Grand Piano、Greg Sullivan/Wurlitzer 的 CC-BY 采样，不含作者卡通形象、演示口播、未知演示配乐或 Kokoro/Whisper 模型。合成 piano/rhodes 没有借用这两套录音。
