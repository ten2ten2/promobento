# 素材许可、合规与来源

本章维护素材准入、上游许可和外部依据。成片使用权与退款见 [05](05-waffo-billing.md)，数据处理见 [04](04-architecture-and-data.md)，宣传事实见 [13](13-agent-native-production.md)，证据字段和校验见 [14](14-production-contracts.md)。下列来源不代表相关服务已经实现或素材已经获准使用。

## 1 素材准入与证据

**首次处理前就要核验权利，包括模型输入、转写和免费预览。** 每个资源、字体、音轨和音效都要对应来源、许可依据与适用范围。授权不明、用途不符或无法履行许可义务时阻止使用，用户确认或 Agent 声明不能解除已知限制。

| 来源 | 使用前需要的依据 |
| --- | --- |
| 平台提供的代码、字体、音乐和素材 | 已审核的确切文件/版本，许可覆盖云处理、嵌入和交付。默认素材须支持 05 的商用范围，且无需在成片内署名。 |
| 用户上传的自有或获许可内容 | 权利声明或可核对的许可/委托授权，覆盖处理、改编、商业发布及必要的肖像/声音同意；明显存疑时要求补充依据。 |
| 模型或程序生成内容 | 实际模型/工具、条款版本和生成来源，同时核对输入、采样和背景组件的权利。 |

用户素材可以不在平台通用白名单中，但其渠道、期限和署名限制仍须展示并核对。付款、裁切、转码和混音不能消除限制；“无需署名 PromoBento”也不允许删除必要的第三方署名。

P0 视频字体只从审核后的平台字库选择，保存确切文件及回退关系。客户字体上传属于 P1，另行核实云处理、服务器渲染和嵌入许可。PDF 授权文件仅作受限证据，不用于画面绘制。

