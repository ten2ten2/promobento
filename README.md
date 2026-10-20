# PromoBento

**Turn your product or course into a promo video.**

AI Director 与 Coding Agent 使用真实产品素材创作可编辑的动画、配乐与音效，按平台预设交付 15/30 秒宣传片。目标主域为 `promobento.com`。

本仓库提供现行 PRD、配置、机器契约、可执行参考检查及离线 Studio 设计参考。**尚未实现或部署生产 Agent、视频渲染、认证、Waffo 与 Cloudflare 隔离服务。** 实际状态只在 [实施进度](docs/implementation-status.md) 维护。

## 入口

| 目标 | 权威位置 |
| --- | --- |
| 完整需求及职责 | [PRD 索引](docs/prd/README.md) |
| 自由视频创作 | [13 导演与 Studio](docs/prd/13-agent-native-production.md) |
| 版本、指纹、预算及交付 | [14 生产契约](docs/prd/14-production-contracts.md) |
| Codex 开工 | [AGENTS](AGENTS.md)、[接手指南](docs/getting-started.md)、[08 实施顺序](docs/prd/08-codex-execution.md) |
| 网站设计与示意 | [11 UI 规范](docs/prd/11-ui-design-spec.md)、[当前 Studio 参考](docs/design/agent-studio-reference.html) |
| 认证、交易、架构 | [12](docs/prd/12-routing-and-auth.md)、[05](docs/prd/05-waffo-billing.md)、[04](docs/prd/04-architecture-and-data.md) |

视频仅 15/30 秒、30 fps；六个平台七个合法目标，画幅只来自平台配置。Agent 的镜头数量、风格、运动、动画源码和算法自由；模板不是白名单。软件团队与课程/数字产品团队同时首发。保留 React/TypeScript、mise/pnpm、Cloudflare、Waffo、Google + 邮箱验证码。

网站英语首发并预留国际化；用户视频文案任意混排。默认 System，太阳/月亮按钮切换并记忆，明暗不改变成片或账务。$39/$12 项目商品及各3个版本按05；用户AI成功次数与系统实际成本分账。付款前冻结所有合法target来源，后续按需编码，不临时重新创作已购版本。

## 检查

```bash
mise trust
mise install
mise run install
mise run check:repo
mise run check:contracts
mise run test:contracts
mise run check:agent-reference
```

修改参考模板或 tokens 后运行 `mise run build:agent-reference`。依赖策略见 [依赖政策](docs/dependency-policy.md)。非固定工具环境的检查须报告实际版本，不能冒充 mise 精确版本验证。参考测试不替代真实 D1 并发、浏览器、模型质量、云端、邮件、付款或视频验收。

仅保留现行规格和有效实施资产，不保存失效方案、兼容示例或重复实施入口。授权素材和开源许可证来源仍应保留；用户成片版本、订单审计与必要运行记录属于产品能力，不因文档清理删除。维护直接快进到 remote main，提交前核对远端变化。
