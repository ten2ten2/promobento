# PromoBento 现行产品规格

**PRD v3.1 / 产品协议 3.0.0。** 这里描述产品目标和实现要求；已经完成什么、还没验收什么，以[实施状态](../implementation-status.md)为准。

## 文档导航

| 文档 | 负责内容 |
| --- | --- |
| [01 产品与范围](01-product-prd.md) | 产品定位、完整用户流程、功能 ID、P0/P1 和边界 |
| [02 UX 与 UI](02-ux-and-ui.md) | 用户流程、状态反馈、视觉、组件与可访问性 |
| [03 平台与编码](03-platform-presets.md) | 输出目标、编码、构图、安全区与上传验收 |
| [04 架构与数据](04-architecture-and-data.md) | 服务、数据、排队、资源、缓存、隐私 |
| [05 交易、成片授权与退款](05-waffo-billing.md) | 商品/试用、购买资格、许可、付款、保存期与退款 |
| [06 测试与发布](06-testing-and-release.md) | 测试矩阵、质量、性能、成本和发布门槛 |
| [07 获客与实验](07-growth-and-experiments.md) | 归因、漏斗、每份合格片总成本与价格实验 |
| [08 实施与交付](08-codex-execution.md) | 接手、里程碑、工具链、命令及交付 |
| [09 素材许可、合规与来源](09-sources-and-licensing.md) | 来源准入、上游许可、法务依据及待确认事项 |
| [10 网站语言与主题](10-i18n-and-themes.md) | 网站语言、主题、混排与 SSR/缓存隔离 |
| [12 URI 与认证](12-routing-and-auth.md) | 身份、权限、认证流程与 URI 语义 |
| [13 导演、声音与改稿](13-agent-native-production.md) | 参考分析、Script、素材、原生编辑、声音和审片 |
| [14 生产契约与状态](14-production-contracts.md) | 版本/产物身份、job/lease/期限、费用、授权与交付不变量 |

01 是总览；02/13 讲体验和制作；04/05/12/14 讲实现；06/08 讲测试和实施。价格、次数、期限以配置为准，字段以 Schema 和代码为准。

## 配置与代码入口

- 视频规格：[platform-presets.json](../../config/platform-presets.json)；上传限制：[input-capabilities.json](../../config/input-capabilities.json)。
- 费用、试用和购买：[agent-policy.json](../../config/agent-policy.json)；模型与授权：[model-providers.json](../../config/model-providers.json)、[model-authorization.json](../../config/model-authorization.json)。
- 客户路由与登录规划：[routes.json](../../config/routes.json)、[auth.json](../../config/auth.json)。这些是设计配置，**尚非已上线 API**。
- 已实现路由：[implemented-routes.json](../../config/implemented-routes.json)，由仓库检查与 Core 处理函数、API Schema、Web 页面/资源注册共同核对；规划路由不会自动开放。
- 品牌、语言与界面：[brand.json](../../config/brand.json)、[localization.json](../../config/localization.json)、[UI tokens](../../config/ui-tokens.json)、[theme tokens](../../config/theme-tokens.json)、[en.json](../../locales/en.json)。政策正文仍为[草稿](../../content/pages/README.md)。
- Schema 和哈希：[共享契约](../../packages/contracts/README.md)、[NativeProject](../../contracts/native-project.schema.json)；实际导演与模型字段以 `contracts/*.schema.json` 为准。
- 现有服务：[控制面 API](../../apps/cloud/README.md#内部-api)、[原生引擎](../../packages/native-motion/README.md)、[渲染容器](../../apps/render-container/README.md)；CI 见 [checks.yml](../../.github/workflows/checks.yml)。

新环境运行 [agent-setup.sh](../../scripts/agent-setup.sh)，实施步骤见 08。配置数值变更时同步检查使用它的文档。
