# 来源与决策记录

## 1 用户明确决定

| 决定 | 本文处理 |
| --- | --- |
| 两类人群同时作为第一批 | 软件产品团队与课程数字产品内容团队并列，样片和验收分别覆盖 |
| 写 PRD，包含域名与实现功能 | 提供主需求、界面、格式、架构、支付、测试、实验及实施文档 |
| Waffo.ai 支付 | 唯一 P0 支付接入，没有 Stripe 实现分支 |
| mise、React 等技术 | 固定 React 与 TypeScript；mise 统一管理依赖 |
| Cloudflare 全家桶部署 | Web、数据库、文件、队列、容器、AI 和观测放在 Cloudflare |
| 各社交平台格式预设 | 六个默认平台位置，四种构图，统一配置和验收 |
| GPT 流量快速付费验证 | 真实推荐访问、素材激活、付款、交付分别计量 |
| 采用 PromoBento / promobento.com 并重新生成 PRD | 正式品牌与主域统一；域名取得和实际环境验证另留真实状态 |
| 支持多语言能力，但一开始只做英语 | 国际化架构 P0；界面和视频语言独立配置，首发只启用 en |
| 支持 Light / Dark Mode | System / Light / Dark 全站首发，浏览器持久化，与视频样式隔离 |

## 2 本版产品决策

| ID | 决定 | 理由与复核触发 |
| --- | --- | --- |
| D-01 | 正式品牌 PromoBento，主域 promobento.com | 用户已确定；上线前完成实际域名控制与外部回调配置 |
| D-02 | 15/30 秒、3 种结构、2 种样式 | 收敛首版质量与成本；真实订单需要更多时长再扩 |
| D-03 | 浏览器真实预览，付费后编码 | 让客户先看到自己的内容，同时控制免费计算成本 |
| D-04 | $39 含 3 个成片版本，$12 追加 3 个 | 可理解的单次购买；价格和成本需实际测试 |
| D-05 | 同一成片版本包含所有平台 | 用户购买交付结果；相同内容复用，避免按格式重复收费 |
| D-06 | 4 种布局在付款快照中固定 | 保证补平台仍来自已确认内容 |
| D-07 | 真实素材与事实确认 | 两类客户都需要产品内容准确且可改 |
| D-08 | SSR React Router 与 Cloudflare 服务 | 承接公开检索，同时满足编辑和异步交付 |
| D-09 | 不受限代码不进入生产渲染 | 固定组件更容易做确定性、隔离与质量验收 |
| D-10 | 自有时间函数，P0 不打包 GSAP | 消除当前产品形态下未解决的第三方使用边界 |
| D-11 | 免费 7 天，付费 90 天，加 7 天宽限 | 保存成本与用户修改周期平衡；追加包重置付费期限 |
| D-12 | 3 人工作区与乐观锁 | 支持小团队协作，避免实时协作引擎扩大首版 |
| D-13 | 输入网址只存背景和 CTA | 把 URL 抓取、截图授权、反爬和 SSRF 留到独立功能设计 |
| D-14 | 平台推荐与外部硬规则分开 | 避免 API、广告和自然上传规格混淆 |
| D-15 | i18next / react-i18next 与独立语言 allowlist；首发只开放 en | 预留多语言，完整交付英语；每种新语言独立验收后启用 |
| D-16 | System / Light / Dark，Cookie + CSS 原生首屏 | 持久化偏好并减少 SSR 首屏闪烁；有偏好 HTML 绕过共享缓存 |
| D-17 | 网站主题和界面语言不参与成片版本身份 | 保护已确认视频颜色与账务；视频 language / videoStyle 单独冻结 |
| D-18 | Waffo 新会话 language=en，并设置 darkMode | 使用真实提供方能力；既有活动 session 不因主题变化重建 |

## 3 官方来源

以下是公开资料与规格阅读记录，核查日期为 2026 年 10 月 18 日。来源用于说明依赖和外部约束；产品定价、配额、性能、转化及收入预测仍是本项目自己的待测假设。

