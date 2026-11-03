# S1 导演与作品证据（历史）

本目录存放原始模型响应、素材观察、视频回执、费用及质量反馈。**它们是旧方法/旧引擎的历史样本，不代表当前 huashu-motion 方法 2.1.0 已验收。** 当前作品覆盖、授权与部署统一见[实施状态](../../implementation-status.md)；内部评测入口见 [evals](../../../research/evals/README.md)。

## 作品与质量结论

| 样本 | 有效证据 | 未通过的部分 |
| --- | --- | --- |
| MiniMax Pocket-pet，15 秒横竖片 | [候选指标](minimax-pocket/candidate-metrics.json)、[质量反馈](minimax-pocket/owner-review.json) | 技术导出/冷审通过，但动态单调、同画面停留过久，未获发布接受 |
| Duolingo，15 秒低清审片 | [完整媒体指标](duolingo-score-render/complete-metrics.json)、[后续导演回执](custom-method150-attempt/summary.json) | 多轮中断于镜头、接缝、E 修订、模型错误；不能将低清片当作最终高清成片 |
| 原生自写/分镜修复试验 | [原生响应](custom-eleventh-attempt/d-responses.json)、[seek 诊断](custom-eleventh-attempt/seek-diagnosis.json)、[布局核验](card-layout/layout-check.json) | 独立定点帧通过不等于全片视觉一致或自动导演完成 |
| 旧完整片候选 | [MiniMax 旧候选](minimax-15/candidate.json)、[完整回执](minimax-15/report.json)、[质量反馈](minimax-15/owner-review.json) | 冷审技术通过不等于用户愿意发布 |

已记录的自动创作覆盖仅 **1/12 输入、2/24 最终片**，同题改版和人工稿不增加覆盖。人工横屏稿及后续竖屏修订有独立质量/视听证据，但不转记为自动导演成功。正常速度画面、声音、文字可读性和负责人反馈必须与技术检查分开。

## 失败与费用索引

| 类型 | 原始回执 |
| --- | --- |
| 模型截断、无 usage 或工具参数错误 | [方向截断](third-attempt/report.json)、[E 工具参数](eighth-attempt/report.json)、[网关请求失败](minimax-eighth-attempt/report.json) |
| D 阶段断连与上游 502 | [D HTTP 502](custom-seventh-attempt/report.json)、[D 无工具/usage](custom-tenth-attempt/report.json)、[E 无 usage](custom-method150-attempt/summary.json) |
| 素材可见性、时序、接缝和阅读约束 | [seek 检查](custom-eleventh-attempt/seek-diagnosis.json)、[修订帧比较](custom-eleventh-attempt/local-scene-repair.json)、[最终媒体](panel-performance/final-render.json) |
| 音频末段超峰与纠正 | [原始反例](minimax-pocket/sfx-db-metrics.json)、[修正后的媒体核验](minimax-pocket/aac-gate-metrics.json) |

模型费用按调用时价格与原始 usage 记账，缺失 usage 的请求保留未知预留，不按 0 处理、不重复派发。计算费用为资源使用的保守上界，不能与供应商账单混为一谈。未知请求、原 callId 和保留在私有 R2/本机 `artifacts/` 的诊断必须用于后续对账；最新汇总金额只在[实施状态](../../implementation-status.md#有效授权与费用)维护。

原始 JSON、授权、模型流和媒体引用留在本目录，供问题复现与对账。
