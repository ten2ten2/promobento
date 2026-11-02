# PromoBento

**Turn your product or course into a promo video.** 把软件、课程和数字产品的真实素材制作成 15/30 秒、30 fps 的多平台宣传片；目标网站 `promobento.com`。

现行 **PRD v3.1 / 协议 3.0.0**。重构以完整 **huashu-motion 原生 HTML/JS 工程**为唯一动画和音视频引擎，吸收 Hypit 的 Brief/Treatment、参考视频、语义时间、素材角色和精确改稿方法。每个画幅独立创作、预览和导出；NativeProject 1.0.0 只负责文件清单与身份。

**仍在开发**：S0 已完成，S1 尚未通过；最后留证的 staging 仍是旧引擎。客户功能与原生云端验收缺口以[实施状态](docs/implementation-status.md)为准，不能将 PRD 目标当作已上线能力。

## 入口

| 事项 | 唯一维护入口 |
| --- | --- |
| 产品目标、UX、架构、交易、合规与交付规则 | [PRD 索引](docs/prd/README.md) |
| 开发规则、工具链与当前进度 | [AGENTS](AGENTS.md)、[实施状态](docs/implementation-status.md) |
| 云端内部 API、任务、费用与恢复 | [Cloudflare Worker](apps/cloud/README.md) |
| 原生完整引擎、沙箱与媒体输出 | [原生适配器](packages/native-motion/README.md)、[渲染容器](apps/render-container/README.md) |
| 文件身份与校验 | [共享契约](packages/contracts/README.md)、[NativeProject Schema](contracts/native-project.schema.json) |
| 导演来源、参考素材与离线评测 | [方法来源](packages/methods/NOTICE.md)、[内部素材工具](research/evals/README.md) |
| 配置种子、品牌与法律草稿 | [config](config/agent-policy.json)、[brand](public/brand/README.md)、[政策内容](content/pages/README.md) |

部署和测试不自动开启付费模型调用；既有素材、模型用量和历史验收数据保留原始来源。实施与提交约束见 AGENTS。