| 编号 | 来源 | 支持事项 |
| --- | --- | --- |
| S01 | [huashu-motion](https://github.com/alchaincyf/huashu-motion) | 本地动效制作、导演与逐帧渲染参考 |
| S02 | [固定提交](https://github.com/alchaincyf/huashu-motion/commit/3e927801e78b587878fb7dbb65d616326df00c21) | 本轮参考基线 |
| S03 | [第三方清单](https://github.com/alchaincyf/huashu-motion/blob/3e927801e78b587878fb7dbb65d616326df00c21/THIRD_PARTY.md) | MIT、GSAP、字体和作者形象的不同边界 |
| S04 | [huashu-art-motion](https://github.com/alchaincyf/huashu-art-motion) | 参数化艺术与标注场景的可选来源 |
| S05 | [GSAP Standard License](https://gsap.com/community/standard-license/) | 商业使用与特定可视化建造工具限制需要区分 |
| S06 | [React Router on Cloudflare](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/) | SSR 与 Vite 官方支持路径 |
| S07 | [Cloudflare Containers](https://developers.cloudflare.com/containers/) | Workers Paid 上容器服务能力 |
| S08 | [Container 规格](https://developers.cloudflare.com/containers/platform/limits/) | 初始 standard-3 资源配置参考 |
| S09 | [Container 调度](https://developers.cloudflare.com/containers/configuration/scheduling-policy/) | default 与 public beta 策略区分 |
| S10 | [Container 出网](https://developers.cloudflare.com/containers/configuration/outbound-traffic/) | 公网访问及 allow/deny 的实际边界 |
| S11 | [Container FAQ](https://developers.cloudflare.com/containers/faq/) | 临时磁盘和实例中断处理 |
| S12 | [Queues 保证](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) | 至少一次投递与应用幂等 |
| S13 | [Queues 限制](https://developers.cloudflare.com/queues/platform/limits/) | 消费者运行预算 |
| S14 | [D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/) | 事务性 batch 与条件写设计依据 |
| S15 | [R2 授权 URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) | bearer URL 与不可变上传副本要求 |
| S16 | [Workers AI JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/) | 结构化生成仍须应用验证 |
| S17 | [mise 配置](https://mise.jdx.dev/configuration.html) | 工具版本和任务配置 |
| S18 | [Waffo Checkout](https://docs.waffo.ai/api-reference/endpoints/orders/create-checkout-session) | 商户创建会话、业务订单号、回跳行为 |
| S19 | [Waffo API](https://docs.waffo.ai/api-reference/introduction) | SDK、签名入口与显式幂等 |
| S20 | [Waffo Webhooks](https://docs.waffo.ai/api-reference/webhooks) | 一次性成功事件、签名、时间戳与去重 |
| S21 | [Waffo Orders and Payments](https://docs.waffo.ai/api-reference/endpoints/graphql/orders-and-payments) | 对账以及退款请求与执行记录区别 |
| S22 | [Waffo Refund Ticket](https://docs.waffo.ai/api-reference/endpoints/refunds/create-refund-ticket) | 退款申请和金额格式 |
| S23 | [Waffo Fees](https://docs.waffo.ai/mor/fees) | 成功、失败、退款和提款费口径 |
| S24 | [Waffo 域名验证](https://docs.waffo.ai/settings/domain-verification) | 商户正式接入依赖 |
| S25 | [Waffo AI 产品审核](https://docs.waffo.ai/mor/account-reviews/aigc-compliance) | 需如实说明实际 AI 能力与产品分类 |
| S26 | [TikTok Media Transfer Guide](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide) | API 路径格式参考，不能泛化为所有发布入口 |
| S27 | [Meta 官方 Reels 示例](https://github.com/fbsamples/reels_publishing_apis/blob/main/insta_reels_publishing_api_sample/README.md) | 保守编码组合和推荐竖版比例 |
| S28 | [Meta 视频与 Reels 公告](https://about.fb.com/news/2022/07/new-ways-to-create-instagram-reels-remix/) | 历史发布类型变动，不能据此推断当前全部上限 |
| S29 | [X 视频帮助](https://help.x.com/en/using-x/x-videos) | 普通账号时长和体积限制参考 |
| S30 | [YouTube 编码建议](https://support.google.com/youtube/answer/1722171?hl=en) | 横版和 H.264、MP4 等参数 |
| S31 | [YouTube Shorts](https://support.google.com/youtube/answer/15424877?hl=en) | 短竖版或方形视频分类 |
| S32 | [OpenAI Crawlers](https://developers.openai.com/api/docs/bots) | OAI-SearchBot 与 ChatGPT-User 区分 |
| S33 | [LaunchCut](https://www.launchcut.io/) | 相邻 URL 转视频与单次收费产品存在 |
| S34 | [Namecheap 域名查询入口](https://www.namecheap.com/domains/registration/results/?domain=promobento.com) | 本会话 2026-10-18 查询返回 promobento.com 可注册、购买报价 USD 11.28；不是已购买记录，也不代表续费报价，实际可用性及结算以购买时为准 |
| S35 | [i18next 复数](https://www.i18next.com/translation-function/plurals) | 数量文案的复数资源规则 |
| S36 | [i18next 插值](https://www.i18next.com/translation-function/interpolation) | 参数化消息与转义边界 |
| S37 | [react-i18next SSR](https://react.i18next.com/latest/ssr) | 请求上下文、初始语言与资源一致性 |
| S38 | [Intl](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl) | 数字、货币、日期等语言相关格式化 |
| S39 | [prefers-color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-color-scheme) | CSS 根据系统 Light/Dark 偏好呈现 |
| S40 | [React Router 状态管理](https://reactrouter.com/explanation/state-management) | Cookie 与 SSR，localStorage-only 的首屏限制 |
| S41 | [Cloudflare Origin Cache Control](https://developers.cloudflare.com/cache/concepts/cache-control/) | 个性化 HTML 需要实际缓存隔离，不能只依赖一般 Vary |
| S42 | [W3C 文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | 两套主题的文字可读性目标与例外 |
| S43 | [W3C 非文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) | 重要控件、状态图形与边界对比 |
| S44 | [Google 多语言站点](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites) | 真实语言页面、URL 与后续 hreflang |

## 4 外部资料与账户条件

| 项目 | 当前状态 | 谁在何时完成 |
| --- | --- | --- |
| promobento.com 域名 | 名称已确定；查询时可注册，购买报价 USD 11.28；未执行购买、未取得控制权验证 | 生产域启用前完成购买、DNS/TLS 与控制权验证；续费及实际结算另核 |
| support@promobento.com | 规划地址，未开通收件验证 | 公开 mailto 前完成；已有真实站内工单可作为支持入口 |
| Waffo 商户、商品与密钥 | 本文不含账户配置 | 商户负责人提供 test/prod，实施者验证环境隔离 |
| Waffo 生产审核、税费与结算 | 取决于实际商户 | 正式收款前按实际商品配置完成 |
| Cloudflare Paid、Containers 配额 | 文档能力已核查，用户账户未验证 | 实施 M0 在目标账户确认 |
| Linux 容器渲染速度与成本 | 未实测 | 实施 M0 和 M4 留实际样片及账单 |
| 字体、音乐、Logo、演示素材 | 每份需许可记录 | 首批公开样片和生产模板发布前完成 |
| Instagram 当前主帮助/API | 本轮部分页面受访问限制 | 平台预设标推荐值，上线前实际上传复核 |
| 六个平台测试上传 | 本轮未执行 | 使用有权账号记录测试结果 |
| 所有价格与需求假设 | 未获得该产品的真实订单验证 | 按两个首批人群的实验分别验证 |
| 英语 UI 与 Light/Dark 实现 | 已完成规格和资源种子；未实施浏览器产品 | M0/M1 建立基础，M4 按 10 提供实际首屏、缓存与交互证据 |
| 其他语言上线 | 未启用 | 之后逐项完成 UI 或视频语言验收再开启对应 allowlist |

这些条件不意味着现在需要用户逐项批准 PRD。开发可以完成所有不依赖账户的实现和测试，剩余资料在相应集成与生产门槛解决；不得虚构凭据、购买域名或伪称已经上线。

## 5 已识别的主要风险

| 风险 | 处理决定 | 观察信号 |
| --- | --- | --- |
| 与已有 URL 转视频产品重叠 | 以真实素材控制、可修改与多平台任务交付验证价值 | 预览到付款、替代工具反馈 |
| 多构图渲染成本超预期 | 共享快照与文件、每 job 有界、真实压测 | 每成片版本成本和排队时长 |
| 免费上传与 AI 被滥用 | 账号累计配额、不可重置试做、后端限流与预算 | 成功激活对成本比、异常重试 |
| 付款成功但权益或任务丢失 | 原子账务、inbox/outbox、幂等、对账与恢复 | 未交付 paid 订单和账本差异 |
| 用户修改导致所见与所收不一致 | 不可变素材及四构图支付快照 | 版本引用、hash 与关键帧对比 |
| 开源许可或素材混用 | 选择性移植 MIT、去除非授权形象、P0 自有动画 | 依赖与素材清单 |
| GPT 引荐不足 | 同时用合格直接招募测付费，区分来源 | 真正陌生引荐与实际订单 |
| 平台规则变化 | 配置版本、来源日期、实际上传验证 | 上传失败原因和官方更新 |
| 深色首屏闪烁或用户缓存串用 | SSR Cookie、CSS System 解析、个性化 HTML 绕过共享缓存 | 慢网首屏录像、两个浏览器的响应及缓存行为 |
| 界面主题污染成片或导致重复结账 | 视频样式/指纹独立；外观不重建 Waffo 活动会话 | 同快照关键帧、额度、session ID 与幂等请求体 |

## 6 本版交付边界

文件完整描述 P0 产品与实施验收，并提供结构化例子。它没有包含已购买域名、代码实现、真实交易、外发消息或生产发布。后续实施必须以实际结果更新文档状态。

1.1 修订包括正式品牌与主域、多语言架构但英语首发、Light/Dark/System 及关联配置和验收。价格、首批人群、六个平台位置、Cloudflare 与 Waffo、素材与账务保障继续按各专章执行。
