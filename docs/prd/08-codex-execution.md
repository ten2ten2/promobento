# Codex 实施说明

## 1 交付目标

按本文档组实现可部署的 PromoBento P0，主域为 promobento.com。小型软件产品团队与课程数字产品内容团队同时完成首批闭环；平台预设全部进入第一版。使用 React、TypeScript、mise、Cloudflare 全栈和 Waffo.ai；建立多语言架构但首发仅英语，完整支持 System / Light / Dark。

当前交付是需求文档和契约示例，不包含已经完成的 SaaS 或生产部署。实施者应保留这个区别，后续用实际代码、样片、测试与部署记录更新进度。

## 2 实施顺序

| 阶段 | 实施内容 | 退出条件 |
| --- | --- | --- |
| M0 可行性闭环 | 官方 React Router Workers 工程；mise 精确锁版本；品牌/i18n/主题基础；D1/R2；单场景 Chromium/FFmpeg 容器；Waffo test checkout 与验签 | 在真实预发布 Cloudflare 成功生成一个 30 秒文件；Waffo 测试付款、回调及查询可核验；英语 SSR 与主题 Cookie/CSS 方案可运行 |
| M1 第一条用户流程 | Google 登录、工作区、上传、事实确认、共享模板、手动编辑、四构图浏览器预览；英文资源与两套 UI tokens | 软件与课程用户各能完成英语个人预览，Light/Dark 均可用，AI 故障可手填 |
| M2 付费与交付 | 项目包、追加包、不可变快照、权益账本、Queues/DO、导出/封面/ZIP、失败恢复 | PAY 核心测试通过，关闭浏览器仍交付，所有平台可下载 |
| M3 团队与运营 | 成员链接、冲突、评论、审阅、期限清理、后台、退款、来源埋点、两类用途页 | P0 权限与删除测试通过，漏斗可按人群和渠道查看 |
| M4 上线验收 | 样片、四构图矩阵、性能费用、平台实际上传、真实支付与退款、生产配置 | 有完整证据，未完成的外部验证明确标记，满足生产发布门槛 |

M0 先解决视频渲染和 Waffo 集成的真实风险，再扩编辑器范围。各阶段不是承诺固定工期；以退出条件推进。两类人群在 M1 就共同覆盖，不能把内容团队排到所有功能做完以后。

## 3 建议代码目录（应用实施时建立）

| 路径 | 内容 |
| --- | --- |
| `apps/web` | React Router SSR 页面与编辑器 |
| `apps/api` | 业务路由、鉴权、项目、支付和素材授权 Worker，可与 web 共入口但保持模块边界 |
| `apps/jobs` | Queues consumer、DO、Cron 与 outbox dispatcher |
| `apps/renderer` | Container Dockerfile、Chromium、FFmpeg、job agent 与健康检查 |
| `packages/contracts` | zod 或同类 schema、业务类型、错误码、API 契约 |
| `packages/scene-renderer` | 共享场景、纯时间函数、布局与预览播放器 |
| `packages/platform-presets` | 版本化平台配置及外部规则元数据 |
| `packages/billing` | 仅 Waffo 的 adapter、金额转换、订单与事件映射 |
| `packages/db` | D1 SQL、迁移、条件写与查询封装 |
| `packages/ui` | 表单和编辑器基础组件 |
| `packages/i18n` | 请求级 i18next、英语消息目录、locale allowlist、Intl 与消息类型 |
| `packages/brand` | PromoBento 名称、可信环境 URL、站点元数据和支持配置 |
| `packages/ui/theme` | Light/Dark CSS tokens、System 偏好、Cookie 与可访问主题控件 |
| `tests/fixtures` | 已授权测试素材与预期事实 |
| `tests/integration` | 支付、额度、队列、删除、隔离与恢复 |
| `tests/e2e` | 两类用户的浏览器闭环 |
| `docs` | 本文档组、实施决策与验证结果 |

不创建冗余后端语言或独立数据库服务。渲染与 Web 通过契约共享，不能各复制一份模板后独立修改。

## 4 版本与依赖

