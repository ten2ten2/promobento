# PromoBento 现行产品规格

产品规格 **v3.0**；结构协议 **3.0.0**。此目录维护目标产品的现行规则，不表示全部已实现；[实际进度](../implementation-status.md)记录已经具备的能力。

## 文档导航

| 文档 | 负责内容 |
| --- | --- |
| [01 产品与范围](01-product-prd.md) | 用户、P0/P1、输入和产品边界 |
| [02 UX 与 UI](02-ux-and-ui.md) | 用户流程、状态反馈、视觉、组件与可访问性 |
| [03 平台与编码](03-platform-presets.md) | 输出目标、编码、构图、安全区与上传验收 |
| [04 架构与数据](04-architecture-and-data.md) | 服务职责、实体、API 实施清单、隐私与删除 |
| [05 交易、成片授权与退款](05-waffo-billing.md) | 商品/试用、购买资格、许可、付款、保存期与退款 |
| [06 测试与发布](06-testing-and-release.md) | 回归范围、真实发布门槛与证据规则 |
| [07 获客与实验](07-growth-and-experiments.md) | 归因、漏斗、完整单位经济与试运营实验 |
| [08 实施与交付](08-codex-execution.md) | 接手、里程碑、工具链、命令及交付 |
| [09 素材许可、合规与来源](09-sources-and-licensing.md) | 来源准入、上游许可、法务依据及待确认事项 |
| [10 网站语言与主题](10-i18n-and-themes.md) | 网站语言、主题、混排与 SSR/缓存隔离 |
| [12 URI 与认证](12-routing-and-auth.md) | 身份、权限、认证流程与 URI 语义 |
| [13 导演、声音与改稿](13-agent-native-production.md) | 自由创作方法、宣传真实性、音画和编辑工作流 |
| [14 生产契约与状态](14-production-contracts.md) | 类型、状态、hash、预算、授权证据与跨系统不变量 |

各章说明上表范围内的规则，其他章节引用即可。价格、次数、尺寸等数值在配置中维护；页面和客户 API 规划在 routes 中维护；现行内部结构见 Schema，客户版本、计费和交付要求见 14。客户请求/响应契约随对应服务实现，不再保留一套与原生链路无关的参考实现。修改规则时同步相关代码、配置和对外页面，不再复制一套价格、期限或接口表。

## 配置与机器契约

| 文件 | 用途 |
| --- | --- |
| [平台配置](../../config/platform-presets.json) | 固定目标、编码、安全区、响度目标、renderProfiles 与来源 |
| [路由配置](../../config/routes.json)、[认证配置](../../config/auth.json) | 客户页面/API规划与身份策略；不是已部署入口 |
| [Agent策略](../../config/agent-policy.json)、[输入能力](../../config/input-capabilities.json) | 预算/次数/状态、渲染期限、单位成本目标与公开能力边界 |
| [模型与步骤绑定](../../config/model-providers.json)、[模型授权](../../config/model-authorization.json) | 供应商、价格目录、各导演步骤的模型及其授权上限 |
| [输入审核](../../config/content-safety.json) | 默认关闭的提示词审核参考适配；客户预览与输出审核要求见 04/14，尚待接入 |
| [品牌](../../config/brand.json)、[语言](../../config/localization.json)、[消息](../../locales/en.json) | 网站资料与英文文案 |
| [完整页面正文与维护规则](../../content/pages/README.md)、[公开上下文示例](../../config/public-context.example.json) | 英文 Terms/Privacy/Refund 草稿、构建期变量、译文版本及待补事实；不是已上线页面 |
| [UI tokens](../../config/ui-tokens.json)、[主题tokens](../../config/theme-tokens.json) | 字体、尺寸、间距、明暗配色及对比度要求 |
| [共享契约库](../../packages/contracts/README.md)、[固定摘要向量](../../packages/contracts/test/canonical-vectors.json)、[Schema 回归用例](../../packages/contracts/test/schema-vectors.json) | JCS、严格 JSON、Ajv 与 Worker 预编译验证器；原生项目路径／字节／画幅、模型费用与平台目标 |
| [原生工程](../../contracts/native-project.schema.json)、[导演工具](../../contracts/agent-tools.schema.json)、[事实整理](../../contracts/director-analysis.schema.json)、[方向卡](../../contracts/direction.schema.json)、[素材理解](../../contracts/asset-insight.schema.json)、[视频帧包](../../contracts/video-frame-manifest.schema.json) | 原生工程 1.0.0、导演及素材结构；当前内部用法见各实现，结构存在不代表客户服务已完成 |
| [声音计划](../../contracts/audio-plan.schema.json)、[音乐准入](../../contracts/audio-admission.schema.json)、[模型配置](../../contracts/model-config.schema.json)、[模型费用](../../contracts/model-spend.schema.json)、[单位经济](../../contracts/unit-economics.schema.json) | 声音与素材辅助契约、模型授权/用量，以及离线单位经济分析 |
| [原生运行时](../../packages/native-motion/README.md)、[渲染容器](../../apps/render-container/README.md) | 完整上游调用、普通工程文件、真实预览、整片导出与隔离边界 |
| [内部云端 API](../../apps/cloud/README.md#内部-api)、[原生工程回归样例](../../packages/contracts/test/native-project.test.mjs) | 实际内部入口与原生版本边界；客户购买、快照与交付按 14 后续实现 |
| [CI](../../.github/workflows/checks.yml) | main/PR 的固定工具链检查；运行结果随提交 |

新环境运行 [agent-setup.sh](../../scripts/agent-setup.sh)，实施顺序见 08，已完成能力见[实施进度](../implementation-status.md)。代码样式路径相对仓库根目录，Markdown 链接相对所在文件。
