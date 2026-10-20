# PromoBento 现行产品规格

产品规格 v2.3；结构协议版本 2.3.0。此目录只维护现行规则和当前请求结构。文件和参考测试不代表应用已经上线；[实际进度](../implementation-status.md)单独维护。

## 文档导航

| 文档 | 负责事项 |
| --- | --- |
| [01 产品与范围](01-product-prd.md) | 产品与范围 |
| [02 界面与流程](02-ux-and-flows.md) | 界面与流程 |
| [03 平台与编码](03-platform-presets.md) | 平台与编码 |
| [04 架构与完整API](04-architecture-and-data.md) | 架构与完整API |
| [05 交易、权益与退款](05-waffo-billing.md) | 交易、权益与退款 |
| [06 验收与发布](06-testing-and-release.md) | 验收与发布 |
| [07 获客与实验](07-growth-and-experiments.md) | 获客与实验 |
| [08 实施顺序与命令](08-codex-execution.md) | 实施顺序与命令 |
| [09 现行决策与来源](09-sources-and-decisions.md) | 现行决策与来源 |
| [10 网站语言与主题](10-i18n-and-themes.md) | 网站语言与主题 |
| [11 UI设计与组件](11-ui-design-spec.md) | UI设计与组件 |
| [12 URI与认证](12-routing-and-auth.md) | URI与认证 |
| [13 导演、声音与改稿](13-agent-native-production.md) | 导演、声音与改稿 |
| [14 生产契约与状态](14-production-contracts.md) | 生产契约与状态 |

## 权威关系

01定义产品范围；03与平台配置定义输出；05定义交易；10定义语言/主题；11定义视觉；12与路由配置定义认证/URI；13定义创作方法；14定义Composition、版本、状态、指纹、预算与跨系统语义；08是唯一里程碑入口。发现冲突时修复全部受影响来源，不通过暗设优先级长期保留两种规则。

时长严格15/30秒，30fps、450/900帧，固定六平台七target；Agent镜头数/风格/代码自由，安全与授权不自由。网站英语、视频混排、Google+邮箱、React/Cloudflare/Waffo/mise保持。一次账号试用、单片购买、项目包、差额升级与追加统一由01/05及Agent策略定义；先购创作与购买导出采用不同明确意图。首购贡献、免费分摊和试运营关口见07/08，不在索引维护第二套数值表。

## 配置与机器契约

| 文件 | 用途 |
| --- | --- |
| [平台配置](../../config/platform-presets.json) | 固定目标、编码、安全区与来源 |
| [路由配置](../../config/routes.json)、[认证配置](../../config/auth.json) | 完整页面/API与身份策略 |
| [Agent策略](../../config/agent-policy.json)、[输入能力](../../config/input-capabilities.json) | 预算/次数/状态与公开能力边界 |
| [品牌](../../config/brand.json)、[语言](../../config/localization.json)、[消息](../../locales/en.json) | 网站资料与英文文案 |
| [UI tokens](../../config/ui-tokens.json)、[主题tokens](../../config/theme-tokens.json) | 唯一视觉数值 |
| [JSON Schema](../../contracts/production.schema.json)、[帧协议](../../contracts/render-protocol.d.ts) | 结构规范，不替代语义和授权 |
| [Agent API](../../contracts/agent-api.json) | 路由与请求/响应定义关联 |
| [Composition](../../contracts/composition.example.json)、[ReleaseSnapshot](../../contracts/release-snapshot.example.json) | 可关联的非生产示例 |
| [事实](../../contracts/fact-manifest.example.json)、[改稿](../../contracts/edit-request.example.json)、[输出](../../contracts/export-manifest.example.json) | 内容与请求/交付示例 |
| [Studio参考](../design/agent-studio-reference.html) | 无真实服务的当前设计示意 |

代码样式路径相对仓库根目录，Markdown链接相对所在文件。来源/许可与真实验收按09和[证据规则](../evidence/README.md)管理；仅测试用占位数据不得进入生产。
