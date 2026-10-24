# PromoBento 现行产品规格

产品规格 **v3.0**；结构协议 **3.0.0**。此目录维护现行规则；[实际进度](../implementation-status.md)记录已经具备的能力。

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

各章说明上表范围内的规则，其他章节引用即可。价格、次数、尺寸等数值在配置中维护；页面和 API 清单在 routes 中维护；数据结构见 Schema，字段之间的约束见 14。修改规则时同步相关代码、配置和对外页面，不再复制一套价格、期限或接口表。

## 配置与机器契约

| 文件 | 用途 |
| --- | --- |
| [平台配置](../../config/platform-presets.json) | 固定目标、编码、安全区、响度目标、renderProfiles 与来源 |
| [路由配置](../../config/routes.json)、[认证配置](../../config/auth.json) | 完整页面/API与身份策略 |
| [Agent策略](../../config/agent-policy.json)、[输入能力](../../config/input-capabilities.json) | 预算/次数/状态、渲染期限、单位成本目标与公开能力边界 |
| [模型与步骤绑定](../../config/model-providers.json)、[模型授权](../../config/model-authorization.json) | 供应商、价格目录、各导演步骤的模型及其授权上限 |
| [预览策略](../../config/preview.json)、[输入审核](../../config/content-safety.json)、[输出采样](../../config/output-safety-sampling.json) | 本地回放与可信捕获；默认关闭的提示词审核适配；输出审核的最低覆盖与大小上限 |
| [品牌](../../config/brand.json)、[语言](../../config/localization.json)、[消息](../../locales/en.json) | 网站资料与英文文案 |
| [完整页面正文与维护规则](../../content/pages/README.md)、[公开上下文示例](../../config/public-context.example.json) | 英文 Terms/Privacy/Refund 草稿、构建期变量、译文版本及待补事实；不是已上线页面 |
| [UI tokens](../../config/ui-tokens.json)、[主题tokens](../../config/theme-tokens.json) | 字体、尺寸、间距、明暗配色及对比度要求 |
| [共享契约库](../../packages/contracts/README.md)、[固定摘要向量](../../packages/contracts/test/canonical-vectors.json)、[Schema 回归用例](../../packages/contracts/test/schema-vectors.json) | JCS、JSON 解析、Ajv 校验与 Workers 用的预编译验证器、FilmSpec 跨字段规则、模型费用、源码依赖摘要和版本环境继承 |
| [生产 Schema](../../contracts/production.schema.json)、[FilmSpec](../../contracts/film.schema.json)、[积木](../../contracts/block.schema.json)、[渲染任务](../../contracts/render-job.schema.json)、[帧观测](../../contracts/frame-observation.schema.json)、[方向卡](../../contracts/direction.schema.json)、[声音计划](../../contracts/audio-plan.schema.json)、[素材理解](../../contracts/asset-insight.schema.json)、[导演工具](../../contracts/agent-tools.schema.json)、[事实整理/冷审](../../contracts/director-analysis.schema.json)、[单位经济](../../contracts/unit-economics.schema.json) | v3.0 结构；类型不等于运行时已经实现 |
| [片子运行时 API](../../contracts/film-runtime.d.ts)、[帧协议](../../contracts/render-protocol.d.ts) | 积木与自写镜头可依赖的页面接口；可信渲染宿主的分段与预览桥接 |
| [Agent API](../../contracts/agent-api.json) | 路由与请求/响应定义关联 |
| [FilmSpec 示例](../../contracts/film.example.json)、[film-v1 Composition](../../contracts/film-composition.example.json)、[film-v1 ReleaseSnapshot](../../contracts/film-release-snapshot.example.json) | 新建作品的非生产契约示例；旧 [Composition](../../contracts/composition.example.json)/[Snapshot](../../contracts/release-snapshot.example.json)保留历史身份重放 |
| [资源](../../contracts/resource-manifest.example.json)、[事实](../../contracts/fact-manifest.example.json)、[改稿](../../contracts/edit-request.example.json)、[输出](../../contracts/export-manifest.example.json) | 内容与请求/交付示例 |
| [Studio参考](../design/agent-studio-reference.html) | 无真实服务的当前设计示意 |
| [CI](../../.github/workflows/checks.yml) | main/PR 的固定工具链检查；运行结果随提交 |

新环境运行 [agent-setup.sh](../../scripts/agent-setup.sh)，实施顺序见 08，已完成能力见[实施进度](../implementation-status.md)。代码样式路径相对仓库根目录，Markdown 链接相对所在文件。
