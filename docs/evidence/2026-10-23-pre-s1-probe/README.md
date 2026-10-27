# ASR、抓取与冷启动前置证据

2026-10-23临时探针，不是客户素材管线实现。原始报告：[speech-browser-report](speech-browser-report.json)、[cold-start-report](cold-start-report.json)。代码为 [pre-s1-probe](../../../research/pre-s1-probe/probe.mjs)／[工作流](../../../.github/workflows/pre-s1-probe.yml)和 [G1预探针](../../../apps/render-container/probes/g1-pre/)。当前集成范围只见[实施状态](../../implementation-status.md)。

## ASR：合成小样本仍需人工确认

[39916567470](https://github.com/ten2ten2/promobento/actions/runs/39916567470)使用中／英／日各6–9秒MeloTTS合成口播，干净与约低12dB配乐底两个版本；英文按WER、中日按CER，忽略标点／大小写／空格。词表提示为已确认产品名／术语。

| 路线 | 英文WER（干净／底乐） | 中文CER | 日文CER | 耗时 |
| --- | --- | --- | --- | --- |
| whisper-large-v3-turbo＋词表 | 0／0 | 0.088／0.118 | 0.081／0.189 | 0.6–2.5秒 |
| turbo无词表 | 0.143／0.143 | 0.118／0.147 | 0.081／0.189 | 1.0–1.8秒 |
| whisper | 0.143／0.143 | 0.353／0.353 | 0.243／0.189 | 0.7–29秒 |
| nova-3 | 0.143／0.143 | 该路线不支持 | 0.189／0.189 | 0.1–0.6秒 |

turbo返回24–31个词时序，但中文同音字、日文N2／数字等仍有错；合成人声不代表真人质量，TTS重合成也影响两轮可比性。S3沿用turbo候选＋词表，在真实用户音频验证；转写和时序须确认后用于字幕／事实绑定，不把“返回时间戳”写成可直接放行。实际报价执行时按冻结目录重新登记，不沿用本页旧价格。

## Browser Run：成功响应不证明有效正文

[39916567470](https://github.com/ten2ten2/promobento/actions/runs/39916567470)经/browser-rendering/ REST，用部署Token访问example、Duolingo、DeepSeek、MiniMax、LeetCode。均返回截图／HTTP200，但DeepSeek正文实际是前端报错；不能把200或截图存在当事实／可用素材。原始逐站字节、耗时和计费浏览器时间在报告。

只证明当时接口／账户权限，不证明抓取许可、SSRF防护或客户入口。S3需核对处理权利、公网地址／重定向、有效内容和用户事实；失败时引导上传合法素材。

## 冷启动：旧模板环境，不能替代正式G1

[39916102267](https://github.com/ten2ten2/promobento/actions/runs/39916102267)，4631a70：Node22／Chromium151／FFmpeg／上游字体模板的1.05GB镜像，25个新DO／standard-3实例（十串行、两批六并发、空闲十分钟后三串行），断网且独立uid沙箱。

| 测量 | p50／p95／最大秒 |
| --- | --- |
| 实例ready | 1.24／8.95／11.3 |
| Chromium启动 | 0.85／1.16／1.23 |
| 页面加载 | 0.75／0.85／1.34 |
| 发起启动至首帧 | 3.77／11.9／13.8 |

慢启动集中在部署早期，镜像分发只是推测，未独立验证；不由此规定付费预热或宣称当前45秒控制器窗口必足够。临时Worker／应用已收尾，正式资源／镜像的分布和失败见[当前性能](../2026-10-24-s1-performance/README.md)。
