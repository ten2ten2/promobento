# 素材许可、合规与来源

主要来源查证于 2026-10-20，后续核对日期在对应段落注明。本章集中维护素材准入、上游许可和法务依据，不重复产品目录或实施进度。成片使用权与退款以 [05](05-waffo-billing.md) 为准，隐私与删除见 [04](04-architecture-and-data.md)，广告表达见 [13](13-agent-native-production.md)，机器字段及可信校验见 [14](14-production-contracts.md)。来源可查不代表材料已获准用于生产或服务已经实现。

## 1 素材准入与证据

从首次实际处理或使用前核验权利，包含模型输入、转写和免费预览；不等到付款冻结才检查。每个实际资源、字体、音轨及音效事件都关联来源、许可依据和适用范围，具体清单结构由14定义。授权不明、范围不符或必要义务无法履行时 BLOCK，客户确认或 Agent 自报不能豁免已知限制。

| 来源类别 | 准入依据 |
| --- | --- |
| 平台提供的代码、字体、音源和素材 | 经审核白名单中的确切文件/版本；许可允许实际云处理、嵌入及交付方式，平台默认选材支持05的商用范围且无需成片内署名 |
| 用户上传的自有或获许可内容 | 用户权利声明，或可核对的第三方许可/委托授权；记录云处理、改编、商业发布及必要肖像/声音同意。存在明显风险或限制时补充依据，不能靠“用户负责”直接放行 |
| 模型或程序生成内容 | 记录生成来源、实际模型/工具与条款版本，并核对输入、采样和背景组件的权利；“生成”不自动证明平台所有或无第三方权利 |

用户素材不要求出现在平台通用素材白名单，但也不能因上传成功免除其原许可。若存在渠道、期限或署名限制，须明确展示并校验选定用途；无法履行时替换或补充授权。支付、裁切、转码和混音不消除限制。“无需署名 PromoBento”不等于可以删除任何第三方署名。

P0 品牌字体仅从已审核的平台字库选择并冻结确切文件及回退关系；未审核的客户字体不接收为渲染资源。客户字体上传属于 P1，需另外核实云端处理、服务器渲染及必要嵌入许可，不能用本地桌面许可作通用替代。PDF 授权文件仅作受限证据，不加入可绘素材。

