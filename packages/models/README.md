# 两种模型接口，共用持久预算

`src/adapters.mjs` 将固定提示、图片和工具转换为OpenAI-compatible／Anthropic请求，读取真实SSE文本、工具参数、usage、首token／总耗时。适配器只发一次；重试与结构纠正由持久调用方按原预算授权，无usage、截断、拒绝或断流不记免费成功。

## 请求与校验

- Anthropic使用显式一小时前缀缓存和output_config.format；网关按登记能力使用json_object，不把它当JSON Schema强保证。结果仍经共享parseCanonicalJson和预编译校验器。
- 调用方显式指定1–32,768输出token；这是适配器边界，不是全部步骤默认值。共享／阶段账本按实际上限预留，再按usage结算。
- 可选 `toolChoice:'edit_file'` 序列化为命名tool_choice，必须对应已声明工具；省略保留默认行为。当前仅已测DeepSeek路线指定，网关Claude／原生Anthropic不强制；参数被接受不证明供应商实际执行了该语义。
- `parseModelJson` 只允许完整单一Markdown json围栏去包络，仍用同一严格解析器；不从散文提取片段、不修补残缺JSON、不忽略重复键。原始响应保持不改写。
- 密钥只通过可信Worker／Actions绑定传入，不写源包、产物或日志。步骤绑定、能力和价格见 [model-providers](../../config/model-providers.json)，当前D输入合同见 [cloud README](../../apps/cloud/README.md#导演选择结构d-实现自写镜头)。

## 先保留用量，再返回失败

终态截断／拒绝抛 `ModelOutputError`，result保留partial text、失败码、流结束状态和后到usage，供持久层先保存／计费再落失败。工具参数非法也保留原arguments、usage及MODEL_TOOL_JSON_INVALID，不能让JSON异常先丢掉费用证据。

完整usage按冻结目录结算；无usage的HTTP／传输失败保留未知预留。完整但不合法的结果只可在原次数／金额内结构纠正；无usage则要求对账，不自动重发。持久层按原callId／价格补账，不用输出上限伪造实收。

实际模型能力和反例见[模型证据](../../docs/evidence/2026-10-23-model-probe/README.md)，当前作品验收只见[实施状态](../../docs/implementation-status.md)。
