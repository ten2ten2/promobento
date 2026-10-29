# 云端动效管线技术设计

对应 PRD **v3.0**、协议 **3.0.0**。本文只维护创作／渲染后端的技术设计及尚未完成的能力；产品规则见 [PRD 索引](../prd/README.md)，实施顺序和出口统一见 [08](../prd/08-codex-execution.md#2-里程碑与退出关口)，部署和验收现状统一见[实施状态](../implementation-status.md)。下文标注“目标”的能力尚不能作为已实现接口使用。

## 0. 目标与边界

服务软件与课程／数字产品团队，完成素材理解、方向比较、自由创作、声音、改稿、目标准备、变体和成片输出。固定 **15/30 秒、30 fps、六个平台预设、七个目标、四种画幅**。`targetId=presetId:aspectId` 表示交付目标，`aspectId` 表示渲染画幅。

作品使用 `film-v1`：FilmSpec + 可信积木 + 沙箱自写镜头。历史 identityVersion 1 的入口、摘要、已发布契约和环境按 [14](../prd/14-production-contracts.md)保留读取／重放，不因采用 film-v1 重算身份或重复收费。CAS、冻结、权限、账本和商品权益仍按 14／05。

网站、Google／邮箱登录、Waffo、邮件和团队流程按各自 PRD 实施。此管线向它们提供后端及嵌入式预览；对外工程 ZIP 仍是需单独许可审核的 P1。终版能力仍在 S0–S3 范围内，切片只决定顺序，不删除未完成需求。

## 1. 设计目标

### 1.1 单位成本

数值以 [agent-policy.unitCostTargets](../../config/agent-policy.json) 为准；范围和核算方法见 [07](../prd/07-growth-and-experiments.md#4-完整单位经济)。创作包含素材理解、方向、自写镜头、审片、全部内部修复和主画幅成片；改稿和目标准备包含其必要 QA／失败费用。计算费、模型费和未知预留分开报告，不能用单文件编码费替代完整操作成本。

止损上限不是成本目标。S1 的积木创作模型 p50 ≤$0.70、p95 ≤$1.20，完整阶段使用配置中的目标。超标先优化有效缓存、上下文、局部编辑与已验证模型路由；仍不达标由负责人决定目标、价格或权益，不在实现中自行缩减。

### 1.2 时间

除明确标注外为 p50 目标；实际分布包含失败及完整墙钟，不能删掉排队或混合不同资源候选。

| 环节 | 目标 |
| --- | --- |
| 开始创作至三张真实方向卡 | ≤2 分钟 |
| 选方向至可播放积木草稿 | ≤3 分钟 |
| 选方向至完整候选（含自写、审片、成片与 QA） | ≤10 分钟；p95 ≤18 分钟 |
| 定点改稿至候选 | ≤3 分钟 |
| ready studio 的 still | ≤3 秒 |
| 30 秒低清 review 与发现 | ≤30 秒 |
| 纯 2D 最终片 | 30 秒片 ≤60 秒；15 秒片 ≤45 秒 |
| WebGL 最终片 | 帧占比 ≤30% 时 ≤180 秒；整片 3D ≤300 秒 |
| 准备四画幅，纯 2D | ≤3 分钟 |

产品完整构图处理另保留p95门槛：standard空队列单30秒构图≤5分钟、常用三构图批次≤12分钟，从实例准备至必需检查完成；排队／传输另报，批次按实际调度测量，不能将单片耗时乘三。S1客户端墙钟仍包含排队，不能混用计时口径。

硬期限见 §5.3，不作为性能达标值。当前性能结果见[性能证据](../evidence/2026-10-24-s1-performance/README.md)，不把旧资源的分布当成当前配置。

### 1.3 质量与安全

S1 负责人正常速度视听愿意发布 ≥4/6；完整阶段 ≥5/6，且软件／课程各至少两题。内部真实品牌评测不公开、不充当首发营销样片；首发授权作品和目标用户盲审仍按 01／06／07。

每个分段或 studio 单独隔离，实例无长期凭据、出网只经 broker。QA 使用可信实际观测；客户预览在独立注册域名。验证按改动影响选择必要范围，阶段出口仍须具备完整证据，不要求每次方法或文档修改都重跑付费全集。

## 2. 总体架构

```text
客户 Studio（待实现）
  └─ 独立域名 sandbox iframe：同源包预览、父页时钟／音轨、点选和评论
Worker
  ├─ OperationWorkflow：分阶段导演、方向等待、候选编排
  ├─ RenderWorkflow：计划、分段、观测／接缝、拼接、提交
  ├─ OperationDO：操作 studio 与进度；ShardDO：每 attempt 一台容器
  ├─ CoordinatorDO：物理实例 lease
  ├─ BrokerEntrypoint：任务令牌限定的唯一容器出口
  ├─ D1：操作、权利、引用、费用；MODEL_LEDGER：跨环境共享模型预算
  ├─ 私有 R2：输入、回执、媒体、许可；Queues：事务 outbox
  └─ ctx.container，durable_object 调度，enableInternet:false
       └─ render 镜像：shard / studio / audio / assemble
S3 目标：AssetWorkflow + AssetDO + 断网资产镜像；Workers AI ASR；可信 Browser Run 抓取
```

当前只有内部 staging 控制面、两个 Workflow 和三类 DO；进度用 SSE，方向选择用 `waitForEvent`，渲染等待用有界持久轮询。事件化渲染等待及客户预览桥属于后续接入，不能把架构图当作部署清单。绑定以 [wrangler.jsonc](../../apps/cloud/wrangler.jsonc) 为准，实际运行／恢复入口见 [cloud README](../../apps/cloud/README.md)。

## 3. 模块与固定依赖

### 3.1 代码归属

| 模块 | 职责 |
| --- | --- |
| `apps/cloud` | Worker、Workflow、DO、broker、迁移、内部调度和账本 |
| `apps/render-container` | 固定镜像、控制器、Chromium、取帧／观测、编码／音频、探针 |
| `packages/contracts` | 严格 JSON 解析、JCS、摘要／身份、Schema 与预编译验证器 |
| `packages/film-runtime`、`packages/blocks` | 页面、shim、engine、OM/clip、可信积木 |
| `packages/audio`、`packages/fonts`、`packages/methods` | 声音、固定字体、分阶段导演方法 |
| 待实现 `apps/asset-container`、`packages/preview-player` | 素材处理与客户 iframe 播放器；随真实实现加入，不建空入口 |

### 3.2 采用与许可

huashu-motion基础参考固定为 `4236053`（v0.2.0）；各模块的具体移植和补充方法来源以NOTICE为准，只采用所需方法／画面语法，不vendor全库或追随浮动版本。上游 12 个模板作为完整能力的自写冒烟用例，storytime 改为原创角色，不做上游 CLI 的 SSIM 对等。作者形象、签名、分享服务、macOS 专用命令和 cookie 抓取不采用。

GSAP 3.14.2 只随镜像分发，不进 Git；Three.js 0.186.1 按需加载；字体使用固定OFL登记，源字节／WOFF2／cmap和PuHui→Noto别名绑定运行环境。完整阶段仍需补英文默认组合、Noto Color Emoji及现有子集外简繁中／日／韩字形，缺字明确失败，不回退浮动系统字体。采样只用审核CC0子集。采用文件、许可与修改说明各自见 [09](../prd/09-sources-and-licensing.md)、packages 下 NOTICE／LICENSES，不在本文另存许可结论历史。

### 3.3 构建与版本

镜像只由 GitHub Actions 构建／推送。依赖层缓存复用固定字节；Chromium、GSAP、FFmpeg、字体、运行库版本与摘要取[环境锁](../../apps/render-container/environment.lock.json)。新镜像登记新 renderer release，不覆盖旧记录。发布环境按 14 保留；不能因冻结的是视频字节，就删除仍被任务、分段或购买快照引用的可执行环境。

当前命令只认 [08](../prd/08-codex-execution.md#1-接手与当前命令)及 package/mise 已登记入口。`cloud:dev` 全镜像本地链路等目标尚未完成；现有 `test:cloud-local` 是离线模拟，不冒充 Miniflare／真实容器验收。

## 4. 作品：film-v1

### 4.1 源包与路径

唯一入口为 `film.json`；自写镜头放 `scenes/<id>/`。完整设计上限为 64 个作者文件／8 MiB，不含二进制；当前每镜头只接受单个 `index.js`，每份 ≤64 KiB、合计 ≤512 KiB，CSS/SVG/JSON 模块扩展和任意导入尚未开放。

页面由可信生成器组装，shim 先于任何库／作品脚本执行；运行库和字体取固定路径，素材只按获准 resourceId 放行。当前图片为 `/r/<id>`，视频为 `/frames/<id>/<index>.webp`，字体为 `/f/<id>/<weight>-<style>.woff2`；具体以[生成器](../../packages/film-runtime/src/page.ts)为准。缺失或越权明确失败，不回退外网资源。

### 4.2 FilmSpec 与身份

[FilmSpec Schema](../../contracts/film.schema.json)定义风格、文字、资产、音频、镜头与 Treatment，本文不复制字段类型。Worker 先用 `parseCanonicalJson` 和共享预编译校验器检查纯数据，再执行跨字段／实际运行能力准入，不求值自写源码。

- 覆盖 `[0,totalFrames)`，无空洞，只在合法转场处重叠；事件与区间使用整数帧。
- 所有上屏文字来自 text slots，商业主张绑定已确认 factIds；当前未绑定／改写的自写可见文字直接 BLOCK，不只拦含数字的文字。
- 字体、积木、素材存在且许可有效；全局纹理／布局覆盖等未支持字段不能因 Schema 合法而执行。
- 无真实素材、仅 Logo、偏离拍点等创作发现按规则 REVIEW；不能以模板自动填造事实。
- FilmSpec 保存 Treatment 和可编辑值，产品 values／Composition 封装及历史身份仍按 [14](../prd/14-production-contracts.md#2-manifest目标与冻结准备)，不能用单个 FilmSpec 摘要替代完整作品身份。

### 4.3 可信积木

积木用参数 Schema 声明四画幅布局、编辑项、事件、区域和代价；绘制必须是时间纯函数。暂停 GSAP 用 `seek(t,true)`，不依赖 `onUpdate` 累积状态。四画幅顺／逆／冷 seek 按 §5.6 容差验证。

文字换行后可缩到 03 的字号下限，仍放不下报 `TEXT_FIT_FAILED`，不截断原文。普通文字对比度 ≥4.5:1，大字 ≥3:1；大字由实际字号／字重识别（≥24px，或 ≥18⅔px 且字重 ≥700），不按作者 role 豁免。

终版积木范围如下；★ 为 S1 核心九项，当前实际参数和版本见[积木契约](../../contracts/block.schema.json)与[运行时说明](../../packages/film-runtime/README.md)。

| 类别 | 范围 |
| --- | --- |
| 文字 | ★hook-title、kinetic-list、quote-card |
| 软件 | ★ui-showcase、★ui-journey、★feature-grid、cursor-demo、card-montage、before-after、code-snippet |
| 数据／证据 | ★metric、chart、logo-wall、testimonial、evidence-collage |
| 课程 | ★talking-head、★curriculum、outcomes、instructor-intro、offer-deadline、whiteboard-explainer、math-explainer、illustrated-explainer、story-figure |
| 3D | device-3d、logo-3d、product-stage |
| 收尾／全局 | ★cta-endcard、★captions、brand-sting |
| 转场 | cut、crossfade、fade-through、push、whip；待补 wipe、zoom-through、match handoff |

图表涨跌配色可配置；评价／报价／期限须绑定事实与权利。角色原创，不采用上游作者形象。`device-3d` 已额外接入，其他未实现项不因列在表内成为可调用积木。

### 4.4 自写镜头

当前入口 `PB.scene(id,ctx=>({timeline}))`，API 以 [film-runtime.d.ts](../../contracts/film-runtime.d.ts) 为准。D 只写本镜头模块；通过字面量 `ctx.text('id')`、`ctx.asset('key')` 获取已声明 handle。当前开放 DOM、SVG 图形、Canvas2D、暂停 GSAP／OM.clock；自写 WebGL/Three.js、CSS 原生动画时钟接管、扩展 clip/OM3 是完整阶段目标，未准入前拒绝。

Q0 静态解析 Acorn，不执行作品；完整模块通过身份与安全准入后，只在渲染容器独立 uid 的 Chromium 沙箱运行。每镜头事件／首尾／阅读点去重最多 24 帧。自写可见文字只能由文字槽位挂载，当前禁用 Canvas/SVG 文字绘制。详细限制和使用方式见[运行时说明](../../packages/film-runtime/README.md#自写镜头源码与规格分开)。

### 4.5 运行时保证

- 真实计时器只留在可信闭包，一次性交给引擎，作品取不到。Date/performance 使用虚拟时间；每次 seek 重置 `random-seq-v1` 调用序号。
- 初始化之后禁计时器／自主动画循环；GSAP ticker 关闭，所有时间线暂停。OM.clock 用属性 setter 驱动，静默 seek 仍正确绘制，不重复 draw。
- 在载入源码前封闭 eval/Function 及普通、async、generator、async-generator 动态构造入口；可信宿主用直接 CDP 桥，不向作品暴露句柄。
- 网络、Worker、WASM、存储、iframe/srcdoc、AudioContext、video 禁用；视频只从授权 PTS 帧图取样，缺帧失败。CSP、shim 和容器断网共同实施，不只靠静态检查。
- 字体 ready、图片解码、3D ready 与帧协议握手完成后才 seek；过期 session、序号错乱、取消及 dispose 后不能继续取帧。
- 引擎按帧合成活跃镜头与转场；不自动叠上游签名。客户预览的代理视频是近似回放，不能作为可信 QA。

### 4.6 WebGL

按锁定 SwiftShader 的 CPU 路线实现，真实 context 的 renderer/vendor/version 每次与环境锁核对；不匹配报 `RENDER_ENVIRONMENT_MISMATCH`。只有 3D 页面加载 bundle，ready 等待资源与首帧，dispose 释放纹理／几何／context，context 丢失明确失败。

WebGL 帧默认占比 ≤30%，超出需说明并按 3D 时间目标验收；分段初始代价为 2D 的 6 倍、最多 24 段，使用 standard-4。不采用前置探针无收益的 renderScale、着色器磁盘缓存和文件系统快照加速；未来变更须有对应负载证据。现有 device-3d 不等于自写 WebGL 已开放。

## 5. 渲染管线

### 5.1 任务

[render-job Schema](../../contracts/render-job.schema.json)绑定源、画幅、精确 renderer、资源／字体、音频、profile、段区间、允许读写和 generation。[RenderProtocol](../../contracts/render-protocol.d.ts)管理 init/seek/sample/inspect/dispose。`standard` 默认单采样，motion4/8 默认关闭，不能由 UI／模型自行增加成本。

### 5.2 执行

1. Worker 核对源、许可、身份、renderer 和预算，原子预留后派发。声音按冻结 AudioPlan 只合成一次，输出 48 kHz 双声道 WAV。
2. 按帧代价切段，final 切点为 15 帧整数倍；纯 2D 当前 15/30 秒均六段（75/150 源帧）。review 用 30 源帧单元，15 秒段长 60/90，30 秒每段 150；WebGL review 段数减半。
3. 每段新实例冷 seek 到 `a-1`（首段除外），存 PNG 后顺序捕获 `[a,b)`，另存末帧 PNG。JPEG92 经 CDP 直送 FFmpeg，不在 JS 解码常规视频帧。
4. review 仍按 30 fps 源时间轴，隔帧捕获完整逻辑尺寸，可信宿主缩为半尺寸／15 fps；不使用会改变栅格历史的浏览器半比例截图。接缝和阅读观测使用 PNG。
5. 分段统一 H.264 参数、yuv420p、BT.709、closed GOP 15、`-bf 0`；FFmpeg 线程与实例配额对齐。必要多采样按冻结 profile，期限涵盖全部子帧／合成／readback。
6. Worker 核对每段实际阅读计划的精确覆盖、回执和接缝；无计划点的短段允许空观测，不能用任意非空数组替代覆盖。
7. assemble 顺序封装 Annex B，混入冻结 WAV，核查 CFR、450/900 帧、PTS、GOP、色彩、时长、体积和一秒码率；封面来自真实帧。VBV 超标最多一次纠正，仍不合格失败。
8. 对最终 AAC 解码信号检查响度目标 ±0.5 LU、真峰 ≤−1 dBTP 和非预期静音；必要时只从原 WAV 做一次纠正，视频复制。合格字节不重写，复测失败阻断。
9. generation／权利重查后原子提交媒体引用和 outbox；失败 attempt 不覆盖已提交字节。确认实例停止后归还 lease、持久结算。

### 5.3 期限

取 [agent-policy.render](../../config/agent-policy.json)，所有等待／重试受原绝对期限约束。

| 阶段 | 当前上限 |
| --- | --- |
| 启动前 broker 注册 | 30 秒，尚未分配实例 |
| 分配后控制器 ready | 45 秒，且不超过整次剩余时间 |
| 页面初始化 | 2D 30 秒；WebGL 60 秒 |
| 单帧（含子帧／readback） | 2D 5 秒；WebGL 10 秒 |
| 分段 | 帧数×基数 +30 秒；基数 2D 1 秒／WebGL 6 秒 |
| 拼接／纠正 | 60 秒；重编码另按帧数×0.2 秒 +60 秒 |
| 整次渲染 | final15 150 秒；final30 240 秒；review 180 秒；WebGL 增量按配置 |

review 的 180 秒为内部止损，不改变 §1.2 的 30 秒 p50 目标；历史 90 秒超时仍是失败。单帧捕获分位数不含背压／准备／QA，不能直接替代完整段期限。模型请求单独受 `limits.requestTimeoutMs`（10 分钟）约束，不与渲染共用计时器；整次导演期限见 §6.11。

### 5.4 失败与恢复

作品／字体／Q0／实际帧问题按明确错误码处理；只将支持的、可归因且有完整证据的失败交给导演修复。未知调用不重发，源码错误不靠平台重试。

基础设施重试只有 RenderWorkflow 调度，原生计算 step 重试为零。明确容量／断连、broker 注册或控制器健康超时，须先确认旧实例停止、费用已结，再按 15/60 秒退避使用新 attempt，最多三次；原 generation、累计预算和绝对期限不变。未知停止／费用、INIT_TIMEOUT、权限、预算、QA、deadline 不自动重试，也不把整机消失一概判成 OOM 或可重试故障。

失败先持久业务终态／首因，再独立停止和对账。清理异常不覆盖首因；原生 restart 清空检查点也不能重领执行权或重发付费请求。实际恢复入口见 [cloud README](../../apps/cloud/README.md#原生-workflow-中断后只清理不猜测重跑)。

### 5.5 沙箱与环境

固定启动参数在控制器／环境锁，不从本文复制可漂移清单。PID 1 分离 uid 后降为 10003；控制器 10001、浏览器 10002，均无 capability。每次加载作品前核对 renderer uid、seccomp、NoNewPrivs、PID/user namespace；不满足报 `RENDER_SANDBOX_UNAVAILABLE`，不得静默加 `--no-sandbox`。

Chromium 使用 `--disable-dev-shm-usage`，共享内存文件落实例私有 `/tmp`；保持完整沙箱。CSP 禁外网／动态编译，浏览器不带 broker token 或长期凭据。隔离固定项和自写定点故障证据见[运行时](../evidence/2026-10-24-s1-runtime/README.md)与[正式隔离](../evidence/2026-10-24-s1-performance/README.md#正式镜像隔离通过)，完整 S2 语料仍待。

### 5.6 确定性与接缝

比较前段顺序末帧与后段冷启动重叠帧的实际 PNG：相同直接通过；不同须满足**最大通道差 ≤2 且差异像素 ≤0.1%**，记录容差使用及 CPU flags。失败为 `RENDER_SEAM_BLOCK`，不得只因比例小就忽略超大的通道差。

不要求跨机器所有字节相同，不对冻结交付反复重渲证明身份。可信积木回归、自写执行前的顺／逆／新实例冷 seek 仍须完成；它们与成片接缝不是互相替代关系。预览用于创作，可信 QA 绑定实际捕获／编码结果。

### 5.7 增量渲染（S2）

复用键包含 runtime、renderer、画幅／profile、区间、活跃镜头的规格／源码、全局风格／音频、资源／字体摘要。只重做失效段，新旧段仍检查接缝；复用自写段额外冷渲首尾核验，失败放弃复用。被引用分段保留到引用结束。

先固定用户要保留的内容，再优化计算。换声音只重做音轨／合成的目标，须先隔离画面对音频／拍点的依赖；当前键仍含 audioPlanHash，不能直接删身份字段规避重渲。准备四画幅按实际物理名额排队，不额外扩并发。

## 6. 导演流水线

### 6.1 编排和上下文

每个操作一个 Workflow，各阶段独立上下文，只带所需事实、素材观察、方法和输出契约。方法包固定版本／摘要，静态前缀稳定；调用前原子预留，原始响应先保存再解析／结算。两种接口的协议实现见 [models](../../packages/models/README.md)，不用返回散文拼造工具结果。

阶段只认配置绑定与能力。默认图像输入要求实际 vision；显式 `asset-insights` 可让纯文本 D 使用 A 真实看图后的 resourceId/sha256 绑定观察，缺观察即停止，不自动降级。

### 6.2 阶段 A：理解

事实只整理已确认内容，缺项不补造。每个清权素材按字节摘要＋提示版本缓存观察，包含内容、关键区域、颜色和适用画面语法；图中文字不是指令，录屏保留关键时刻。用户启用的工作区经验按 13 隔离。

### 6.3 阶段 B：方向

Fit／Amplify／Unexpected 提供不同概念、色板来源、运动、声音和风险；至少一项纵深。当前 B 只写三张精简卡和骨架，可信宿主按事实／主图／风格构建静音积木 hero，再经真实 studio 取图，不生成三份完整影片。hero 是构图参考，不冒充自写镜头效果。

审核通过后等待选择，直接制作可跳过。按层混合、独立色板图与完整方向交互仍为目标，当前未全部接齐；旧完整 keyframeFilm 继续严格准入，冻结方向不重写。

### 6.4 阶段 C：规格

输入原需求、选择、A 观察、积木参数、拍点和方法，输出完整 FilmSpec／Treatment，自行决定镜头数与路线。阅读、英雄落点、节奏反差和视线交接按内容设计，不强制所有片子在相同时点爆发。商业主张忠实压缩但保留归属／限定条件／factIds，定稿、名称、CTA/URL 不改。

完整响应的解析／Schema／语义错误最多纠正两次；每次新 callId，原响应照常计费且不缓存。网络、截断、未知消费不进入纠正。自写占位只能作内部制作草稿，不作已完成画面交付。

### 6.5 阶段 D：自写镜头

按 hardest 顺序，每镜头上下文只带其 brief、相关槽位／素材观察、风格、相邻姿势和方法。当前最多两个自写镜头，先创建静态布局，再分至多三个动作窗口原子编辑同一模块；窗口不改变原事件／时长或降低 brief，最后核对所有状态、署名和阅读点。

最难镜头先做独立探针，其他模块可用无画面占位；只检查无重叠的可归因帧，不能当完整候选证明。全部模块完成后仍检查每请求画幅的事件／首尾／阅读窗口、逆序和新实例冷 seek，确认 studio 关闭后才渲整片。

新方法可按[导演说明](../../apps/cloud/README.md#导演选择结构d-实现自写镜头)为关键帧声明DOM图片检查；已声明素材未显示或无法确认时停止，未声明内容和Canvas仍需审片。CTA可用 `fade-through` 避免出入场正文叠字；旧 `crossfade` 保持原含义。

符合已冻结方法的 `CUSTOM_QA_BLOCK`、`CUSTOM_HOLD_TEXT_MISSING`、`CUSTOM_SEEK_MISMATCH` 有完整证据时，每镜头最多一次 D 定点修复，仍共用原次数／费用／期限。不可归因的重叠、未知消费、权限或清理未确认直接停止。实际工具、文字拟合和输入约定见 [cloud README](../../apps/cloud/README.md#导演选择结构d-实现自写镜头)。

### 6.6 阶段 E：整片 review

先生成低清全片，再提供各画幅**全部实际阅读停留**拼图、第一画幅动作姿势、源帧映射、原需求／方向／事实和可信发现。低清 MP4 的 huashu 全帧低分辨率运动线索也交给 E，限制和失败状态见[渲染服务](../../apps/render-container/README.md#四种模式)；部署与验证范围见[实施状态](../implementation-status.md)，不能代替实际动态或音频审核。每秒图、声音能量／落点和完整 Q1/Q2 仍需接齐。

当前 E 用 `write_spec` 或限定源码 `edit_file` 修改，完整校验后重新检查／渲染；`spec_patch` 是契约内的后续局部能力，不假定已接通。E 携已应用的规格历史核对修稿，不以调宽元数据代替视觉修复。E/F 共用最多两次内部修复，原阶段费用和调用上限不重置。

**内部未验收草稿**：已到修改上限或 F 无法继续修复时，只交接最后实际渲染的媒体及未应用建议，生成 `s1_internal_review_draft`／`acceptanceStatus:unapproved`。操作仍 failed、候选接口仍 404，内部下载重查 generation／许可，不计完整导演或质量通过。技术／预算／未知响应错误不借该入口放行；最新 E 参数不完整时的影片为本机按已有回执提取，不冒充此自动分支已云验。

### 6.7 阶段 F：冷审与提交

完整实际最终片与各画幅证据就绪后，F 用与 C 不同家族的独立上下文看原需求、方向、Treatment、上屏出处／事实和媒体，不带 D/E 对话或修稿历史。必须检查走神时点和产品独特性。

当前 F 以恰好一个 `submit_cold_review` 工具返回完整 cold_review Schema，16k 输出上限；BLOCK 可在共享两次修复内触发一次 C 修正，再走 E、全画幅渲染和第二次 F。无变化、再次 BLOCK 或额度用尽停止；截断不猜结论、不自动重发。F 通过后才提交内部候选，不把 E 的 submit_candidate 工具名误认为完整冷审通过。

### 6.8 工具边界

[agent-tools Schema](../../contracts/agent-tools.schema.json)定义协议范围；当前已接入工具及控制面见 cloud README。`edit_file` 限当前镜头路径，首次 create、后续唯一匹配 str_replace/insert；实际 Q0 错误按 code/path／有界源码行反馈，不静默改路径或补工具。工具或源码都不能访问支付、密钥、别的工作区和已购源包。

### 6.9 改稿（S2）

一轮最多五条批注／4,000 code points，每条绑定版本、画幅、整数帧、坐标和可信复核区域，整组计一次。普通直接改值不调用模型；自然语言分流后区分镜头内与结构／全局修改，先展示影响，再只给必要上下文。事实同步／重新确认、CAS、接受／拒绝、follow-up 和计次按 13／14／05。`affectsTiming` 本地修改不开放。

变化处及相邻交接重新检查，未变部分按 §5.7 复用；用户拒绝不损坏当前稿。不把分流模型的费用算成“直接编辑免费”。

### 6.10 目标准备与变体（S2）

四画幅先确定性适配；只有自写镜头 Q1 失败才作定点修改，变更后所有受影响画幅失效。购买并导出前冻结全部合法目标的**来源和必要 QA**，高清可按需编码，不要求付款前编码全部文件；top_up_only 不要求作品快照。

变体默认关闭，开放前定义计次。30→15 按重要度重新剪辑／配乐，不加速；换开场／CTA 的确定性部分不用模型，改事实重新确认。跨目标同字节复用不合并授权／平台映射。

### 6.11 预算、限制与 effort

[agent-policy.director](../../config/agent-policy.json)维护调用、金额、effort 和活动期限；[model-providers](../../config/model-providers.json)维护实际步骤绑定、能力和冻结价格；[model-authorization](../../config/model-authorization.json)维护授权身份／总额／有效期，本文不复制另一套表。

- 当前 A/B/E/F 为网关 DeepSeek，C/D 为网关 Opus 文本；D 为显式 asset-insights。Claude `vision:false` 不变，官方备用未绑定／未验证。effort 仅证明参数被接受，不证明网关实际执行其推理语义。
- D 每镜头最多 12 次／$0.35；当前布局 16,384、动作 32,768 输出 token。E/F 共用两次修复；适配器不自动重试截断／无 usage。
- 创作活动上限通常 **20 分钟**。仅 staging、purpose=evaluation、scope=internal_eval_only、冻结 product-directing 方法 ≥1.5.0 且实际含自写镜头时可用 **30 分钟**；从原活动起点算，只扣除方向等待，D／修复／重试不重置。
- 改稿／准备的规划活动上限为 8 分钟，随对应真实入口接入；单模型请求另按 requestTimeoutMs。时间错误使用 DEADLINE/TIMEOUT，不伪装 BUDGET。
- 达到预算或阶段次数立即停止；没有保持原质量的可信降级实现时，不自动把自写镜头换成积木。
- 历史费用未知、新增有限放行和当前占用只在[实施状态](../implementation-status.md#有效授权与费用)记录，不能因换模型／部署／取消／新操作重置授权。

### 6.12 模型回执与计价

所有真实请求先共享 D1 原子预留最坏输入／输出／图片／缓存费用，隐藏输入路线另按配置预留；本地阶段准入失败仅在能证明尚未派发时释放为零。原响应、后到 usage、价格／汇率版本先存不可变私有 R2，再解析／结算。有完整坏 JSON 可在原上限内结构纠正，无 usage 必须对账，不能补造实收。

同请求／模型／目录／工作区／项目／用途的已结回执可重新准入，不重付或恢复旧操作；未知回执不能借此放行。补账按原 callId／价格，不按新目录重算。后续探针也走同一账本，历史独立付费脚本仅保留来源，禁止继续执行。

## 7. QA 与输出审核

Q0–Q3 的产品定义统一见 [13 §6](../prd/13-agent-native-production.md#6-四层-qa)，放行、证据身份、输出审核及豁免见 [14](../prd/14-production-contracts.md)。

- Q0 检查完整规格、源码／路径、依赖／许可、危险 API、纯时间和文字槽位；硬安全限制 BLOCK，不在 Worker 执行源码验证。
- Q1 可信 CDP 读取字形、实际字体、布局、安全区、对比度、遮挡和可点区域。完整目标包括镜头首尾、关键帧、每秒和高风险运动；当前停留／动作采样的覆盖须明确标注，作者属性不自动豁免 BLOCK。
- Q2 检查实际编码媒体、闪帧／无意静止／黑尾、音轨与落点（±1 帧）、静音可读、确认转写、Treatment 和商业事实。节奏阈值按评测复标为 REVIEW，不把“前三秒必须爆发”等启发写成全部作品硬规则。旁白混音可压低音乐并让出中频，但仍须全混音达响度目标。
- F 独立冷审不能替代正常速度视听；Q3 负责人／用户发布意愿不是模型自评分。
- `tests/qa-mutants` 等完整反例目标包括缺字／越界、超长文字、历史依赖、禁用 API、无事实价格、开头无意静止；随对应能力实现，不建返回成功的空测试。
- 方向、Treatment、草稿和候选展示前按 output-safety-sampling 的完整策略审核；不能因素材和积木可信就省略文本／画面的必需覆盖。当前内部评测不代表生产审核适配已接通。

## 8. 素材与声音

### 8.1 素材管线（S3）

第一次处理前（含免费预览、解码、转写、送模型）核验许可。上传前缀 quarantine 只做大小／MIME 准入，不在未清权状态解码；转为获准资源后再处理。

资产容器目标：probe（VFR/HDR/编码，拒绝 HDR）、normalize（CFR30母版及原 PTS 映射）、image（sRGB，长边目标 ≤3840）、proxy（半尺寸 MP4）、extract（PTS 无损 WebP＋索引）、fontcheck（授权、cmap、子集）、tts（P1）。内部评测素材的现行限额不等于未来资产转换目标。

受控抓取为 P1，默认 fetch=false：可信 Browser Run 只允许公网 HTTP(S)，拒绝私网／链路本地／元数据，限制重定向并逐跳复核。先确认抓取／处理权利；抓取结果仍须审核来源和事实，不把 HTTP200 报错页当素材。客户字体上传默认关闭。

Workers AI ASR 是 S3 路线，前置小样本不等于产品集成；转写为 pending_confirmation，用户确认后才做字幕／事实绑定。使用真实词时序，长词和不确定识别复核，不用插值伪造逐词时间。

自动 TTS 默认关闭。候选须核对接口、实际报价、模型／声音许可、语种／发音、用户同意和输出质量后再登记，不固定尚未验证的厂商。负责人提到的 index-tts-2 尚未接入，不改当前冻结音乐选择。

### 8.2 音频

AudioPlan 是可信端从 FilmSpec、获准音源、积木／自写声明事件生成的不可变数据，不在 Worker 求值作品的 OM.music／OM.sfx。页面禁止 AudioContext。音乐源为 procedural／score／upload／none；显式静音不造假音轨。

配乐、23 种合成 SFX／五组音色和拍点按实际事件对齐；ABC 支持有理拍点并记录帧舍入。音轨精确在 N/30 秒内收尾，时序变更重算依赖；上传配乐分析真实拍点。旁白／原声需确认转写和字幕，录屏默认静音，不能借音乐上传绕过语音准入。

内部 ABC／WAV 当前准入、大小／格式、单独时长批准和 source rights 见 [cloud README](../../apps/cloud/README.md#导演使用已批准的音乐)及 [audio-admission Schema](../../contracts/audio-admission.schema.json)。音源／谱批准不能从模型的选择推导；13 风格保留也不自动批准新谱。完整客户音频和 30 秒链路按实施状态继续。

### 8.3 采样与权利

不采购曲库；程序／ABC 使用审核 CC0 子集（VSCO2 CE、VCSL、Karoryfer、FreePats），排除 CC-BY Salamander 钢琴和 Wurlitzer。固定提交、源文件／摘要、许可与限制统一见 [audio NOTICE](../../packages/audio/src/NOTICE.md)和采样清单；音频事件绑定 licenseRef，不从仓库 MIT 推导素材许可，不单独转售采样。

## 9. 云端状态与资源

### 9.1 容器与部署

使用 SQLite DO 的 `ctx.container` 与 `durable_object` 调度。先在未启动实例注册唯一 `broker.internal` 拦截，再 start 禁网实例，控制器 ready 后发任务；不依赖长期 monitor 或空闲超时回收，任务结束显式 destroy 并核对 stopped。

当前 shard／studio 用 standard-3；WebGL shard 用 standard-4；audio／assemble 用 standard-2、一个 FFmpeg 线程。S3 资产实例目标 standard-4。实际配置和类型取源码，不在文档复制平台全规格／限额表。环境变化按固定工具链主动核验，不随普通文档修改升级 compatibility_date。

### 9.2 broker

唯一出口 `http://broker.internal` 经内部拦截交 BrokerEntrypoint。HMAC 令牌限定操作／attempt／角色、精确读键、写前缀、类型、大小和有效期；只经首个任务请求体交可信控制器内存，不进环境／文件／Chromium。R2、模型和账户凭据不进入实例。

任务写限额和键以 render-job／broker 实现为准；读写均核对权限、字节身份及 generation。诊断不返回 bearer、指纹、完整任务或素材；原始故障只允许有界去敏的私有引用。

### 9.3 D1 与 Workflows

当前 `apps/cloud/migrations` 的 pipeline_* 是内部实现，不等于已实现产品订单／冻结表；跨环境模型账本单独 `model-ledger-migrations`。事务写业务状态、预留和 outbox，Queues 派发有独立原生实例登记；已发 outbox 不能当已创建 Workflow。

正常恢复复用持久检查点；单次执行 claim 防整次 restart 重放。取消先封 generation，再终止 Workflow／停止计算，迟到创建同样清理；未知状态不自动 recreate。定期有界对账修复原生终止但业务未终态的记录，不依赖平台短期历史作长期账本。

### 9.4 R2 与保留

输入／回执不可变；当前输出位于 `renders/<id>/attempts/<taskId>/out/…` 等 attempt 私有前缀，只有完整验证后发布引用。不得用设计中无 attempt 的示意键覆盖现有对象。

生命周期按 04／05 和 active refs 执行：临时预览 72 小时、未引用分段／quarantine 目标七天；被任务、候选、冻结、购买或必要证据引用的源、媒体、许可和环境受保护。后台引用清理／保留任务仍待实现，不能把规划的 retained 前缀当已部署安全机制。删本机重复下载不等于删除 R2、用户或费用数据。

### 9.5 并发与成本

名额只由 Coordinator 管，配置为准：全局 shard64、工作区24、2D 每片6／WebGL24、studio32、asset8。声音与 WebGL 共用工作区名额，满载在原期限内等待，未取得 lease 不启动或预留计算费；只有实际停止并完成相应结算后释放。

计算当前按分配完整 CPU／内存／磁盘×实际运行时间记保守上界，使用任务冻结的单价；不是供应商账单，也不能称其他平台费用可忽略。完整单位经济另计模型、存储、队列、抓取／ASR、失败和支持等实际费用，按07核算。模型计价／缓存／汇率／向上取整复用共享实现，至少每月按供应商统计对账；差异超过5%检查计价规则，不改写原回执。

### 9.6 账户与配置

环境 DB／私有 MEDIA／OUTBOX 分开，MODEL_LEDGER 共享；密钥用 approved Actions／Wrangler stdin 绑定，不读出或贴到上下文。Actions 已绑定现有网关模型密钥，官方备用未绑定。S3 才接入的 AI／BROWSER／ASSET 绑定不得当成当前已有。

客户预览 origin 配置为 `p.promobentousercontent.com`／`staging-p.promobentousercontent.com`，独立注册域名；DNS／路由、播放器与桥接仍在 S2。注册域名存在不等于预览服务已上线。

## 10. 安全、可观测与验收

安全目标覆盖断网／DNS、broker 越权、uid／令牌隔离、沙箱、实例不复用、动态编译／存储／iframe／Worker／WASM、死循环／OOM、伪造握手、未绑定文字、跨镜头状态和 WebGL 耗尽。预览 bridge 严格校验 origin/source/nonce/session/Schema，sandbox 不带主站 cookie。完整语料仍按 S2 实现，现有固定项通过不扩写为全攻击通过。

日志只含操作／render／attempt／renderer／stage 和去敏诊断；费用与权利证据长期按其用途保留。目标指标覆盖启动／页面握手、排队、逐帧、接缝、完整墙钟、模型／缓存／费用和停止回收，告警覆盖隔离／环境失败、停止超时、预算和接缝异常。Analytics Engine 面板及完整告警仍为 S3，不假定已可用。

### 10.1 验证范围

日常检查按 AGENTS：选择受影响最小项，集中验证，已有适用证据复用；文档默认只看 diff。发布／阶段出口按 [06](../prd/06-testing-and-release.md)，不能用空实现、mock 或跳过填通过。

- 契约／身份／预算：正反例、固定向量、并发／幂等、未知用量、两种模型协议和恢复。
- 浏览器／媒体：真实四画幅、字体／布局、顺逆冷 seek、接缝／变异、PTS／音频／编码，按实现能力选择专项；完整入口见 08。
- 自写／改稿／预览：完整攻击语料、定点编辑与复用、四画幅、浏览器 iframe 时钟／值／点选／代理视频；未完成的专项不标通过。
- 模型能力：实际绑定的工具／视觉／结构化／effort／缓存／usage／时延和真实质量，变化时只补受影响证据，所有付费请求纳入统一账本。
- 作品：六题×15/30 秒×横竖共 12 输入／24 最终片；费用、修复、时间与发布意愿均报告，完整题目／来源以 [evals](../../research/evals/README.md)为准。

### 10.2 G1 云端检查点

预发布正式镜像须覆盖：生产 broker／分离 uid／沙箱；固定隔离；两类 30 秒片各十次串行＋四路并发的完整性能；PNG/JPEG90/92/95 与 standard-3/4 选型；接缝／CPU flags；真实中途取消／原生终止／restart；物理回收／结算；studio still/check 延迟。

必要证据按 06 保存 commit、run、环境、输入／输出引用、原始数值、失败和未运行项。当前选择、媒体／恢复证据及性能缺口见[证据索引](../implementation-status.md#继续工作所需入口)。内存仅按已批准的 S1 平台限制暂缓，不能改成测量通过。未来发布还须完成产品认证、支付、安全审核和平台上传，G1 不代替生产准入。