mise 已确定为 Node/pnpm 的工具版本管理与项目任务入口，pnpm 负责包依赖。版本选择顺序为：目标部署平台支持与运行时能力 → 框架/SDK 兼容范围 → 范围内最新正式版 → 精确锁定 → 实际环境验证。详细要求见 [依赖版本与部署兼容策略](../dependency-policy.md)。

初始化或主动升级时重新核查官方发布与兼容要求；不能把当前环境已安装版本当作最新版本。采用较旧版本必须记录具体兼容限制、来源或复现结果，以及重新评估条件。普通安装复现固定版本，不自动升级依赖。

`.mise.toml`、package 配置和生成的锁文件保持一致；CI 冻结安装。Cloudflare Workers Builds 的工具版本与安装顺序需单独配置和核对，不能假定平台自动识别 mise。Worker 按 workerd、compatibility_date 和 API 能力验证；renderer 的 Node、Chromium、FFmpeg、系统库和字体在目标 Linux 镜像中锁定并实测。

M0 在真实平台分别证明构建、Worker 与 Container 可用，将版本、实际环境、结果和例外写入 `docs/implementation-decisions.md` 与验证记录。当前仓库工具检查通过不代表应用依赖组合已验证。

## 5 命令边界

### 5.1 当前仓库可运行的命令

在仓库根目录通过 `mise install` 安装固定工具，通过 `mise run install` 冻结安装包依赖，再执行 `mise run check:repo`，检查 PRD 文件、相对链接、配置种子与示例之间的引用。mise 是标准任务入口；底层 Node 脚本只用于定位工具环境问题。这项检查不覆盖应用类型检查、实际渲染、支付或部署。当前状态见 [实施进度](../implementation-status.md)。

### 5.2 M0–M4 必须实现的应用命令

| 命令 | 行为 |
| --- | --- |
| `mise run init` | 检查依赖、生成安全示例配置、初始化本地 D1 和测试素材索引 |
| `mise run dev` | 启动本地 Web/API 与开发绑定 |
| `mise run dev:renderer` | 本地容器渲染服务，挂载仅测试任务目录 |
| `mise run check` | 类型、静态检查、schema/config 校验和依赖许可检查 |
| `mise run test` | 核心单元与集成测试 |
| `mise run test:e2e` | 软件和课程两类流程 |
| `mise run test:render` | 固定素材关键帧、ffprobe 和四构图验收 |
| `mise run test:billing` | Waffo 签名、幂等、对账、额度、退款；模式明确 |
| `mise run check:i18n` | 稳定文案 key、插值、复数、英文首发 allowlist 与资源完整性 |
| `mise run test:appearance` | System/Light/Dark、SSR 首屏、Cookie、缓存隔离、关键页面与成片样式隔离 |
| `mise run build` | Web、Workers 和 renderer 镜像构建 |
| `mise run deploy:preview` | 部署到独立预发布环境 |
| `mise run smoke:preview` | 预发布资源、登录、素材、渲染、支付 test 连通性 |
| `mise run deploy:production` | 使用生产配置和发布门槛执行既定发布流程 |

上表是应用实施目标，当前文档仓库尚未提供这些应用命令；不要为填满命令表而创建返回成功的空脚本。

命令应失败可读，不输出密钥；缺少 Waffo 资料时明确哪些集成未运行，不能退回 fake 支付后仍标全部通过。

## 6 环境配置

品牌配置见 `config/brand.json`，正式 `brandName=PromoBento`、`appUrl=https://promobento.com`。目标预发布域为 `https://staging.promobento.com`；域名控制权就绪前可使用实际受控的 HTTPS 测试地址，并同步登记回调。所有 URL 从服务端可信环境配置生成，不能采用任意请求 Host 或前端传入的 origin。配置中的 pending 是当前交付状态，不能当作运行时安全凭据或伪造已完成结果。

| 用途 | 正式地址 |
| --- | --- |
| Google OAuth callback | `https://promobento.com/api/auth/google/callback` |
| Waffo successUrl | `https://promobento.com/app/billing/orders/{localOrderId}` |
| Waffo webhook | `https://promobento.com/api/payments/waffo/webhook` |
| 帮助与支持 | `https://promobento.com/help` |
| 政策 | `https://promobento.com/privacy`、`/terms`、`/refund-policy` |
| 规划支持邮箱 | `support@promobento.com`，公开 mailto 前实测收件 |

