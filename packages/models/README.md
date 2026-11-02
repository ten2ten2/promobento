# 模型适配与持久费用

`src/adapters.mjs` 负责 OpenAI-compatible / Anthropic 请求、视觉/工具输入、SSE 解析及可用的用量/时延证据。适配器**只发送一次**，重试、纠错和费用由可信 Worker 持久管理。供应商与价格见 [model-providers](../../config/model-providers.json)，授权见 [model-authorization](../../config/model-authorization.json)。

## 约束

- Anthropic 使用显式 1 小时提示缓存及 `output_config.format`；兼容网关的 `json_object` 不是强 Schema 保证。模型结果总要经过 `parseCanonicalJson` 和预编译校验器。
- 请求显式给定 1–32,768 输出 token；工具选择必须指向已声明的工具，且只在该供应商支持时序列化。完整单一 Markdown JSON 围栏可解包，不从散文提取或修补不合法片段。
- 终态截断/拒绝、非法工具参数、空输出和 SSE 流内错误分别保留原始文本/arguments、失败码、usage 与已知 HTTP 状态。终态原始 SSE 存入操作私有存储并由回执引用；断线和超限流的原始字节尚未完整保留。
- 仅以完成流的可信 usage 结算；在最终标记前失败时，即使已有部分 token 统计也视为**未知费用**，保留预算和原始证据，不补零、不自动重发。已完成但格式无效的回答才能在授权的次数/金额内纠正；补账须绑定原 callId 与价格。
- 密钥仅由 Worker/Actions 可信绑定传入，不进入源码、HTML、产物或日志。当前只有原生导演方法的阶段入口，没有旧引擎备用路线。

实际模型反例见[模型证据](../../docs/evidence/2026-10-23-model-probe/README.md)；真实作品、授权有效期与部署范围见[实施状态](../../docs/implementation-status.md)。
