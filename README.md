# PromoBento

**Turn your product or course into a promo video.**

面向软件及课程/数字产品团队，用真实素材创作动画、配乐和音效，按固定平台预设交付 15/30 秒宣传片。目标主域为 `promobento.com`。

现行 PRD **v2.7**、协议 **2.7.0**。已实现能力、验证范围与下一阶段统一见[实施进度](docs/implementation-status.md)。

| 目标 | 入口 |
| --- | --- |
| 产品、交易、授权与验收规则 | [PRD 索引](docs/prd/README.md) |
| 接手、工具链与实施顺序 | [AGENTS](AGENTS.md)、[08 实施与交付](docs/prd/08-codex-execution.md) |
| 下一阶段改造（已批准，未实施） | [云端动效管线改造方案](docs/plans/cloud-motion-v3.md) |
| 契约实现与机器结构 | [共享契约库](packages/contracts/index.mjs)、[Schema](contracts/production.schema.json)、[14 生产契约](docs/prd/14-production-contracts.md) |
| 创作运行时与帧桥接 | [创作 API](contracts/composition-runtime.d.ts)、[渲染协议](contracts/render-protocol.d.ts) |
| 受限源码到 MP4 | [几何入口](docs/prd/08-codex-execution.md#本地canvas-commands-v1入口)、[文字与媒体入口](docs/prd/08-codex-execution.md#本地canvas-media-v1入口)、[原创工程样例](tests/fixtures/admission/composition.mjs) |
| 创作工具移植 | [绘图、字体、声音、诊断与改稿工具](docs/creative-toolkit.md) |
| 本地导演与 M0a 对照 | [导演、改稿与预算](apps/agent-runner/README.md)、[题目与研究入口](research/m0a/README.md) |
| 用户流程与设计 | [02 UX 与 UI](docs/prd/02-ux-and-ui.md)、[离线 Studio](docs/design/agent-studio-reference.html) |
| 品牌、图标与分享卡片 | [素材与接入](public/brand/README.md)、[品牌配置](config/brand.json) |
| 网站政策正文与接入 | [内容维护](content/pages/README.md)：Terms、Privacy、Refund 英文草稿及待补事实 |

修改规则时同步相关配置、代码和说明；提交要求见 AGENTS。
