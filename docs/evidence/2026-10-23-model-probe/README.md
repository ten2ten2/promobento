# 模型网关能力与历史费用证据

2026-10-23对 `https://api.modelswitch.org/v1` 的四轮真实探针。能力按固定路线和输入判断，不将第一次结果或参数接受当作当前完整质量保证。当前步骤／模型价格以 [model-providers](../../../config/model-providers.json) 为准，作品完成范围见[实施状态](../../implementation-status.md)。

## 当前可用于绑定的结论

| 网关模型 | 工具 | 视觉 | 结构化／缓存 | 限制 |
| --- | --- | --- | --- | --- |
| deepseek-v4.1-flash-1017 | 实测有效 | 实测有效 | json_object有效、json_schema不保证、自动缓存usage可见 | 长输出仍会截断／无工具／无usage，不能由小探针推导完整导演稳定性 |
| claude-sonnet-5-5／claude-opus-5-5 | 第三／四轮修复后有效 | 两轮均“没看到图片”，保持vision:false | json_object有效、缓存字段可见 | 隐藏输入和usage波动，Opus单次小请求最高109,918输入token，需保守预留和网关解释 |
| gemini-3.8-flash | 参数丢失，后来基本请求502 | 后续未测到 | 无可用稳定结论 | 不绑定当前管线 |

没有模型在本探针可靠遵守json_schema；effort仅证明参数被接受，未证明推理行为改变。官方Anthropic备用未绑定／verified:false，不把网关结果移植过去。

当前A/B/E/F使用网关DeepSeek，C/D为Opus纯文本；D显式接A按资源绑定的真实图像观察，不给Claude发送原图或改vision:false。现有MODEL_COMPAT_API_KEY已实际绑定staging并在真实导演调用，不再写“缺官方密钥阻断当前链路”。完整输入约定见 [cloud README](../../../apps/cloud/README.md#导演选择结构d-实现自写镜头)。index-tts-2尚无本仓库探针或准入，不在上述能力结论中。

## 原始报告和方法

- [run1](run1.json)：[39904369687](https://github.com/ten2ten2/promobento/actions/runs/39904369687)，fa296fb；[run2](run2.json)：[39904908372](https://github.com/ten2ten2/promobento/actions/runs/39904908372)，805bc4c。
- [run3](run3.json)：[39919957207](https://github.com/ten2ten2/promobento/actions/runs/39919957207)；[run4](run4.json)：[39920866987](https://github.com/ten2ten2/promobento/actions/runs/39920866987)，用于当前Claude工具／视觉登记。
- 测试包括命名函数及参数、96×96左右红蓝图片、json_schema/json_object、effort接受、固定约4.5k前缀两次缓存和SSE usage／时延。旧轮Claude看图成功／工具502已经被后续反例更新，原始数据不改。
- [历史脚本](../../../research/model-probe/archive/probe-2026-10-23.mjs)不经共享账本，Actions入口已停用，只作来源，不继续付费运行。长提示质量／并发和声音模型另需对应授权与真实证据。

## 历史费用：128 次请求，尚未对账

[history.mjs](../../../research/model-probe/history.mjs)从四份报告生成不可变[opening-spend.json](opening-spend.json)，128次请求中114次可按冻结[价格目录](pricing-catalog.json)与usage估算 **255,521 usd_micros**，14次缺usage／价格，quote:null，不记零。

目录快照不是历史账单；负责人尚未提供授权以来全部消费统计，openingMicros:null／openingConfirmed:false保持不变。共享MODEL_LEDGER已导入原清单，默认未对账拒绝新付费；当前有限风险放行、上限和有效期统一见[实施状态](../../implementation-status.md#有效授权与费用)及 [14预算契约](../../prd/14-production-contracts.md#6-ai操作费用与成功次数)。确认入口见 [cloud README](../../../apps/cloud/README.md#研究模型共用一份预算)，不能只把可计价114笔估算当总账。
