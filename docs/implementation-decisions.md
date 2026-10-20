# 实施决策记录

产品决定与外部来源在 [09](prd/09-sources-and-decisions.md)，当前工程协议在 [14](prd/14-production-contracts.md)。已有决策的完整历史保存在不可变基线 [750edd1 的原记录](https://github.com/ten2ten2/promobento/blob/750edd1084a1470dfd785f9b9083e6eb14d2e6ad/docs/implementation-decisions.md)。下面保留有效含义并修复重复编号；不重写当时的验收结果。

## REPO-001 — 初始文档仓库
2026-10-19。PRD按职责拆分、配置和契约保留单一来源；初始文件数只描述历史版本，不作为当前清单。

## REPO-002 — 历史文档工具版本
2026-10-19。原Node24.19.0/pnpm11.25.0为历史基线，由REPO-004取代；当时的 [仓库检查记录](evidence/repository-check.md) 不证明Cloudflare或支付兼容性。

## REPO-003 — 命令与实际实现一致
2026-10-19。应用目录和dev/build/deploy命令随真实实现创建，不添加返回成功的空脚本；当前参考契约测试与生产实现分开。

## REPO-004 — mise、兼容优先、直接main
2026-10-19。mise作为工具/任务入口；依目标部署兼容性选正式版本、精确锁定。既有Node26.12.0/pnpm12.14.0与mise最低2026.10.13不因本地环境不同而改写。按 [依赖政策](dependency-policy.md) 复现，普通修改不自动升级；历史 [工具链验证](evidence/toolchain-2026-10-19.md) 只适用于当时环境。完成变更直接快进remote main并检查HEAD。

## REPO-005 — 网站国际化与用户文案分离
2026-10-19。网站英语首发；视频文字可同片/同段任意语言混排，不要求选择/确认语言。网站资源、主题、成片源码及收费相互独立。原文/字体/方向随revision冻结，按实际字形验收，不禁用整种语言。历史 [边界检查](evidence/website-i18n-boundary-2026-10-19.md) 保留原适用范围。

## REPO-006 — UI来源与组件
2026-10-19。采用可生成的离线参考、shadcn/ui Base UI、Tailwind、Lucide和统一tokens；早期配色/字体已由008取代。参考不等于生产应用。历史 [UI记录](evidence/ui-spec-2026-10-19.md) 不覆盖后续Studio。

## REPO-007 — 图标主题与记忆
2026-10-19。默认System，头部太阳/月亮表示下一动作；点击后持久化Light/Dark，设置和公开页提供Use device setting。生产Cookie、串行写入、SSR/cache隔离见10，离线localStorage只演示。原 [主题检查](evidence/theme-toggle-2026-10-19.md) 保留。

## REPO-008 — 杂志排版与专业工具配色
2026-10-20。用户选择衬线品牌/大标题、无衬线控件、白/炭灰与蓝灰动作色；网站Georgia/Times、Arial/Helvetica系统栈，视频字体独立。theme/ui tokens与原四页参考继续保留，未新增字体下载。

## REPO-009 — URI与Google/邮箱验证码
2026-10-20。原PRD1.4与12、routes/auth seeds定义统一URI、Google+email OTP、独立user与identity、双证明显式关联、Cloudflare Email Sending。保持host-only Cookie、用途证明、幂等、同源保护及真实邮件验收；不因视频升级重做认证。

## REPO-010 — v2.2自由视频创作
2026-10-20。原记录第二个REPO-009更正为010。参考huashu-motion固定commit `5f2608c2e12abcf518f74dde86093b19f7f88603`，Director/Coding Agent/ABC-SFX/真实QA/点选改稿，视频只有15/30秒与现有预设，动画创作无固定场景/风格枚举。许可按PORT/ADAPT/REBUILD审核；GSAP、字体、音色、作者形象分开处理。原记录仅是规格交付，未证明运行应用。

## REPO-011 — v2.2 consistency-1生产契约
2026-10-20。本轮按审查P0-01..10和P1修订，不新增产品大版本。新增14和机器契约2.2.1；唯一project_revisions，all-target源包付款前冻结、后续仅编码；creative_generate/agent_patch各一次可用候选交付消费，内部修复/准备平台不多扣；BLOCK不可豁免，FactManifest绑定用户确认而非自动担保。

统一87条路由，删除尚未上线的storyboards/rewrites而非长期双栈；不增加第二套release/restore URI。补充渲染会话身份、CAS/状态/预算、全局4容器和M0b实际Cloudflare门槛。保留所有原商品价格、认证、平台数值和保留/退款规则。

本地实际验证范围为JSON Schema、fixtures/语义反例、内存状态/额度/CAS参考以及离线参考结构；不是D1事务、真实浏览器隔离、云资源、Agent模型或Waffo实现。结果随提交报告；Node22.16.0与仓库固定工具不同，不宣称mise全套通过。新增Agent参考是设计状态，不是视频输出。

## 后续记录格式
使用唯一ID、日期、范围、采用方案、依据、验证环境/结果和限制。普通检查不新增过程档案，应用状态只在真实实现与证据齐备时更新。
