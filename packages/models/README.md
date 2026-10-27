# 两种模型接口，共用持久预算

`src/adapters.mjs` 将固定提示、图片和工具声明转换为 OpenAI-compatible / Anthropic 请求，读取真实流式文本、工具参数、usage 与首 token/总耗时。适配器只发送一次请求；重试必须由持久阶段预算授权。无 usage、截断、拒绝或流中断不能记作免费成功。

Anthropic 使用显式 1 小时前缀缓存和 `output_config.format`；网关使用已实测的 `json_object`，不能把它当 JSON Schema 保证。结果仍须由调用方经共享解析器与对应预编译验证器校验。密钥只从 Worker/Actions 绑定传入，不写源包、产物或日志。

需要指定原生工具时，兼容接口调用可传 `toolChoice: 'edit_file'`，序列化为命名 `tool_choice`；它必须对应已声明工具。省略则保留既有默认行为。D 只在已测兼容 DeepSeek 路线上指定它；原生 Anthropic 与网关 Claude 都省略，不影响原有默认调用。DeepSeek 官方要求先用 `reasoning_effort:none` 关闭思考才能强制工具，见[官方契约](https://api-docs.deepseek.com/api/create-chat-completion/)；[实际 D 请求](../../docs/evidence/2026-10-24-s1-director/README.md#第四次自写评测命名工具参数未解决整段生成截断)仍以零工具截断，不能以本地序列化或官方语义证明 ModelSwitch 已遵守参数。

终态截断/拒绝抛出 `ModelOutputError`，其 `result` 保留 partial text、失败码、流结束状态和后续 usage，供持久层先记录/计费再落失败；不会返回可用结果或自动重试。HTTP/传输中断仍是未知消费；缺少实际 usage 时不能用输出上限伪造实收。

调用方须显式指定输出额度，适配器接受 1–32,768 token；这不是所有步骤的默认值。D 动作补丁在真实 16k 截断后改用 32k，布局和 E/F 等既有请求保持原额度。共享/阶段预算仍按实际请求上限先预留，完整 usage 再结算。DeepSeek [官方接口](https://api-docs.deepseek.com/api/create-chat-completion/)允许更高输出额度；现有网关 DeepSeek 已实际报告 25,027 个输出 token 并返回首段补丁；后续仍出现无工具、无 usage 的响应，完整镜头未通过。当前 D 的 Opus 文本代码候选与 A 看图观察的输入约定见 [cloud README](../../apps/cloud/README.md#导演选择结构d-实现自写镜头)，不把 Claude 的 vision:false 改成通过。

完整工具响应的参数 JSON 也可能不合法。适配器保留原 arguments、usage 与 `MODEL_TOOL_JSON_INVALID`，不让解析异常先于费用回执丢失响应。持久层先保存/结算，再反馈一次结构纠正；没有实际 usage 则保留预留并要求对账，不启动纠正。正常工具参数仍由共享严格解析器解析，不修补残缺 JSON 或忽略重复键。

`parseModelJson` 先尝试共享 `parseCanonicalJson`；只对完整单一 Markdown json 代码围栏去包络后再用同一严格解析器。不会从散文抽取某段 JSON，也不会放宽重复键或后续 Schema 校验；原回执保存不改写的文本。
