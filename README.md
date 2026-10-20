# PromoBento

**Turn your product or course into a promo video.**

AI Director 与 Coding Agent 使用真实产品素材创作可编辑的动画、配乐和音效，按固定平台预设交付 15/30 秒宣传片，首发面向软件团队及课程/数字产品团队。目标主域为 `promobento.com`。

本仓库提供现行 PRD v2.4、配置、2.4.0 机器契约、参考检查与离线 Studio 设计。**尚未实现或部署生产 Agent、视频渲染、认证、Waffo 和 Cloudflare 隔离服务。** 真实状态只在 [实施进度](docs/implementation-status.md) 维护。

| 目标 | 入口 |
| --- | --- |
| 完整范围及文档职责 | [PRD 索引](docs/prd/README.md) |
| 开始开发、运行检查及工具链 | [AGENTS](AGENTS.md)、[08 实施与交付](docs/prd/08-codex-execution.md) |
| 用户流程与视觉 | [02 UX 与 UI](docs/prd/02-ux-and-ui.md)、[离线 Studio 参考](docs/design/agent-studio-reference.html) |
| 创作方法与生产契约 | [13 导演、声音与改稿](docs/prd/13-agent-native-production.md)、[14 跨系统契约](docs/prd/14-production-contracts.md) |
| 商品、成片商用权及退款 | [05 交易与授权](docs/prd/05-waffo-billing.md) |
| 数据、隐私和素材许可 | [04 架构与数据](docs/prd/04-architecture-and-data.md)、[09 许可与合规来源](docs/prd/09-sources-and-decisions.md) |
| 验收及经营判断 | [06 测试与发布](docs/prd/06-testing-and-release.md)、[07 获客与单位经济](docs/prd/07-growth-and-experiments.md) |

仅保留现行规格及有效实施资产；修改规则时同步配置、契约和消费者。授权来源、用户作品版本、必要订单审计不因文档清理删除。完成的维护直接快进 remote main，先核对远端变化；参考检查的通过不代表真实服务或作品质量已经验证。
