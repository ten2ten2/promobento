# PromoBento

**Turn your product or course into a promo video.**

AI Director与Coding Agent使用真实截图、录屏和产品资料，自由创作可修改的动画Composition、配乐与音效，按平台导出15/30秒宣传片。品牌/目标主域为PromoBento / `promobento.com`。

当前是**PRD v2.2 consistency-1、配置、JSON Schema、契约测试和离线设计参考仓库**，不是已部署的应用。Google/邮箱认证、Agent、真实视频渲染、Waffo和云端隔离仍需M0–M4实施。

## 开始

| 目标 | 入口 |
| --- | --- |
| 完整需求与权威边界 | [PRD索引](docs/prd/README.md) |
| 本轮生产契约 | [14：版本/变体/作业/费用/安全](docs/prd/14-production-contracts.md) |
| AI导演与自由创作方法 | [13](docs/prd/13-agent-native-production.md) |
| Codex实施 | [AGENTS](AGENTS.md)、[任务入口](docs/v2.2-CODEX_START.md)、[接手](docs/getting-started.md) |
| UI参考 | [网站设计规范](docs/prd/11-ui-design-spec.md)、[历史四页参考](docs/design/ui-reference.html)、[Agent Studio参考](docs/design/agent-studio-reference.html) |
| 真实进度 | [实施状态](docs/implementation-status.md)、[决策](docs/implementation-decisions.md) |
| 认证/支付/部署 | [12](docs/prd/12-routing-and-auth.md)、[05](docs/prd/05-waffo-billing.md)、[04](docs/prd/04-architecture-and-data.md) |

## 不变的产品规则

软件团队和课程/数字产品团队同时首发；React/TypeScript、mise/pnpm、Cloudflare、Waffo，Google+邮箱验证码登录。视频仅15/30秒、30fps和既有六个平台预设（配置内四种画幅），Agent的叙事、场景数量、风格、镜头和绘图代码不是封闭枚举。

网站从首版建立国际化，首发英语；用户视频文案可自由语言混排。网站默认跟随系统，太阳/月亮图标切换并记忆，设置可恢复系统；明暗主题不改变成片与计费。杂志式排版与专业工具配色保持。

原$39/$12和3个成片版本保留，生成/改稿成功次数分别计量，内部重试不多扣。付款前冻结所有合法目标的源码、资源、音轨与QA；MP4延迟编码，后续补平台不再调用Agent创作或另扣版本。

## 工具与检查

```bash
git clone https://github.com/ten2ten2/promobento.git
cd promobento
mise trust
mise install
mise run install
mise run check:repo
mise run check:contracts
mise run test:contracts
mise run check:ui-reference
mise run check:agent-reference
```

保留既有Node/pnpm pins和锁文件，不为本地环境方便降版本。版本兼容策略见 [依赖政策](docs/dependency-policy.md)。契约测试包含正反例、指纹、合法preset/aspect配对、消息身份、参考状态机、额度幂等和CAS；不替代真实D1并发、浏览器隔离、模型质量、邮件/支付或部署验收。

`docs/prd` 有索引与01–14专章；`contracts/production.schema.json` 为正式结构规范，业务语义与权限必须同时验证；`config/agent-policy.json` 和输入矩阵是待标定/实施种子。`scripts/contract-validation.mjs` 的有限词汇fixture检查器明确不是生产安全边界，应用使用完整Draft2020-12验证器。所有运行结果必须按实际环境报告。

## 维护

直接维护remote main，快进更新前核对远端变化。需求、配置和状态各有单一权威来源；状态仅在实际实现和相应证据存在后升级。旧fixture保持迁移用途，历史证据不重写成当前运行结果。
