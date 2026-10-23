# PromoBento

**Turn your product or course into a promo video.**

面向软件及课程/数字产品团队，用真实素材创作动画、配乐和音效，按固定平台预设交付 15/30 秒宣传片。目标主域为 `promobento.com`。

现行 PRD **v3.0**、协议 **3.0.0**。已实现能力、验证范围与下一阶段统一见[实施进度](docs/implementation-status.md)。

| 目标 | 入口 |
| --- | --- |
| 产品、交易、授权与验收规则 | [PRD 索引](docs/prd/README.md) |
| 接手、工具链与实施顺序 | [AGENTS](AGENTS.md)、[08 实施与交付](docs/prd/08-codex-execution.md) |
| 云端动效管线（按切片 S0–S3 实施中） | [改造方案](docs/plans/cloud-motion-v3.md) |
| 契约实现与机器结构 | [共享契约库与 Worker 导入方式](packages/contracts/README.md)、[FilmSpec Schema](contracts/film.schema.json)、[生产 Schema](contracts/production.schema.json)、[14 生产契约](docs/prd/14-production-contracts.md) |
| 片子运行时与帧桥接 | [积木与自写镜头 API](contracts/film-runtime.d.ts)、[渲染协议](contracts/render-protocol.d.ts) |
| 模型与供应商 | [模型与步骤绑定](config/model-providers.json)、[模型授权](config/model-authorization.json) |
| 云端 Worker | [apps/cloud](apps/cloud/wrangler.jsonc)（内部 S1 链路，实际验收见状态）、[渲染环境锁](apps/render-container/environment.lock.json) |
| 用户流程与设计 | [02 UX 与 UI](docs/prd/02-ux-and-ui.md)、[离线 Studio](docs/design/agent-studio-reference.html) |
| 品牌、图标与分享卡片 | [素材与接入](public/brand/README.md)、[品牌配置](config/brand.json) |
| 网站政策正文与接入 | [内容维护](content/pages/README.md)：Terms、Privacy、Refund 英文草稿及待补事实 |

修改规则时同步相关配置、代码和说明；提交要求见 AGENTS。
