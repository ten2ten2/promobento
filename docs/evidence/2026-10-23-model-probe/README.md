# 2026-10-23 模型能力探针（模幻空间）

实测[云端动效管线改造方案](../../plans/cloud-motion-v3.md)第 6.11 节绑定的模型，经模幻空间（`https://api.modelswitch.org/v1`，OpenAI 兼容接口）实际支持哪些能力。

## 运行

- **历史代码**：[归档探针](../../../research/model-probe/archive/probe-2026-10-23.mjs)。当时密钥来自仓库 secret `MODEL_COMPAT_API_KEY`，报告里不含密钥。该探针不经过统一预算账本，现已停用 Actions 入口；不能用它继续付费复测。
- **第一轮**：GitHub Actions [39904369687](https://github.com/ten2ten2/promobento/actions/runs/39904369687)，提交 `fa296fb`，测 4 个模型。报告：[run1.json](run1.json)。
- **第二轮**：[39904908372](https://github.com/ten2ten2/promobento/actions/runs/39904908372)，提交 `805bc4c`。只测 Sonnet 5.5 和 DeepSeek，补测更简单的工具调用（不传 `tool_choice`、简单 Schema）和 `json_object` 模式。报告：[run2.json](run2.json)。
- **测法**：
  - 工具调用：要求模型调用一个给定函数，核对函数名和参数。
  - 看图：一张左红右蓝的 96×96 PNG（data URL），要求按顺序说出两种颜色。
  - JSON Schema：`response_format: json_schema`（`strict`），要求输出一个片子规格。
  - 推理强度：传 `reasoning_effort: "low"`，看是否被接受。
  - 缓存：约 4.5k token 的相同前缀连发两次，读第二次的 `prompt_tokens_details.cached_tokens`。

## 第一、二轮结果（历史）

| 能力 | deepseek-v4.1-flash-1017 | gemini-3.8-flash | claude-sonnet-5-5 | claude-opus-5-5 |
| --- | --- | --- | --- | --- |
| 基本调用耗时 | 4.5 s | 51.7 s | 2.3 s | 2.3 s |
| 流式首 token | 2.1 s | 25.0 s | 2.3 s | 2.0 s |
| 流式中返回 usage | 是 | 是 | 是 | 是 |
| 工具调用 | ✅ 两种写法都正确 | ⚠️ 调用了函数但参数为空 `{}` | ❌ 502（两种写法都是） | ❌ 502 |
| 看图 | ✅ | ✅ | ✅ | ✅ |
| `json_schema` 强约束 | ❌ 被忽略，输出 Markdown | ❌ 被忽略 | ❌ 被忽略 | ❌ 被忽略 |
| `json_object` 模式 | ✅ | 未测 | ✅ | 未测 |
| `reasoning_effort` | 接受 | 接受 | 接受 | 接受 |
| 缓存命中字段 | ✅ 4096 / 4336 | ❌ 未返回 | ✅ 6580 / 7235 | ✅ 19885 / 21075 |
| 隐藏提示 token | 无（"pong" 计 27 token） | 无（计 6 token） | **约 6.5k**（"pong" 计 6533 token） | **约 6.8k**（计 6799 token） |

## 第一、二轮结论（后续已更新）

- 网关的 Claude 线路**不支持工具调用**，所以 D（自写镜头）、E（整片 review）这类需要工具的步骤不能绑到网关的 Claude 上。
- 网关的 Claude 线路在每次调用前**注入约 6.5–6.8k token 的隐藏提示**，按输入计费（多数会被缓存），内容不明，可能影响模型行为；这也说明网关的 Claude 很可能不是直连官方 API。
- **没有一个模型遵守 `json_schema`**。结构化输出一律用 `json_object` 或提示约束，再在本地按 Schema 校验（方案第 6.1 节的降级路径）。
- **DeepSeek V4.1 Flash 能看图**，工具调用正确，缓存生效，速度快，价格最低。
- **Gemini 3.8 Flash 很慢**（首 token 25 秒、单次 50 秒），工具参数丢失，缓存字段不返回，不适合本管线。
- 每个模型都接受 `reasoning_effort`，但没有验证它是否真的改变了推理强度。

## 复测：工具调用修复后

网关告知 Claude 的工具调用已修复，同日用原探针重跑两次（代码未改）：

- **第三轮**：[39919957207](https://github.com/ten2ten2/promobento/actions/runs/39919957207)，报告：[run3.json](run3.json)。
- **第四轮**：[39920866987](https://github.com/ten2ten2/promobento/actions/runs/39920866987)，报告：[run4.json](run4.json)。

| 能力 | deepseek-v4.1-flash-1017 | gemini-3.8-flash | claude-sonnet-5-5 | claude-opus-5-5 |
| --- | --- | --- | --- | --- |
| 工具调用 | ✅ 不变 | ❌ 基本调用即 502（约 60 s 超时） | ✅ 两种写法都正确（原为 502） | ✅ 两种写法都正确（原为 502） |
| 看图 | ✅ 不变 | 未测到 | ❌ **回归**：两轮都回答"没看到图片" | ❌ **回归**：两轮都回答"没看到图片" |
| `json_object` | ✅ | — | ✅ | ✅ |
| 缓存命中字段 | ✅ 4096 / 4336 | — | ✅ 6724 / 7235 | ✅ 6652 / 7235 |
| 输入 token 异常 | 无 | — | 隐藏提示仍约 6.7k；有的调用只计 134–564 | **单次调用最高计 109,918 token**（工具调用）、108,543（流式）、75,359（缓存测试）；同类请求有时只计 518 |

- 工具调用已修复。但看图在 Claude 线路上失效：图片似乎没有传到模型。原先绑定在网关 Sonnet 上的冷审 F 需要看图，**现在不可用**。
- Opus 的输入 token 波动极大，同样的小请求从约 500 到约 11 万 token 不等，按输入计费。按目录价，11 万未缓存 token 一次约 0.29 元（约 0.043 美元）。多出来的内容不明，可能是网关注入的上下文，涉及成本和数据边界，需要网关解释。
- Gemini 两轮基本调用都是 502，本管线不使用。

## 未测

真实提示长度下的质量、长输出的稳定性、并发限流。历史费用状态见下节。

## 历史费用：128 次请求，尚未对账

[`history.mjs`](../../../research/model-probe/history.mjs) 从上述四份原始报告逐次提取请求（缓存测试的两次请求分别计入），生成不可变的 [`opening-spend.json`](opening-spend.json)。共 128 次，其中 114 次有目录价格和 usage，按记录价折算合计 **255,521 usd_micros（约 $0.256）**；另有 14 次缺 usage 或历史价格，保留 `quote:null`，不记作零。

[`pricing-catalog.json`](pricing-catalog.json) 是 2026-10-24 从仓库 `models-2026-10-23` 目录冻结的计价依据，不是供应商历史账单。每个可计价条目同时保存原币金额、汇率、价格和目录版本；上述金额是可计价部分的目录估算，既不是最终账单，也不证明本次授权以来没有其他请求。

负责人目前没有可提供的使用统计或脱敏导出，**历史总额保留未确认**。共享 `MODEL_LEDGER` 先导入清单，默认在负责人确认全部历史消费前拒绝新付费请求；2026-10-24 负责人另行授权有限放宽，临时风险预留与新增累计上限见 [14 预算契约](../../prd/14-production-contracts.md#6-ai操作费用与成功次数)。历史确认字段和本节原始清单不变，媒体与恢复工作可独立继续。后续确认入口及证据结构见 [cloud README](../../../apps/cloud/README.md#研究模型共用一份预算)。

## 当前步骤绑定

`config/model-providers.json` 保留第三、四轮的网关 Claude 结果：工具可用、视觉不可用。2026-10-24 负责人提供[网关文档](https://api.modelswitch.org/docs)，明确 Claude 也用现有 `MODEL_COMPAT_API_KEY`；该密钥已由 [40077653946](https://github.com/ten2ten2/promobento/actions/runs/40077653946) 绑定到 staging Worker。C 恢复网关 Opus 的文本规格，F 改为已实测可看图的网关 DeepSeek，避免因官方密钥未提供而阻断整条链路；官方模型只作未绑定/未验证备用。2026-10-27 的 D 内部候选另改为显式 A 观察→Opus 文本编程，仍不向这条 Claude 线路发送图片或修改 vision:false；当前契约见 [cloud README](../../../apps/cloud/README.md#导演选择结构d-实现自写镜头)。

本次更新为 `models-2026-10-24`，Default 目录价格数值经公开模型页核对不变；上面的历史开账与 `models-2026-10-23` 计价快照原样保留，授权总额/起算不重置。没有据文档把 Claude 图片失败改为通过，也未新增付费探针；真实长提示和成片质量仍待评测。
