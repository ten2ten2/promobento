# 网站政策内容（未发布）

现有英文 Terms、Privacy、Refund Policy **均为草稿**：`effectiveAt:null`，正文仍含 `REQUIRED` 待核实信息。不得在生产路由、结账或用户同意流程中视为正式政策。短文案在 `locales/*.json`；产品规则以 [PRD](../../docs/prd/README.md) 为准。

## 1 页面与章节

| 路由 | 正文 | 主要内容 |
| --- | --- | --- |
| `/terms` | [Terms](en/terms.md) | 服务、素材/成片权利、AI、可接受使用 |
| `/privacy` | [Privacy](en/privacy.md) | 数据处理、供应商、Cookie、保留与用户权利 |
| `/refund-policy` | [Refund Policy](en/refund-policy.md) | 退款资格、购买关联、订单与交付影响 |

全文退款规则只在退款页维护；Terms 摘要并链接它。固定锚点 `/terms#acceptable-use`、`/terms#ai-models`、`/privacy#ai-processing`；路由以 [routes](../../config/routes.json) 为准，配置存在不表示页面已发布。

## 2 内容和配置的边界

- `{{brand.brandName}}`、`{{links.privacy}}` 等占位符仅允许白名单标量。品牌与支持邮箱来自 [brand](../../config/brand.json)，页面链接来自 routes/locale，期限来自 [agent-policy](../../config/agent-policy.json)；[public-context 示例](../../config/public-context.example.json)不得维护冲突的独立数值或密钥。
- 可信构建按上下文转义 HTML/Markdown，并校验路径、HTTPS 和邮箱；禁止脚本执行、原始 HTML、递归展开和任意模板求值。没有核实的经营主体、MoR、AI/审核/邮件方、地区及法律权利不得猜填。

## 3 Frontmatter 与锚点

每页 frontmatter 要有 `title`、`description`、`status`、`version`、`effectiveAt`、`updatedAt`；有固定标题时还需 `anchors`。布局输出唯一 H1，正文由 H2 开始；政策版本独立于 PRD，生效日期不能由部署自动生成。

## 4 多语言

英文页面位于根路径；未来 `zh-hans` 目录对应 `/zh-hans/terms`，语言标识用 `zh-Hans`。译文绑定 `sourceVersion` 与相同 anchor；过时或缺失译文返回 404，不混用英文接受新政策。

## 5 发布与版本记录

生产发布须拒绝 draft、无生效日、`REQUIRED`、未知变量、缺失事实或过期译文。每个生效版本归档**展开后的全文**、语言、内容 hash、配置/源码 commit、退款政策关联，以及订单与用户接受的快照；条款、隐私、即时履行与营销同意分别留证。仓库 Markdown 检查不能代替法律审查或页面/支付验收。

## 6 发布前待确认与核验

| 范围 | 必须核实 |
| --- | --- |
| 主体与交易 | 实际经营主体、市场、年龄、适用法、MoR 销售方、购买与退款路径、法定撤回和合同确认 |
| 数据与 AI | 真实模型/转写/审核/邮件/支付服务、接收的数据、处理地区、保留/删除与不训练承诺的合同依据 |
| 留存和用户权利 | 项目/展示副本、账户、订单、审计、备份、素材许可与争议记录的期限；删除和恢复的实际效果 |
| Cookie 与营销 | 实际标识、分析/归因/广告行为、所需同意和退出；不虚构 Cookie 或偏好中心 |
| 安全与验收 | 内容审核、投诉申诉、账号关闭、Footer/注册/结账链接、SSR、语言、锚点、缓存和权限 |

外部材料：[Waffo Terms](https://docs.waffo.ai/mor/account-reviews/tos)、[Privacy](https://docs.waffo.ai/mor/account-reviews/privacy-policy)、[AIGC](https://docs.waffo.ai/mor/account-reviews/aigc-compliance)。模板不构成已核实的经营事实。
