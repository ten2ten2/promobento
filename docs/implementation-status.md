# 当前实施状态

当前为 PRD **v3.0**、协议 **3.0.0**。动效管线按[云端动效管线改造方案](plans/cloud-motion-v3.md)的切片实施，**S0 清场与契约已完成，S1 尚未开始**。仓库里目前没有可以出片的渲染器、导演或云端服务：v2 的本地渲染器、受限源码执行、本地导演和研究工具已在 S0 删除，S1 按新结构重写。客户 Studio、数据库、认证和支付服务仍待实现。

已在 Cloudflare 实测的只有临时探针，不是产品代码：Chromium 沙箱（SANDBOX_FULL，含独立 uid）、WebGL 2.0（SwiftShader）、按需调度与按次实例规格，以及 2026-10-23 [G1 预探针](evidence/2026-10-23-g1-pre-probe/README.md)覆盖的 `ctx.container` broker 与断网、令牌隔离、实例停止与回收、Workflows 事件链路、Ajv 预编译、截图格式与 WebGL 单帧耗时。模型网关的能力探针见 [2026-10-23 模型探针](evidence/2026-10-23-model-probe/README.md)。

| 部分 | 已有内容 | 仍需实现或验证 |
| --- | --- | --- |
| 契约 | v3.0 Schema：[FilmSpec](../contracts/film.schema.json)（含示例）、积木、渲染任务与分段、帧观测、方向卡、声音计划、素材理解、导演工具、模型配置、单位经济；[片子运行时 API](../contracts/film-runtime.d.ts) 与[渲染协议](../contracts/render-protocol.d.ts) 3.0.0（按画幅渲染）；FilmSpec 跨字段规则（覆盖、转场重叠、事实绑定、素材权利、积木与字体）；`build:validators` 生成不含运行时代码生成的独立验证器 | [生产 Schema](../contracts/production.schema.json) 的 Manifest 仍是 v2 结构，S1 改为引用 film-v1；固定向量随 S1 的页面生成器补齐 |
| 模型配置 | [供应商与步骤绑定](../config/model-providers.json)：ModelSwitch 网关（CNY 价格与汇率）与 Anthropic；各导演步骤按能力探针结果绑定，配置检查拒绝能力不符、未验证或未授权的模型；[授权](../config/model-authorization.json)含有效期与总额上限；按价格目录把用量换算为美元微单位并向上取整 | 模型适配器、缓存、预算预留与离线 mock 在 S1 实现；S2 评测时比较网关与官方 Sonnet |
| 策略与配置 | `agent-policy` 的渲染期限、分段并发、阶段预算与 effort、负责人确认的单位成本目标；平台预设的 `loudnessTarget`（−14 LUFS）；`input-capabilities` 的 `tts.enabled=false` | 期限与段数在 G1 后按实测修订 |
| 云端 | [`apps/cloud`](../apps/cloud/wrangler.jsonc) TypeScript 骨架（只有健康检查路由）与 `typecheck`；[渲染环境锁](../apps/render-container/environment.lock.json)记录 Chrome for Testing 151.0.7922.34 与 GSAP 3.14.2 的摘要 | 预发布与生产的 D1、R2（私有）、Queues 已由 [cloud-resources 工作流](../.github/workflows/cloud-resources.yml)创建并在 `wrangler.jsonc` 绑定，但尚无迁移、读写代码或部署；Workflows、DO、broker、渲染与资产容器均在 S1/S3 实现 |
| 素材 | [字体](../packages/fonts/huashu/LICENSES.md)（huashu-motion 登记的 OFL WOFF 与 Geist）；[CC0 乐器采样](../packages/audio/samples/catalog.json) | 声音引擎与 `motion-tools` 纯函数在 S1 从 Git 历史（提交 `1faef1c`）按新结构改写 |
| 共享契约库 | JSON/JCS、浏览器与 Node 共用参数语义、源包可移植路径和摘要、环境继承、Ajv 校验 | 服务接入和数据库事务 |
| Studio 与品牌 | 离线交互参考、品牌图标和分享图、明暗配色与网站字体配置 | 生产网站、完整手机/平板交互、字体加载和浏览器验收 |
| 审核与购买接受 | 默认关闭的Prompt Sift适配；输出抽样、预览与购买同意的参考逻辑 | 实际输入/输出审核、持久化和Waffo接入 |
| 网站政策 | [Terms、Privacy、Refund 英文草稿](../content/pages/README.md)及模板变量示例 | 主体和供应商事实、页面渲染器、发布校验及实际流程 |
| 工程检查 | 精确工具链与冻结 lockfile；`check:repo`（含 v2 旧标识符检查）、单元测试与 `typecheck` 在 CI 的 `contracts` job 运行 | `browser`、`cloud-local`、`deploy` job 随 S1 加入 |

下一步是 S1：film-runtime 与 ★ 积木、渲染容器、云端链路、分阶段导演、声音和 G1 云端检查点，顺序和出口见[08](prd/08-codex-execution.md#2-里程碑与退出关口)。生产 Agent 保持 `enabled=false`；真实调用只在模型授权的范围和总额内进行。长期验收证据按[06](prd/06-testing-and-release.md#5-发布与证据)管理。
