# 当前决策与外部依据

只维护当前有效的产品决定、技术依据和未验证条件；不作为逐次修改日记。外部链接是实施时的核对入口，不代表在本次文档清理中重新完成供应商、域名或实际账户验证。

## 1 决策归属

| 事项 | 当前决定与唯一细则 |
| --- | --- |
| 用户与品牌 | PromoBento / promobento.com；软件和课程数字产品两组同时首发，01 |
| 交付规格 | 仅 15/30 秒、30 fps；六平台、七个合法目标、四构图，03/config |
| 创作能力 | 自由源码、镜头数/风格/算法不设模板白名单；方法见 13 |
| 业务运行 | React/TypeScript、Cloudflare、mise/pnpm；04、08、依赖策略 |
| 付款 | Waffo 一次性 $39/$12 项目权益；同项目 contentHash 去重，05/14 |
| 登录 | Google + 邮箱验证码、显式关联、可撤销会话，12/config |
| 语言与 UI | 网站 en、视频任意混排；System/Light/Dark；杂志排版/专业工具配色，10/11/tokens |
| 版本与安全 | project_revisions 唯一，全部来源先冻结再编码；沙箱/权限/预算/事实/状态按 14 |
| 范围与验证 | 当前未实现的输入和能力不宣传；配置实施状态与 implementation-status 为依据 |

不得以局部示例、外部工具习惯或陈述中的“建议”覆盖已确定的时长、平台、价格、认证或创作自由。

## 2 视频创作上游与许可

研究与适配基准：[huashu-motion 固定提交 5f2608c2e12abcf518f74dde86093b19f7f88603](https://github.com/alchaincyf/huashu-motion/tree/5f2608c2e12abcf518f74dde86093b19f7f88603)。这是当前采用来源标识，不随 main 移动；尚未导入代码的能力不得标 PORT 已完成。

| 来源路径 | 使用目的 |
| --- | --- |
| skills/huashu-motion/SKILL.md | 一主 Agent 制作与改稿流程 |
| references/director.md、rhythm.md、colour.md、library/ | 产品理解、节奏、色彩、运动语言检索；均相对该 skill 路径 |
| references/product-demo-continuity.md | 产品真实操作与焦点连续性 |
| references/experience.md、verification.md、visual-direction.md、craft.md、talking-head.md | 上游实测坑、独立冷审、画面与课程讲师视频；先筛适用性而非全部设为 P0 |
| references/grammars.md、formats.md、product-fit.md | 参数化画面语言、构图与受众证据边界；课程案例必须由本项目实测 |
| runtime/clip/**（排除作者 toon 形象）、runtime/camera-rig.js、cli/lib/frames.js、render-om.js、beats.js、swatch.js | Canvas grammar、绝对时间相机、按 PTS 抽帧、子帧性能、节奏/配色诊断；许可审核后逐文件选择 |
| cli/lib/check.js、qa.js | 源码/帧/视频诊断参考，不照搬阈值作风格禁令 |
| cli/lib/score.js、sound.js、composer.js、dsp.js | ABC、合成器、音效与混音的候选适配来源 |
| studio/studio.js、cli/lib/inbox.js | 点选与源码定位；云端状态/授权需重新实现 |
| runtime/om-engine.js、cli/lib/learn.js | 寻帧运行和用户可控经验的方法参考 |

PORT 仅用于审核后的可移植自有逻辑，保留来源、许可、修改和差异测试；ADAPT 改写本地 CLI/文件/浏览器路径；REBUILD 覆盖多租户、云作业、账务、资源代理和安全边界；SKIP 表示不采用或不允许的第三方部分。正式采用时记录实际文件和测试，不用整包 vendor 代替审核。

[上游第三方清单](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/THIRD_PARTY.md) 与 [GSAP 许可](https://gsap.com/community/standard-license/) 分别核对。**生产默认 GSAP-free 的按绝对时间采样运行时**，避免把特定本地 CLI/可视化构建许可作为 SaaS 的必需运行依赖；GSAP 可在受隔离的本地研究中做作品质量基线，不打包、托管或交付其运行库。若未来要在生产使用 GSAP，须先取得适用于 PromoBento 产品形态的书面许可结论并经过架构重新评审，不因 AI 生成代码本身被允许就推断可视化编辑服务也获允许。作者角色、演示媒体、字体和音色采样逐项授权。MIT 仓库声明不能覆盖所有附带材料。导出作品的归属要求必须能履行，工程 ZIP 更需重新分发权限。

## 3 实施核对入口

| 范围 | 官方来源 |
| --- | --- |
| Web | [React Router / Cloudflare](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/)、[shadcn React Router](https://ui.shadcn.com/docs/installation/react-router)、[Base UI](https://base-ui.com/react/overview/about) |
| 云计算 | [Containers](https://developers.cloudflare.com/containers/)、[规格](https://developers.cloudflare.com/containers/platform/limits/)、[调度](https://developers.cloudflare.com/containers/configuration/scheduling-policy/)、[沙箱安全](https://developers.cloudflare.com/sandbox/concepts/security/)、[出网](https://developers.cloudflare.com/containers/configuration/outbound-traffic/) |
| 状态与文件 | [Queues 交付保证](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)、[D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[R2 签名 URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) |
| 工具 | [mise](https://mise.jdx.dev/configuration.html)、[pnpm 锁文件](https://pnpm.io/cli/install) |
| 支付 | [Waffo API](https://docs.waffo.ai/api-reference/introduction)、[Webhook](https://docs.waffo.ai/api-reference/webhooks)、[退款](https://docs.waffo.ai/api-reference/endpoints/refunds/create-refund-ticket)、[费用](https://docs.waffo.ai/mor/fees)；细节见 05 |
| 身份与邮件 | [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect)、[Email Service](https://developers.cloudflare.com/email-service/)、[发送 API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)；细节见 12 |
| 排版与主题 | [i18next](https://www.i18next.com/translation-function/plurals)、[SSR](https://react.i18next.com/latest/ssr)、[W3C 文本方向](https://www.w3.org/International/questions/qa-html-dir)、[Unicode 断行](https://www.unicode.org/reports/tr14/)、[文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |
| 平台 | 每个预设的来源、适用入口与核验状态由 config/platform-presets.json 保存，API 资料不能冒充所有手动发布规则 |

## 4 未验证条件与风险处理

域名控制权、DNS/TLS、支持邮箱、商户审核/商品/密钥、邮件域和实际额度、Cloudflare 目标运行、模型质量成本、平台真实上传均需实测；缺外部条件可继续不受影响的开发，不能伪造生产成功。

重点风险为自由代码隔离、同内容计费、全部目标准备成本、复杂帧复现、事实覆盖、队列/退款竞态、模型输出不稳定和实际作品是否愿意发布。按 06、08、14 的门槛处理；规格没有赋予性能、利润、推荐流量或商业真实性保证。
