# 两种模型接口，共用持久预算

`src/adapters.mjs` 将固定提示、图片和工具声明转换为 OpenAI-compatible / Anthropic 请求，读取真实流式文本、工具参数、usage 与首 token/总耗时。适配器只发送一次请求；重试必须由持久阶段预算授权。无 usage、截断、拒绝或流中断不能记作免费成功。

Anthropic 使用显式 1 小时前缀缓存和 `output_config.format`；网关使用已实测的 `json_object`，不能把它当 JSON Schema 保证。结果仍须由调用方经共享解析器与对应预编译验证器校验。密钥只从 Worker/Actions 绑定传入，不写源包、产物或日志。
