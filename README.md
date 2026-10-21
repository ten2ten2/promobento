# PromoBento

**Turn your product or course into a promo video.**

面向软件及课程/数字产品团队，用真实素材创作动画、配乐和音效，按固定平台预设交付 15/30 秒宣传片。目标主域为 `promobento.com`。

现行 PRD **v2.7**、协议 **2.7.0**。已有共享契约库、参考测试、CI 工作流和离线 Studio 设计；生产创作、渲染、数据库、认证和支付仍未实现。实际能力见[实施进度](docs/implementation-status.md)。

| 目标 | 入口 |
| --- | --- |
| 产品、交易、授权与验收规则 | [PRD 索引](docs/prd/README.md) |
| 接手、工具链与实施顺序 | [AGENTS](AGENTS.md)、[08 实施与交付](docs/prd/08-codex-execution.md) |
| 契约实现与机器结构 | [共享契约库](packages/contracts/index.mjs)、[Schema](contracts/production.schema.json)、[14 生产契约](docs/prd/14-production-contracts.md) |
| 创作运行时与帧桥接 | [创作 API](contracts/composition-runtime.d.ts)、[渲染协议](contracts/render-protocol.d.ts) |
| 用户流程与设计 | [02 UX 与 UI](docs/prd/02-ux-and-ui.md)、[离线 Studio](docs/design/agent-studio-reference.html) |
| 品牌、图标与分享卡片 | [素材与接入](public/brand/README.md)、[品牌配置](config/brand.json) |
| 网站政策正文与接入 | [内容维护](content/pages/README.md)：Terms、Privacy、Refund 英文草稿及待补事实 |

修改规则时同步相关配置、代码和说明；提交要求见 AGENTS。
