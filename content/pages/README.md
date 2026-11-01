# 网站政策内容

**现有三篇英文正文均为未发布草稿**：`effectiveAt` 为空，仍含 `REQUIRED` 待核实事实。不得直接用于生产路由、结账或取得用户同意。短 UI 文案在 `locales/*.json`，业务规则以 PRD [04](../../docs/prd/04-architecture-and-data.md)、[05](../../docs/prd/05-waffo-billing.md)、[09](../../docs/prd/09-sources-and-licensing.md) 为准。

## 1 页面与章节

| 路由 | 正文 | 责任 |
| --- | --- | --- |
| `/terms` | [Terms](en/terms.md) | 服务、素材/成片权利、AI 与可接受使用 |
| `/privacy` | [Privacy](en/privacy.md) | 处理目的、接收方、Cookie、保存与权利请求 |
| `/refund-policy` | [Refund Policy](en/refund-policy.md) | 退款条件、例外、订单状态及影响 |

全文退款规则只在退款页维护；Terms 只摘要并链接。固定章节锚点为 `/terms#acceptable-use`、`/terms#ai-models`、`/privacy#ai-processing`。路由以 [routes](../../config/routes.json) 为准；配置中存在路由不代表正文已发布。

## 2 内容和配置的边界

正文使用白名单标量占位符（如 `{{brand.brandName}}`、`{{links.privacy}}`），由构建时的可信配置展开：

- 品牌、域名、支持邮箱取 [brand](../../config/brand.json)；页面链接由 routes/localization 推导；保存/退款时限取 [agent-policy](../../config/agent-policy.json)。[public-context 示例](../../config/public-context.example.json)不得另行维护冲突值或包含密钥。
- 实际经营主体、市场、MoR、AI/邮件/审核供应商、数据地区及法定权利须以经核实事实填入正文；未知值保留待办，不推测或伪造。不得把配置的产品目标写成已部署承诺。
- 只替换允许的字符串和数值，并按 HTML/Markdown 上下文转义；站内路径、HTTPS、邮箱分别校验。禁止任意模板求值、脚本、原始 HTML、递归替换或从正文导出密钥。

## 3 Frontmatter 与锚点

每页须有 `title`、`description`、`status`、`version`、`effectiveAt`、`updatedAt`；固定锚点还需 `anchors` 映射。页面布局渲染唯一 H1，正文从 H2 开始；指定锚点必须精确匹配唯一 H2。政策 `version` 独立于 PRD，`effectiveAt` 由真实生效日填写，不能由部署自动生成。

## 4 多语言

英文原文在 `content/pages/en`、站点根路径（不加 `/en`）。新增语言按 URL 前缀建目录，例如 `zh-hans` → `/zh-hans/terms`，使用标准语言标识 `zh-Hans`。每份法律译文绑定 `sourceVersion` 并保留稳定 anchor ID；缺失或过期译文返回 404，不静默混入英文，也不能用来接受新政策。详见 [10](../../docs/prd/10-i18n-and-themes.md)。

## 5 发布与版本记录

发布前必须实现全文可读取的公开页面、Footer/注册/结账链接、真实锚点、变量解析及草稿门禁；拒绝 draft、无生效日、`REQUIRED`、未知变量、缺失事实和过期译文。仓库 Markdown 检查不等于正式页面或法律核验通过。

每次发布归档**展开后的全文**、语言、版本、生效日、内容 hash、配置和源码 commit、关联退款政策版本；订单与接受/同意记录引用该快照，不能用后续配置覆盖旧购买承诺。条款接受、隐私告知、即时履行确认、营销同意分别记录，适用市场差异由 PRD 05 管理。

## 6 发布前待确认与核验

| 待办 | 必须有的证据 |
| --- | --- |
| 主体、地域、年龄 | 真实经营主体、地址、首发市场、适用法、最低年龄、支持邮箱；必要时当地代表 |
| MoR 与退款 | 实际销售方及买家条款/隐私 URL、收据、法定退款和普通退款的不同处理路径 |
| AI/数据处理 | 模型、转写、审核、邮件和支付方的真实职责、接收数据、地区、保留与删除能力；不训练承诺的合同/账户依据 |
| 存储与删除 | 账户关闭、财务、日志、备份、支持、费用和权利证据的期限；在线媒体清理及恢复演练 |
| 展示、素材与成片 | 展示副本保留/撤回、授权来源、生成标记、权利范围和客户删除的实际效果；禁止花叔本人形象进入客户素材 |
| Cookies 与营销 | 实际使用的标识、分析/归因、售卖或共享、可选同意及期限，不按规划虚构 Cookie |
| 安全与用户请求 | 输入/输出审核、投诉、申诉、隐私/账号关闭工单真实通道和 Waffo 适用检查 |
| 页面与交易验收 | SSR、锚点、语言、缓存、政策快照、接受日志、退款与购买状态一致 |

相关外部参考：[Waffo Terms](https://docs.waffo.ai/mor/account-reviews/tos)、[Privacy](https://docs.waffo.ai/mor/account-reviews/privacy-policy)、[AIGC](https://docs.waffo.ai/mor/account-reviews/aigc-compliance)。模板不能替代经营和服务事实。