| 材料 | 许可要求与依据 |
| --- | --- |
| OFL 字体 | 渲染成视频无需让作品采用 OFL 或署名字体作者；分发/修改字体文件仍须保留通知、许可并遵守保留名称条件。系统已安装字体不等于可以复制到云容器。见 [OFL FAQ](https://openfontlicense.org/ofl-faq/)。 |
| 采样、配乐和音效 | 默认采用 [CC0](https://creativecommons.org/publicdomain/zero/1.0/) 或覆盖用途且无需成片内署名的商业许可。[CC-BY](https://creativecommons.org/licenses/by/3.0/) 可商用，但必须履行署名等条件，不能直接放进默认免署名素材包。 |
| 开源代码与附带作品 | 按实际代码许可保留版权和许可通知；仓库 MIT 不自动覆盖肖像、字体、模型、采样和演示媒体。 |
| 用户音乐与真人素材 | 核对音乐作品/录音及肖像/声音的适用授权。发布平台仍可能识别或限制内容，提示用户不等于已经取得许可。 |

许可记录保存原文/版本、来源、核对日期及对应资源。已购快照保留当时依据；发现问题后调查和修复，不改写原有记录。私人授权材料按 04 隔离和保留。成片使用、代码再分发和工程源码交付分别判断；依赖与构建要求见 [08](08-codex-execution.md#3-代码责任与可复现工具链)。

渲染与预览共用 [packages/fonts](../../packages/fonts/huashu/LICENSES.md) 的字体：huashu-motion 登记的 OFL WOFF，以及 `@fontsource` 固定 `5.0.3` 归档的 Geist Sans/Mono（未修改字节，保留 OFL 原文）。程序配乐的乐器采样只用 CC0，清单与来源见 [packages/audio/samples](../../packages/audio/samples/catalog.json)；排除 CC-BY 钢琴与 Wurlitzer。不采购曲库。混音和抽帧前核对这些依据，生成产物继续引用相应来源。

正式与CI镜像均由[build-render-fonts.mjs](../../scripts/build-render-fonts.mjs)核对现有登记的源／许可字节，转换WOFF2、记录输出摘要和cmap，并复制许可。生成字节不写回Git；工具版本随环境锁／构建清单固定。现有字库不保证任意语种无缺字，更广CJK／Emoji覆盖、客户选择／回退及准入服务仍须按实际文字验证。

客户素材只经 `film.json` 的 `assets` 引用已核验许可的资源，作品不能自授资源。内部评测题目（[`research/evals/topics.json`](../../research/evals/topics.json)）可经负责人决定使用第三方品牌的公开截图、录屏和 Logo，但只限内部评测：素材存放在预发布 R2、不进 Git，成片不发布或对外展示，也不作营销样片。新增字体或采样须核对真实文件及用途；公开产品网页可作为题目事实来源，不因此授权复制Logo、界面、照片、音乐或人物。

## 2 视频创作上游

上游固定参考为 [huashu-motion@4236053](https://github.com/alchaincyf/huashu-motion/tree/4236053)（v0.2.0，MIT）。需要的方法、画面语法和检查规则改写进 PromoBento 自己的代码，保留 MIT 来源说明，不整包并入或追随浮动版本。各模块实际采用的固定来源见其 NOTICE 或[渲染服务说明](../../apps/render-container/README.md#四种模式)；[导演方法](../../packages/methods/NOTICE.md)另含负责人指定的固定流程参考，[声音](../../packages/audio/src/NOTICE.md)保留具体移植来源。Three.js r186为MIT。成片不加上游软件签名；素材许可要求的署名仍按具体授权保留。上游作者形象不采用，用原创角色替代。

Hypit 的[内部媒体检查与取景桥接入口](../../research/evals/README.md#用-hypit-逐帧审看片子)固定使用 `@hypit/hypit@0.3.1` 和 `@hypit/visual-track@0.2.0`，不随渲染镜像安装，不在 Worker 或可信宿主执行作品代码。负责人表示已有授权，证明尚待提供；覆盖主体、有效期和托管／多租户范围核验前，仅用于单机构内部评测，不用于对客户提供 Hypit 的托管或多租户功能。上游软件许可不代替素材、音乐或第三方服务的许可。

| 来源范围 | 用途 |
| --- | --- |
| skills/huashu-motion/SKILL.md 与 references/ | 导演、节奏、色彩、运动语言、连续性和受众适配参考 |
| runtime/clip/ 与 showcase 的 art-motion 派生代码；cli/lib/qa、beats、swatch | 2D数学/画面语法/材质与有界视听诊断；保留clip/art-motion独立MIT和NOTICE，不引入3D camera-rig或网页宿主 |
| cli/lib/check、qa、score、sound、composer、dsp | 源码/帧检查与确定性声音；乐谱、采样和依赖单独审核 |
| studio/studio.js、cli/lib/inbox.js、learn.js | 点选、源码定位和用户可控经验；权限和多租户由本产品实现 |

新字体按OFL逐文件登记，其中中文字体为固定子集，不能把缺字替成系统字体。真实乐器采样只引入固定VSCO 2 CE的已核CC0文件，原始许可与来源随资源保存；Salamander钢琴和CC-BY电钢琴不进入默认素材包。新生成音轨使用独立`LicenseRef-PromoBento-Generated-Audio`记录组成材料，算法MIT不冒充输出CC0。自由ABC须有与请求/时长绑定的独立权利审批，模型源包不能自签，变更后重核。

[上游第三方清单](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/THIRD_PARTY.md)将作者“豆子花叔”形象排除在 MIT 许可之外。P0 不采用该形象或含它的演示素材；字体、模型和音源分别审核，清单未提及的材料也要核对。

**积木和自写镜头都可以使用 GSAP。** 本产品已按负责人许可结论采用GSAP；具体分发文件以环境锁为准。GSAP 3.14.2 的 `dist/gsap.min.js` 随渲染镜像分发、不进 Git，版本与 SHA-256 记在[渲染环境锁](../../apps/render-container/environment.lock.json)。确定性靠静默 seek 与黄金帧检查保证，见[技术设计](../plans/cloud-motion-v3.md)第 4.3、5.6 节。

## 3 适用规则与产品边界

### 3.1 版权、广告与侵权处理

[美国版权局 AI 报告 Part 2](https://www.copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-2-Copyrightability-Report.pdf)按人类原创表达判断版权：纯 AI 生成部分不受美国版权保护，人类表达、创造性编排或修改可能受保护。不能仅因使用 Agent 或程序渲染就判断整个成片的权属，也不能把美国结论扩展到全球。平台只授予自身有权授予的权利；转让须满足[适用形式要求](https://www.copyright.gov/title17/92chap2.html)。

[FTC 评价规则](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers)禁止虚构评价与使用经历，参与制作的机构也可能承担责任。真实个案不自动证明一般效果，收益/成绩宣传还须核对[典型结果与关联关系披露](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)。事实与证据按 13/14 检查；用户确认和自动 QA 不构成真实性担保。

若依赖美国 [DMCA §512 安全港](https://www.copyright.gov/512/)，须落实代理登记、通知/反通知、法定处置与恢复流程及重复侵权政策；一个投诉邮箱并不充分。该机制也不自动覆盖平台自行制作的侵权。处置限于受影响内容，并通知用户、保留必要记录。

### 3.2 欧盟 AI 透明度

[官方执行日期说明](https://ai-act-service-desk.ec.europa.eu/en/ai-act/faq/when-does-enforcement-start)确认第 50 条透明度义务自 **2026-08-02** 适用。PromoBento 按新系统要求准备上线；核对日期为 2026-10-21。

按实际市场、功能和角色，分别核对 [50(2) 提供方的机器可读标记/检测义务与 50(4) 部署方披露义务](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50)。使用上游模型不自动解除自身责任；普通动态图形或通用 TTS 不自动构成 deepfake，须判断是否仿真既有人物、物体、地点、实体或事件并误导真实性。平台发布案例时也要核对自身部署方职责。

具体范围依据[正式指南](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-transparency-obligations)；[最终行为准则](https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content)是自愿合规路径。标记方案须验证有效性、互通、稳健性与可靠性，不能仅写入 `AI=true` 元数据就通过验收。

若采用 [C2PA](https://spec.c2pa.org/specifications/specifications/2.3/specs/C2PA_Specification.html)，核验声明、签名、完整性与检测结果，并实测转码、裁切和发布平台处理后的表现。隐藏元数据不能代替必要的观众披露，也不承诺转码后标记必然保留。输出证据见 14，真实文件验收见 06；适用市场的功能须在验收后开放。

### 3.3 隐私与数据处理依据

适用 GDPR 时，按实际处理目的和方式判断控制者/处理者角色，落实[处理协议、分包和删除/返还责任](https://www.edpb.europa.eu/sme/learn-the-basics/data-controller-or-data-processor_en)。向 EEA 外传输时核实[适用跨境保障](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/rules-international-data-transfers_en)，不能以用户勾选或使用云服务代替。数据流与保留规则见 04；具体主体、合同和机制须在上线前确认。

### 3.4 Waffo 内容审核要求

按 [Waffo AIGC 要求](https://docs.waffo.ai/zh/mor/account-reviews/aigc-compliance)，内容规则集中在 [Terms 第 8–9 节](../../content/pages/en/terms.md#8-acceptable-use)，模型在第 3 节披露，AI 数据处理在 Privacy 第 6 节披露。禁止的深度伪造功能不会因人物同意或添加 AI 标签而获准；真实、获授权的人物素材仍按素材准入规则处理。

**提交 Waffo AIGC 审核或开放客户生成前，必须已运行生成前输入审核和展示前输出审核。** 公开展示客户作品时另加发布后检查。持续更新规则、保留必要审核记录，并提供可用的举报与申诉入口；访问和期限按 04 执行，公开条款须与实际能力一致。本仓库的输入审核参考适配不等于这两阶段已上线。

[Prompt Sift](https://docs.waffo.ai/zh/api-reference/endpoints/content-safety/scan-prompt)是默认关闭的可选输入审核提供方，不覆盖输出。操作映射、原文组装、长度和失败处理统一见 [04](04-architecture-and-data.md#可选提示审核)及配置。启用前核实合同、费率、数据流和保留设置并更新 Privacy；内测免费及不保留提示原文的说明不扩展为永久免费或整个服务零保留。端点未定义异步复核查询/回调，不承诺限时完成或自动恢复生成。

## 4 技术核对入口

| 范围 | 官方来源 |
| --- | --- |
| Web | [React Router / Cloudflare](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/)、[shadcn React Router](https://ui.shadcn.com/docs/installation/react-router)、[Base UI](https://base-ui.com/react/overview/about) |
| 计算与隔离 | [Containers](https://developers.cloudflare.com/containers/)、[规格](https://developers.cloudflare.com/containers/platform/limits/)、[调度](https://developers.cloudflare.com/containers/configuration/scheduling-policy/)、[沙箱](https://developers.cloudflare.com/sandbox/concepts/security/)、[出网](https://developers.cloudflare.com/containers/configuration/outbound-traffic/) |
| 状态与文件 | [Queues](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)、[D1](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[R2 签名 URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) |
| 工具、支付与身份 | [08 工具链](08-codex-execution.md#3-代码责任与可复现工具链)、[05 支付](05-waffo-billing.md)、[12 认证](12-routing-and-auth.md)维护各自依据 |
| 排版 | [i18next](https://www.i18next.com/translation-function/plurals)、[SSR](https://react.i18next.com/latest/ssr)、[W3C 文本方向](https://www.w3.org/International/questions/qa-html-dir)、[Unicode 断行](https://www.unicode.org/reports/tr14/)、[文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |
| 发布平台 | [平台配置](../../config/platform-presets.json)中的来源与适用上传入口；AI 披露和广告规则另按实际发布入口核验 |

链接用于实施时核对，不表示供应商、账户或兼容性已经验证；实际能力见[实施状态](../implementation-status.md)。

## 5 首发待确认事项

经营主体、首发市场、实际 MoR、供应商、数据流和公开政策按[发布前事实清单](../../content/pages/README.md#6-发布前待确认与核验)补齐。素材许可、适用的标记/披露和外部服务按 [06](06-testing-and-release.md) 完成验收。外部条件不足时继续无关开发，但不将未验证功能标为可上线。
