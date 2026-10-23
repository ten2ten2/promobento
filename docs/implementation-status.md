# 当前实施状态

当前为 PRD **v3.0**、协议 **3.0.0**。动效管线按[云端动效管线改造方案](plans/cloud-motion-v3.md)的切片实施，**S0 已完成，S1 实施中**。首批 [film-runtime](../packages/film-runtime/README.md) 已实现页面生成、确定性逐帧绘制与三个可信积木；生产渲染控制器、导演和云端链路仍待实现，当前不能交付成片。客户 Studio、数据库、认证和支付服务仍待实现。

已在 Cloudflare 实测的只有临时探针，不是产品代码：Chromium 沙箱（SANDBOX_FULL，含独立 uid）、WebGL 2.0（SwiftShader）、按需调度与按次实例规格，以及 2026-10-23 [G1 预探针](evidence/2026-10-23-g1-pre-probe/README.md)覆盖的 `ctx.container` broker 与断网、令牌隔离、实例停止与回收、Workflows 事件链路、Ajv 预编译、截图格式与 WebGL 单帧耗时。模型网关的能力探针见 [2026-10-23 模型探针](evidence/2026-10-23-model-probe/README.md)；最新复测显示网关 Claude 视觉失效，冷审 F 接入前需恢复视觉能力或改绑。Workers AI 语音识别、Browser Run 与生产形态镜像的冷启动见 [S1 前置探针](evidence/2026-10-23-pre-s1-probe/README.md)。[评测输入](../research/evals/README.md)已补三家产品的官方事实与素材来源，事实待负责人确认，素材本体尚未采集；三门课程仍是虚构题目。

| 部分 | 已有内容 | 仍需实现或验证 |
| --- | --- | --- |
| 契约 | v3.0 Schema：[FilmSpec](../contracts/film.schema.json)（含示例）、积木、渲染任务与分段、帧观测、方向卡、声音计划、素材理解、导演工具、模型配置、单位经济；[片子运行时 API](../contracts/film-runtime.d.ts) 与[渲染协议](../contracts/render-protocol.d.ts) 3.0.0（按画幅渲染）；FilmSpec 跨字段规则（覆盖、转场重叠、事实绑定、素材权利、积木与字体）；全部 11 个 Schema 的[预编译 ESM 与类型入口](../packages/contracts/README.md)，固定结构用例与禁运行时代码生成的 Node 回归测试 | [生产 Schema](../contracts/production.schema.json) 的 Manifest 仍是 v2 结构，S1 改为引用 film-v1；页面生成与 film-v1 源码身份向量随 S1 补齐；产品 Worker 接入和真实 workerd 验证随云端链路实现 |
| 模型配置 | [供应商与步骤绑定](../config/model-providers.json)：ModelSwitch 网关（CNY 价格与汇率）与 Anthropic；各导演步骤按能力探针结果绑定，配置检查拒绝能力不符、未验证或未授权的模型；[授权](../config/model-authorization.json)含有效期与总额上限；按价格目录把用量换算为美元微单位并向上取整 | 模型适配器、缓存、预算预留与离线 mock 在 S1 实现；S2 评测时比较网关与官方 Sonnet |
| 策略与配置 | `agent-policy` 的渲染期限、分段并发、阶段预算与 effort、负责人确认的单位成本目标；平台预设的 `loudnessTarget`（−14 LUFS）；`input-capabilities` 的 `tts.enabled=false` | 期限与段数在 G1 后按实测修订 |
| 云端 | [`apps/cloud`](../apps/cloud/wrangler.jsonc) TypeScript 骨架（只有健康检查路由）与 `typecheck`；[渲染环境锁](../apps/render-container/environment.lock.json)记录 Chrome for Testing 151.0.7922.34 与 GSAP 3.14.2 的摘要 | 预发布与生产的 D1、R2（私有）、Queues 已由 [cloud-resources 工作流](../.github/workflows/cloud-resources.yml)创建并在 `wrangler.jsonc` 绑定，但尚无迁移、读写代码或部署；Workflows、DO、broker、渲染与资产容器均在 S1/S3 实现 |
| 片子运行时 | [页面生成器、shim、engine](../packages/film-runtime/README.md)；四画幅；cut/crossfade/push/whip；三个原创积木 `hook-title`、`ui-showcase`、`cta-endcard`；完整 Schema/引用与权利上下文检查，过长文字报错；standard 桥接和点选 | 首批浏览器回归由 CI `browser` job 验证；其余六个 ★ 积木、OM/clip/GSAP、视频帧、完整字体登记与缺字、声音和生产控制器未实现；自写镜头与本地预览明确拒绝，未做 G1 或审美签字 |
| 素材 | [字体](../packages/fonts/huashu/LICENSES.md)（huashu-motion 登记的 OFL WOFF 与 Geist）；[CC0 乐器采样](../packages/audio/samples/catalog.json) | 声音引擎与 `motion-tools` 纯函数在 S1 从 Git 历史（提交 `1faef1c`）按新结构改写 |
| 共享契约库 | JSON/JCS、浏览器与 Node 共用参数语义、源包可移植路径和摘要、环境继承、Ajv 校验 | 服务接入和数据库事务 |
| Studio 与品牌 | 离线交互参考、品牌图标和分享图、明暗配色与网站字体配置 | 生产网站、完整手机/平板交互、字体加载和浏览器验收 |
| 审核与购买接受 | 默认关闭的Prompt Sift适配；输出抽样、预览与购买同意的参考逻辑 | 实际输入/输出审核、持久化和Waffo接入 |
| 网站政策 | [Terms、Privacy、Refund 英文草稿](../content/pages/README.md)及模板变量示例 | 主体和供应商事实、页面渲染器、发布校验及实际流程 |
| 工程检查 | 精确工具链与冻结 lockfile；`contracts` job 运行 `check:repo`、单元测试和 cloud/runtime 类型检查；`browser` job 在 CI 构建带固定 Chromium 的离线测试镜像，输出四画幅截图与回归报告 | `cloud-local`、`deploy` job 随 S1 云端实现加入；当前浏览器测试镜像不部署、不推送，不是生产渲染镜像 |

继续 S1：补齐其余 ★ 积木、OM/clip/GSAP 和生产渲染控制器，再接云端链路、分阶段导演、声音及 G1，顺序和出口见[08](prd/08-codex-execution.md#2-里程碑与退出关口)。真实题目评测前需确认事实卡、采集素材到预发布 R2 并核验权利；这些输入不阻塞独立代码。生产 Agent 保持 `enabled=false`；真实调用只在模型授权范围和总额内进行。长期验收证据按[06](prd/06-testing-and-release.md#5-发布与证据)管理。