Google 同意页、允许来源和回调、Waffo 商店品牌、支持信息与域名验证需要实际配置。平台品牌与真实商户主体分别填写。生产与预发布使用 host-only Cookie，不能设 Domain=.promobento.com 共享账号会话。Access 例外只覆盖经过设计的机器回调路径，Waffo test webhook 仍须验签；完整登录和付款往返按 06 验收。

语言配置见 `config/localization.json`，英语资源种子见 `locales/en.json`，主题初值见 `config/theme-tokens.json`。实施时补齐全部真实界面资源；首发 allowlist 仅 en，视频语言与 uiLocale 分离。主题 Cookie、CSS、SSR 和缓存规则以 10 为准。

Worker bindings 包括 D1、R2、两条队列及 DLQ、DO、AI、可选 Analytics Engine。密钥包括 Google OAuth 客户端凭据、会话签名材料、Waffo 商户私钥与环境验证配置、服务间认证材料。生产 secrets 通过 Cloudflare secret 管理，不能放入前端变量、Docker 镜像或提交仓库。

Waffo 配置需有 mode、merchant ID、store ID、两个商品 ID、API 基址、验证公钥或受控 SDK 环境，以及 webhook 路径。test 与 production 在启动和健康检查时校验不混用。API 接收前端 SKU 标识，不接受任意 merchant、商品 ID 或金额。

## 7 默认决策与可配置项

不可因开发方便改变：PromoBento / promobento.com、两个首批人群、Waffo、Cloudflare、React、mise、六个平台预设、真实浏览器预览、按项目版本收费、失败与重复保护、私有素材、事实确认、多语言架构但英语首发、System / Light / Dark。

可配置但必须留记录：价格、AI 配额、素材处理预算、工作区人数、保留期、并发、模板默认值、模型 ID、平台推荐值与性能预算。变更不得追溯减少已购买的权益，订单保存购买时的政策快照。

P0 暂不实现的网址抓取、自动 TTS、自动字幕、平台自动发布不显示可点击的假入口。未来功能可在文档里列 P1；生产页面只承诺已可用能力。

## 8 核心契约要求

配置样例是实施输入，不是可直接部署的全部代码。Codex 需要根据 `contracts/scene.example.json` 建立完整 schema 和迁移，根据 `config/platform-presets.json` 生成类型与校验器，并根据 `contracts/export-manifest.example.json` 实现文件映射。品牌、locale、主题和英文资源种子也必须建立类型和校验；界面语言 uiLocale 与网站外观开关不影响订单身份或视频指纹，视频 language、direction 和 videoStyle 按内容版本规则冻结。

最低约束包括总帧连续无重叠、事实均已确认、素材属于当前租户、布局在允许范围内、所有四构图存在、封面时间有效、音轨长度合法、版本快照不可变、相同指纹可复用。带 `exampleOnly` 或 `fixture_placeholder` 的样例只用于契约和本地测试；生产 API 必须拒绝占位素材，不能把示例 hash 当成真实文件验证记录。

服务端回调测试必须使用原始请求字节与真实提供商规范；内部 `BillingAdapter` 方法是本产品接口，不能假设 Waffo SDK 拥有同名方法。协议调整时更新适配层和契约测试，避免散布到页面代码。

## 9 实施中必须先证明的事项

第一，Container 的真实 Linux 字体、视频解码、seek、截图和编码在目标规格可用。第二，Waffo SDK 或其官方 REST 认证在 workerd 可用，签名时间单位正确。第三，D1 额度和 outbox 的条件写可以通过实际并发与中断测试。第四，所有首发构图能够呈现两类素材而不切掉关键信息。

这些应在对应阶段用最小垂直切片解决。不能为了规避难点改变支付商、部署厂商，或把真实导出换成浏览器录屏下载而不说明。

## 10 完成报告格式

实施者交付时列出已实现功能、未实现 P0、已运行命令、真实环境、测试与样片证据、费用样本、故障与恢复路径、剩余账户资料及运行说明。若某项只在测试环境验证，应直接说明。

完整交付至少包含代码、锁文件、迁移、环境示例、构建与部署说明、必要自动化测试、样片、许可证清单、生产健康检查和运营操作指南。文档中“可用”必须对应可运行功能。
