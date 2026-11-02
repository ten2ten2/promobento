# 模型能力与历史费用证据

2026-10-23 对 ModelSwitch 网关的四轮真实探针： [run1](run1.json)、[run2](run2.json)、[run3](run3.json)、[run4](run4.json)。这些结果绑定当时模型和价格，不是持续可用性、全长导演质量或今天的供应商账单保证。现行模型绑定、价格和有效授权分别见 [model-providers](../../../config/model-providers.json)、[model-authorization](../../../config/model-authorization.json)、[实施状态](../../implementation-status.md)。

| 当时测试模型 | 工具/视觉 | 仍须注意 |
| --- | --- | --- |
| deepseek-v4.1-flash-1017 | 工具、视觉实测有效，`json_object` 可用 | 长输出可能截断，无最终 usage 时费用未知，`json_schema` 不保证 |
| claude-sonnet-5-5 / claude-opus-5-5（网关） | 工具恢复可用，视觉测试失败 | 隐藏输入/usage 波动；Opus 单请求最多观察 109,918 输入 token，须保守预留 |
| gemini-3.8-flash | 参数丢失或 HTTP 502 | 无可用于当前管线的可靠结论 |

这组探针未证明任何模型严格遵守 JSON Schema；接受 effort 参数也不证明推理行为变化。官方 Anthropic 路线未在本组等价验证，不能照搬网关结果。原始[历史脚本](https://github.com/ten2ten2/promobento/blob/f26dc1d60e2f3c42653fc3cb633bb0f4eeb9df2d/research/model-probe/archive/probe-2026-10-23.mjs)不经过现行共享账本，不应重新运行付费请求。

## 128 次请求的历史开账

[history.mjs](../../../research/model-probe/history.mjs)由四份报告生成[opening-spend.json](opening-spend.json)：**128 次请求，114 次可估价 255,521 usd_micros，14 次 quote:null**；对应冻结[价格快照](pricing-catalog.json)。这不是历史总账确认；未取得全账户对账记录时 `openingMicros:null`、`openingConfirmed:false`，缺 usage 不能记 0。共享账本保留原始身份，临时费用放行已过期；最新余额及再次授权前提见[有效授权与费用](../../implementation-status.md#有效授权与费用)。
