# PromoBento 现行产品规格

产品规格 **v2.5**；结构协议 **2.5.0**。此目录维护现行规则；[实际进度](../implementation-status.md)记录已经具备的能力。

## 文档导航

| 文档 | 唯一负责的规则 |
| --- | --- |
| [01 产品与范围](01-product-prd.md) | 用户、P0/P1、输入和产品边界 |
| [02 UX 与 UI](02-ux-and-ui.md) | 用户流程、状态反馈、视觉、组件与可访问性 |
| [03 平台与编码](03-platform-presets.md) | 输出目标、编码、构图、安全区与上传验收 |
| [04 架构与数据](04-architecture-and-data.md) | 服务职责、实体、API 实施清单、隐私与删除 |
| [05 交易、成片授权与退款](05-waffo-billing.md) | 商品/试用、购买资格、许可、付款、保存期与退款 |
| [06 测试与发布](06-testing-and-release.md) | 回归范围、真实发布门槛与证据规则 |
| [07 获客与实验](07-growth-and-experiments.md) | 归因、漏斗、完整单位经济与试运营实验 |
| [08 实施与交付](08-codex-execution.md) | 接手、里程碑、工具链、命令及交付 |
| [09 素材许可、合规与来源](09-sources-and-decisions.md) | 来源准入、上游许可、法务依据及待确认事项 |
| [10 网站语言与主题](10-i18n-and-themes.md) | 网站语言、主题、混排与 SSR/缓存隔离 |
| [12 URI 与认证](12-routing-and-auth.md) | 身份、权限、认证流程与 URI 语义 |
| [13 导演、声音与改稿](13-agent-native-production.md) | 自由创作方法、宣传真实性、音画和编辑工作流 |
| [14 生产契约与状态](14-production-contracts.md) | 类型、状态、hash、预算、授权证据与跨系统不变量 |

文档说明行为，配置保存机器数值，Schema 定义传输结构，共享契约库实现结构校验和摘要，14 定义跨字段语义；routes 是页面/API 注册表。消费章节引用负责来源，不另维护价格、期限或里程碑。冲突须同步修复全部消费者。

## 配置与机器契约

| 文件 | 用途 |
| --- | --- |
| [平台配置](../../config/platform-presets.json) | 固定目标、编码、安全区、renderProfiles 与来源 |
| [路由配置](../../config/routes.json)、[认证配置](../../config/auth.json) | 完整页面/API与身份策略 |
| [Agent策略](../../config/agent-policy.json)、[输入能力](../../config/input-capabilities.json) | 预算/次数/状态与公开能力边界 |
| [品牌](../../config/brand.json)、[语言](../../config/localization.json)、[消息](../../locales/en.json) | 网站资料与英文文案 |
| [UI tokens](../../config/ui-tokens.json)、[主题tokens](../../config/theme-tokens.json) | 唯一视觉数值 |
| [共享契约库](../../packages/contracts/index.mjs)、[固定摘要向量](../../packages/contracts/test/canonical-vectors.json) | JCS、JSON 解析、完整 Ajv 校验与身份计算的唯一实现 |
| [JSON Schema](../../contracts/production.schema.json)、[创作 API](../../contracts/composition-runtime.d.ts)、[帧协议](../../contracts/render-protocol.d.ts) | 结构、确定性创作和可信 Renderer 桥接；类型不等于运行时已经实现 |
| [Agent API](../../contracts/agent-api.json) | 路由与请求/响应定义关联 |
| [Composition](../../contracts/composition.example.json)、[ReleaseSnapshot](../../contracts/release-snapshot.example.json) | 可关联的非生产示例 |
| [资源](../../contracts/resource-manifest.example.json)、[事实](../../contracts/fact-manifest.example.json)、[改稿](../../contracts/edit-request.example.json)、[输出](../../contracts/export-manifest.example.json) | 内容与请求/交付示例 |
| [Studio参考](../design/agent-studio-reference.html) | 无真实服务的当前设计示意 |
| [CI](../../.github/workflows/checks.yml) | main/PR 的固定工具链检查；运行结果随提交 |

代码样式路径相对仓库根目录，Markdown链接相对所在文件。来源/许可与真实验收按09和[06证据规则](06-testing-and-release.md#5-发布与证据)管理；仅测试用占位数据不得进入生产。