| 材料 | 审核边界及一手依据 |
| --- | --- |
| OFL 字体 | 视频中渲染文字不要求作品采用 OFL 或署名字体作者；分发/修改字体文件仍履行通知、许可和保留名称等条件。逐款核对真实字节和授权，不能因本机有系统字体就推定可拷入云容器：[OFL FAQ](https://openfontlicense.org/ofl-faq/) |
| 采样、配乐和音效 | 平台 P0 选 CC0 或覆盖用途且无需成片内署名的明确商业许可；CC-BY 不等于禁止商用，但其署名等义务必须能履行。许可受限采样不进入默认音源包：[CC0](https://creativecommons.org/publicdomain/zero/1.0/)、[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| 开源代码与附带作品 | 仓库 MIT 不覆盖作者肖像、另行许可字体/模型/采样；保留实际代码需要的版权与许可通知。演示谱、动画形象及示范媒体独立核验，不能从扩展名或“程序生成”推定可用 |
| 用户音乐与真人素材 | 核对所需音乐作品/录音、肖像/声音及宣传授权；提示发布平台可能识别或限制，不能把提示当许可。用户授权只覆盖约定范围，不替其保证无争议 |

许可记录保存原文/版本、来源、核对日期及适用资源的可验证对应；已购快照冻结当时依据，后续发现问题走调查与修复，不篡改既有证明。客户私人授权材料按04隔离和保留，不放入公共许可列表。成片可用权、代码再分发权和工程源码交付权分别判断；依赖锁定及构建执行要求见[08工具链](08-codex-execution.md#3-代码责任与可复现工具链)。

## 2 视频创作上游

研究与适配基准固定为 [huashu-motion@5f2608c2e12abcf518f74dde86093b19f7f88603](https://github.com/alchaincyf/huashu-motion/tree/5f2608c2e12abcf518f74dde86093b19f7f88603)，不随 main 移动。下表是候选来源，不是已导入清单；正式采用时逐文件记录 PORT（可直接移植）/ADAPT（运行方式适配）/REBUILD（重建）、实际路径、commit、许可、修改及验证结果。

| 来源路径 | 使用目的 |
| --- | --- |
| skills/huashu-motion/SKILL.md；该目录下 references/director.md、rhythm.md、colour.md、library/、visual-direction.md | 主 Agent、导演、节奏、色彩和运动语言参考 |
| references/product-demo-continuity.md、experience.md、verification.md、craft.md、talking-head.md、grammars.md、formats.md、product-fit.md | 连续性、冷审、课程讲师视频和受众适配；均相对该 skill 路径，实际课程效果须本项目验证 |
| runtime/clip/**、runtime/camera-rig.js、runtime/om-engine.js、cli/lib/frames.js、render-om.js、beats.js、swatch.js | 排除作者 toon 形象后逐文件审核；Canvas grammar、绝对时间相机、寻帧及视听诊断参考 |
| cli/lib/check.js、qa.js、score.js、sound.js、composer.js、dsp.js | 源码/帧检查及确定性声音实现；独立审核乐谱、采样和依赖，不整包复制 |
| studio/studio.js、cli/lib/inbox.js、learn.js | 点选、源码定位和用户可控经验参考；云状态、权限和多租户由本产品实现 |

[上游第三方清单](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/THIRD_PARTY.md)明确作者“豆子花叔”形象不在 MIT 授权内，P0 排除其源码形象及出现该形象的演示素材；字体、模型、音源按各自许可审核。清单未提及的材料也不推定许可完整。

**生产默认 GSAP-free 的绝对时间采样运行时。** [GSAP 标准许可](https://gsap.com/community/standard-license/)允许商用及 AI 生成代码，但对与 Webflow 竞争的可视化动画构建用途设限制；前者不能推出 PromoBento 整个产品获准。仅在符合许可的隔离本地研究中使用质量基线，不打包、托管或交付 GSAP 运行库。任何生产引入须先取得适用产品形态的书面许可结论并重新评审架构；不是仅检查成片是否带署名。

## 3 适用规则与产品边界

### 3.1 版权、广告与侵权处理

[美国版权局 AI 报告 Part 2](https://www.copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-2-Copyrightability-Report.pdf)要求逐案判断人类原创表达：纯 AI 生成部分不受美国版权保护，人类可感知表达、创造性编排或修改可能受保护。程序渲染或 Agent 参与本身不决定整个成片的版权；也不据此认定所有上传 logo、录屏或音轨均归用户。05仅处分平台实际可授予的权利；采用转让时还须符合[适用的转让形式要求](https://www.copyright.gov/title17/92chap2.html)，不把美国规则宣称为全球结论。

美国 [FTC 消费者评价规则](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers)自 2024-10-21 生效，虚构评价和虚假使用经历不能通过“AI 生成”免责；参与制作的机构也非当然免责。真实个案不自动证明一般效果，收益/成绩等还须考虑[典型结果与关联关系披露](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)。13规定禁止虚构和事实依据，14验证来源与表达一致性；用户确认和自动 QA 不构成平台的真实性担保证书。

如依赖美国用户内容托管的 [DMCA §512 安全港](https://www.copyright.gov/512/)，须完成指定代理登记及公开联系、有效通知/反通知、及时处置和合理实施的重复侵权政策；反通知后按法定 10–14 个工作日及诉讼例外处理恢复。投诉邮箱不能单独替代该流程，安全港也不自动覆盖平台自行制作的侵权。侵权处置应标明具体内容、通知用户并保留必要记录，不无差别清空无关项目。

### 3.2 欧盟 AI 透明度

[欧盟官方 AI Act 页面](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)确认 Digital Omnibus on AI（Regulation (EU) 2026/1744）于 **2026-07-27** 生效。[官方执行日期说明](https://ai-act-service-desk.ec.europa.eu/en/ai-act/faq/when-does-enforcement-start)明确第50条透明度义务自 **2026-08-02** 适用；仅在此前已投放市场的相关系统可延至 **2026-12-02** 遵守50(2)。上述日期于 2026-10-21 核对。PromoBento 尚无此前已投放的证明，不能按旧系统宽限规划新系统上线。

按实际市场、系统功能和角色确定适用性：[第50(2)条](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50)的提供方机器可读标记与可检测义务，和50(4)条部署方的深度合成披露分开处理；使用上游模型不能直接转移自身适用义务。普通动态图形或通用 TTS 不因使用 AI 就自动成为 deepfake；应按是否仿真既有人物、物体、地点、实体或事件并误导真实性判断，其他机器标记义务可能仍适用。公开发布自身案例时，平台也须核对其部署方职责。

适用解释采用[正式指南](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-transparency-obligations)及[最终行为准则](https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content)。准则是自愿合规路径，法律义务不因未签署而消失。生产采用的方案须验证有效性、互通、稳健性与可靠性，并明确内容类型和技术限制；仅在 MP4 写一个 AI=true 标签不算完成验收。

[C2PA](https://spec.c2pa.org/specifications/specifications/2.3/specs/C2PA_Specification.html)可作为方案组成部分；若采用，应验证声明范围、签名/完整性和检测结果，并实测转码、裁切及目标平台处理后的保留/识别能力。必要的面向受众披露不能由隐藏元数据替代，也不承诺平台转码后标记必然保留。14保存输出与标记证据的关联，06负责真实文件验收；面向适用市场的能力在验收通过前不得开放。

### 3.3 隐私与数据处理依据

适用 GDPR 时，角色按实际处理目的与方式判断；[EDPB 控制者/处理者指南](https://www.edpb.europa.eu/sme/learn-the-basics/data-controller-or-data-processor_en)说明处理协议、分包授权/异议、协助请求及服务结束后的删除/返还责任。向 EEA 以外传输时，须按[委员会跨境机制说明](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/rules-international-data-transfers_en)核实适用保障，不以使用云服务或用户勾选代替。04据此定义本产品的数据流、隔离和保留要求；实际主体、合同与传输机制仍须上线前确认。

### 3.4 Waffo 内容审核要求

[Waffo AIGC 要求](https://docs.waffo.ai/zh/mor/account-reviews/aigc-compliance)允许在独立 AUP 或 Terms 专章公布内容规则。本产品采用 [Terms 第8–9节](../../content/pages/en/terms.md#8-acceptable-use)，集中列出禁止类别、审核、举报和申诉；实际模型在第3节披露，数据处理在 Privacy 第6节披露。深度伪造功能不因人物同意或添加 AI 标签而获准，真实且有权使用的人物素材仍按素材准入规则处理。

上线前验证输入生成前、输出展示前的审核；公开展示客户作品时增加发布后检查。拦截规则持续更新，自动审核和人工决定保留必要记录，期限与访问按04执行。披露的模型、举报入口和处置能力须与实际服务一致；公开条款本身不证明审核已接通。

[Prompt Sift 端点](https://docs.waffo.ai/zh/api-reference/endpoints/content-safety/scan-prompt)是可选的生成前提示审核，本产品默认关闭，启用条件与失败处理见 [04](04-architecture-and-data.md#可选提示审核)。它不能替代输出展示前审核。2026-10-21 核对时，官方说明 beta 免费、每商户每路径 60 秒内 100 次，且响应后不保留提示原文；这些范围不构成永久免费、SLA 或整个服务零保留承诺。端点未给出异步结果查询或回调流程，不承诺 review 在一小时内完成或自动恢复生成。实际启用前确认合同、数据流与保留设置，并补齐 Privacy 中的提供方披露。

## 4 技术核对入口

| 范围 | 官方来源与细则 |
| --- | --- |
| Web | [React Router / Cloudflare](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/)、[shadcn React Router](https://ui.shadcn.com/docs/installation/react-router)、[Base UI](https://base-ui.com/react/overview/about)；架构见04 |
| 云计算与隔离 | [Containers](https://developers.cloudflare.com/containers/)、[规格](https://developers.cloudflare.com/containers/platform/limits/)、[调度](https://developers.cloudflare.com/containers/configuration/scheduling-policy/)、[沙箱](https://developers.cloudflare.com/sandbox/concepts/security/)、[出网](https://developers.cloudflare.com/containers/configuration/outbound-traffic/) |
| 状态与文件 | [Queues](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)、[D1](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[R2签名URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)；事务和权限见04/14 |
| 工具、支付与身份 | [08工具链](08-codex-execution.md#3-代码责任与可复现工具链)、[05提供方适配](05-waffo-billing.md)、[12认证](12-routing-and-auth.md)各自维护所用官方依据 |
| 排版 | [i18next](https://www.i18next.com/translation-function/plurals)、[SSR](https://react.i18next.com/latest/ssr)、[W3C文本方向](https://www.w3.org/International/questions/qa-html-dir)、[Unicode断行](https://www.unicode.org/reports/tr14/)、[文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |
| 发布平台 | 来源和适用上传入口见[平台配置](../../config/platform-presets.json)；AI披露与广告规则须在真实目标平台核对，不以API文档代替所有发布规则 |

技术链接是实施核对入口，不表示本轮重新验证全部供应商、账户或兼容性；真实实施顺序和完成情况只在08与[实施进度](../implementation-status.md)维护。

## 5 首发待确认事项

- 明确经营主体、首发市场与实际客户身份，补齐[页面草稿及待确认事实](../../content/pages/README.md#6-发布前待确认与核验)，完成对应服务条款、隐私政策、支持/投诉入口；适用法律、争议处理、年龄限制和不能排除的责任须落实，不能以品牌名代替真实主体。
- 按04落实真实数据流、供应商角色、处理协议和跨境机制；按05确认 MoR 合同、销售方、退款和超窗救济。公开政策只能承诺已核实可执行的处理方式。
- 对实际采用素材完成许可审核；若适用欧盟透明度要求，确定系统角色并完成标记/披露验收。域名、账户、云隔离、真实收款及平台发布证据仍按06/08验收，缺外部条件不阻断无关开发，也不标记生产通过。
