# PromoBento 产品需求与实施文档

版本：v2.2 · consistency-1（2026-10-20，Asia/Shanghai）；机器契约版本2.2.1，不新增产品大版本。本目录是规范，不是已经部署的SaaS。

固定15/30秒、30fps、六个平台预设；Agent可自由创作镜头数量、风格、运镜和代码。网站英语首发，用户视频文案可任意语言混排。Google+邮箱验证码、Cloudflare、Waffo、mise与既定网站视觉不变。

## 文档导航

| 文档 | 职责 |
| --- | --- |
| [产品需求](01-product-prd.md) | 产品需求 |
| [界面与流程](02-ux-and-flows.md) | 界面与流程 |
| [平台预设](03-platform-presets.md) | 平台预设 |
| [技术、数据与统一API](04-architecture-and-data.md) | 技术、数据与统一API |
| [Waffo、权益与退款](05-waffo-billing.md) | Waffo、权益与退款 |
| [测试与发布](06-testing-and-release.md) | 测试与发布 |
| [获客与实验](07-growth-and-experiments.md) | 获客与实验 |
| [实施顺序](08-codex-execution.md) | 实施顺序 |
| [来源与决策](09-sources-and-decisions.md) | 来源与决策 |
| [网站国际化、混排文案与主题](10-i18n-and-themes.md) | 网站国际化、混排文案与主题 |
| [网站视觉与组件](11-ui-design-spec.md) | 网站视觉与组件 |
| [URI、Google与邮箱认证](12-routing-and-auth.md) | URI、Google与邮箱认证 |
| [AI导演与自由视频创作](13-agent-native-production.md) | AI导演与自由视频创作 |
| [生产契约与本轮一致性修订](14-production-contracts.md) | 生产契约与本轮一致性修订 |

## 权威来源与执行

先读01、03、05、10、12理解产品与交易边界，再读13的创作方法、14的版本/状态/费用/运行协议，按08的M0a/M0b–M4推进。14消除新旧跨章冲突，但不削减05已购权益或12认证保护。任何规格冲突先同步修复，不由实现者猜测收费、准入或权限。

[统一路由](../../config/routes.json) 是所有页面和第一方API的方法/路径/入口权限来源；[Agent API契约](../../contracts/agent-api.json) 引用 [JSON Schema](../../contracts/production.schema.json)；[RenderProtocol类型](../../contracts/render-protocol.d.ts) 规定逐帧会话。[平台配置](../../config/platform-presets.json) 保持原版本与数值。

[Agent预算与额度](../../config/agent-policy.json) 的enabled为false，需模型/成本及M0真机标定后启用；[输入能力矩阵](../../config/input-capabilities.json) 区分公开计划和未实现状态。Google/OTP规则仍由 [认证配置](../../config/auth.json) 定义。网站 [UI配置](../../config/ui-tokens.json)、[主题](../../config/theme-tokens.json)、[国际化](../../config/localization.json) 与 [英语资源](../../locales/en.json) 继续共用原来源。

[Composition](../../contracts/composition.example.json)、[ReleaseSnapshot](../../contracts/release-snapshot.example.json)、[FactManifest](../../contracts/fact-manifest.example.json)、[EditRequest](../../contracts/edit-request.example.json)、[ExportManifest](../../contracts/export-manifest.example.json) 是互相关联的2.2.1 fixtures，exampleOnly不代表真实渲染。旧 [场景fixture](../../contracts/scene.example.json) 与 [旧导出fixture](../../contracts/legacy/export-manifest.example.json) 仅用于v1.x迁移，不作为创作白名单。

[Agent Studio离线参考](../design/agent-studio-reference.html) 展示候选、准备平台、预算暂停、冲突、QA阻塞；无实际视频/模型/支付。[既有四页参考](../design/ui-reference.html) 保留网站视觉基线。

[Codex入口](../v2.2-CODEX_START.md)、[接手指南](../getting-started.md)、[实施状态](../implementation-status.md)、[决策记录](../implementation-decisions.md) 与 [根AGENTS](../../AGENTS.md) 分别承担任务、运行、进度和变更说明。普通检查随提交/CI报告，关键集成证据按 [既有记录规则](../evidence/README.md) 管理，不新建重复证据库。
