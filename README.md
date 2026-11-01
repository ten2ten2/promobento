# PromoBento

**Turn your product or course into a promo video.**

面向软件及课程/数字产品团队，用真实素材创作动画、配乐和音效，按固定平台预设交付 15/30 秒宣传片。目标主域为 `promobento.com`。

现行 PRD **v3.0**、协议 **3.0.0**。已实现能力、验证范围与下一阶段统一见[实施进度](docs/implementation-status.md)。

| 目标 | 入口 |
| --- | --- |
| 产品、交易、授权与验收规则 | [PRD 索引](docs/prd/README.md) |
| 接手、工具链与实施顺序 | [AGENTS](AGENTS.md)、[08 实施与交付](docs/prd/08-codex-execution.md) |
| 原生创作与云端控制（S1 实施中） | [导演与改稿](docs/prd/13-agent-native-production.md)、[云端实现](apps/cloud/README.md) |
| 契约实现与业务要求 | [共享契约库与 Worker 导入方式](packages/contracts/README.md)、[原生工程清单](contracts/native-project.schema.json)、[14 版本、状态与交付规则](docs/prd/14-production-contracts.md) |
| 原生运行时与隔离 | [完整 huashu 适配器](packages/native-motion/README.md)、[预览与整片容器](apps/render-container/README.md) |
| 模型与供应商 | [模型与步骤绑定](config/model-providers.json)、[模型授权](config/model-authorization.json) |
| 云端 Worker | [apps/cloud](apps/cloud/wrangler.jsonc)（内部 S1 链路，实际验收见状态）、[渲染环境锁](apps/render-container/environment.lock.json) |
| 用户流程与设计 | [02 UX 与 UI](docs/prd/02-ux-and-ui.md) |
| 品牌、图标与分享卡片 | [素材与接入](public/brand/README.md)、[品牌配置](config/brand.json) |
| 网站政策正文与接入 | [内容维护](content/pages/README.md)：Terms、Privacy、Refund 英文草稿及待补事实 |

创作文件采用原生 `index.html + assets/ + vendor/`，固定完整 huashu-motion 版本；Hypit 的 Brief/Treatment 与语义时间方法进入导演上下文。Cloudflare 负责持久任务、版本、素材与账本，每个画幅一次整片任务。原生项目清单只是传输和身份封装。客户 Studio、登录、支付与生产发布仍待完成。

修改规则时同步相关配置、代码和说明；提交要求见 AGENTS。
