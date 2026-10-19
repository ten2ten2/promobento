# URI、登录与账号

版本：1.0。更新日期：2026-10-20，Asia/Shanghai。用户要求补齐 URI，并在 Google 登录之外提供邮件登录。本章确定 P0 的路由和认证契约；当前仓库仍是规格、配置种子与离线参考，尚未实现线上登录或发送邮件。

## 1 范围与权威来源

P0 提供 **Google 登录和邮箱验证码登录**。登录与注册共用入口，新身份验证后才建立账号；没有密码、忘记密码、登录 magic link 或网站语言选择前置步骤。邮箱验证码是登录方式，不宣称为多因素认证。两种方式可通过显式验证关联到同一个内部账号，工作区、项目和订单继续使用稳定的 `user_id`。

| 内容 | 唯一维护位置 |
| --- | --- |
| URI、HTTP 方法、路由身份要求、索引分类、默认跳转 | [config/routes.json](../../config/routes.json)；是实施种子，不是已部署的路由表 |
| 页面用途与任务流程 | [02](02-ux-and-flows.md) |
| 业务 API 输入、数据关系 | [04](04-architecture-and-data.md) |
| 认证策略、默认数值和邮件环境配置 | 本章与 [config/auth.json](../../config/auth.json)；数值以配置为准 |
| 登录布局、组件和英文消息 | [11](11-ui-design-spec.md)、[locales/en.json](../../locales/en.json) |
| 网站语言、主题 Cookie 和缓存 | [10](10-i18n-and-themes.md) |

路由种子中的 `auth` 是最低入口要求，不代替服务端资源范围、Owner、CSRF 或签名检查。品牌配置中的既有 `paths` 是由 `routeIds` 指向路由后的外部配置展示值，检查器核对它们，不另外定义路线；Waffo 的模板参数映射到真实 order ID。所有路由均处于待应用实施状态；不能只加载此 JSON 就宣称鉴权已经完成。

## 2 URI 约定与入口

正式 origin 为 `https://promobento.com`，预发布为 `https://staging.promobento.com`。网页与 API 同源；API 统一 `/api`，首版不复制 `/api/v1`。路径采用小写名词和短横线，根路径以外不带尾斜线。参数使用 `:projectId`、`:orderId` 等语义名称；这是模板占位名，不改变实际 UUID 等资源 ID，也不改变 Waffo 的 `{localOrderId}` 回跳含义。

| 场景 | 固定入口与规则 |
| --- | --- |
| 开始制作 | `/create`；先选任务、时长和平台，上传或生成前登录 |
| 登录或注册 | `/login`；Google 和邮箱验证码同页 |
| 输入邮件验证码 | `/login/verify`；邮箱、challenge 和返回目标由当前浏览器的服务端 flow 恢复 |
| 注册或关联确认 | `/login/link`；必须有有效且已验证身份的 pending flow，无 flow 时回登录页 |
| 默认应用入口 | `/app` → `/app/projects`，302、private/no-store，先验会话 |
| 默认设置入口 | `/app/settings` → `/app/settings/account`，302、private/no-store |
| 个人设置 | `/app/settings/account`、`/app/settings/appearance` |
| 工作区设置 | `/app/settings/brand`、`/app/settings/members` |
| 订单 | `/app/billing/orders` 和 `/app/billing/orders/:orderId`，当前工作区 Owner 可访问 |
| 成员邀请 | `/invite/:token`；GET 仅展示邀请，登录后明确点击 Join workspace 才加入 |
| 分享审阅 | `/review/:token`；限定一个版本的只读预览，与成员项目 API 隔离 |
| 支持 | `/help`；设置里的 Support 链接此页，不另建重复页面 |
| 搜索发现 | `/robots.txt`、`/sitemap.xml`；`/llms.txt` 为 P1，不注册空页面 |

首次 GET `/login` 创建或恢复服务端 auth flow，设置 host-only flow Cookie，并输出绑定该 flow 的 CSRF token；这只建立临时登录上下文，不建账号、不发验证码。合法的 pending flow 可继续使用；已绑定账号的 flow 只在对应的原会话下恢复，不能泄露或覆盖另一个用户的有效会话，账号不匹配时需取消或重新开始。`GET /api/auth/session` 的匿名响应只返回 `authenticated=false`，不顺带初始化登录 flow。

`/login/verify` 没有本浏览器可用的 challenge，或 `/login/link` 没有有效 pending proof 时，HTML 返回 302 到 `/login`，以受控 flash code 提示重新开始，不在 URL 暴露邮箱或认证详情；对应 API 仍按 flow 状态返回 409 结构化错误。

每个新账号原子建立一个默认工作区；接受其他团队邀请后可以在合法成员工作区之间切换，不增加工作区购买或多客户管理产品。项目列表、Brand、Members、订单列表用 `workspaceId` query 标示正在查看的工作区。省略时由服务端选择仍有成员资格的最近工作区或默认工作区，再返回规范化链接；失效的选择不得静默对另一个工作区执行写操作。API 显式传 `workspaceId` 或使用 `/api/workspaces/:workspaceId/...`；项目、订单等已有资源从数据库推导所属工作区，浏览器的“当前工作区”不提供授权。

`/app/projects` 页面最低要求为有效 session，选定工作区后再验证 membership；已无任何工作区的用户看到空态及 Account/Help 入口，不因登录或列表访问再次创建默认工作区。项目列表 API 仍要求明确且有成员权限的工作区。

`/app/projects/:projectId` 等资源详情不需要重复 workspace query。设置中的 Orders 导航链接订单列表，Support 链接帮助页。P0 不新增仅用于同一页 tab 的假路径、未实现的密码页、平台自动发布入口或空翻译路由。

## 3 跳转、query、错误和缓存

### 3.1 登录后返回

未登录访问私有 HTML 时返回 302 到 `/login?returnTo=...`；JSON API 返回 401 结构化错误，不返回一段登录 HTML。开始认证时一次性验证 `returnTo` 并保存到短时服务端 flow；Google 回调和邮箱验证阶段不能用新传入的返回 URL 覆盖它。默认返回 `/app/projects`。

允许返回的目标仅为已登记的 `/create`、`/app` 页面或 `/invite/:token`，最大长度读取认证配置，默认 2,048 字符。必须是以单个 `/` 开始的本站相对路径；不接受外站或本站绝对 URL、`//`、反斜杠、控制字符、片段、点段、编码分隔符和多重编码路径。query 按一次解析、逐项 allowlist、再序列化，拒绝重复键；任何层解析后不一致则回退到默认入口，不做开放重定向。

| 目标 | 可恢复的 query |
| --- | --- |
| `/create` | `audience`、`task`、`duration`、`platforms`；按已定义任务、15/30 秒及六平台配置校验，平台使用去重的逗号分隔 ID |
| 应用默认入口、项目/订单列表、Brand、Members | `workspaceId`；加载页面和写入前分别验证成员或 Owner 权限 |
| 其他允许的详情、Account、Appearance、邀请 | 无业务 query；动态参数仍须通过路由和长度校验 |

`/login`、`/api`、`/admin`、`/review` 不能成为用户输入的认证返回目标。后台直接从 `/admin` 进入；服务端验证 Cloudflare Access JWT 后，映射并检查应用的 admin 资格，不另建管理登录 URI。创建参数与已清洗的来源信息存 flow 或已有草稿，不把原始 UTM/referrer 一层层拼进 OAuth URL；来源按 07 入账。邀请 token 保存在同一私有 flow；日志和分析事件不保存含 token 的原始 returnTo。

登录后重新检查返回资源权限。已无权访问的项目或订单使用 404，保留可回项目列表的入口；登录成功不等于获取该资源权限。验证码、OAuth 失败、重试和换邮箱均保留有效的创建选择。浏览器文件授权不能假定跨整页跳转永久保留，所以实际上传仍在登录后开始。

### 3.2 HTTP 与隐私

成功的导航型 POST 和 Google 回调使用 303 返回允许的页面；JSON 认证 API 返回 `nextPath`，前端只能使用服务端已校验的站内值。Google start 使用同源导航表单 POST，服务端 303 的唯一外跳目的为已配置的 Google 授权地址；不使用 fetch 自动跟随跨域登录跳转。GET 打开登录、验证码或邀请页不验证验证码、不关联身份、不消耗邀请；Google callback 是经一次性 state 校验的协议回调例外。

未知 HTML 路径返回真正的 404 页面；未知 `/api` 返回 JSON 404；已知路径的错误方法返回 405 和 `Allow`。无效、过期、撤销或已被其他人消费的邀请/审阅链接使用不泄露资源详情的 410 页面。业务资源无权访问使用 404，已知功能缺少角色权限可用 403。不要把这些情况改成 200 的通用 SPA 壳或额外 `/404` 跳转。

公开页面的 HTTPS/规范主机及尾斜线可在 GET/HEAD 上 308 到规范 URI；受保护响应仍 no-store。API mutation 不经营销重定向器重写，不自动跟随到另一主机。部署前把真正控制的主机列入 allowlist，不从任意 Host 生成回调。

登录、创建、认证 API、应用、邀请、审阅、后台和所有 Set-Cookie 响应为 `Cache-Control: private, no-store`，Cloudflare 同时绕过共享缓存；HTML/API 按需输出 `X-Robots-Tag: noindex`。认证、邀请与审阅页设置 `Referrer-Policy: no-referrer`，不加载会取得 token URL 的第三方分析脚本。日志先按路由模板去标识，再写入观测；不能记录完整 callback query、邀请路径或 OTP 请求 body。

`/sitemap.xml` 只从路由种子的 `index` 页及真实发布的样片 slug 生成，不输出 `:slug` 占位符、草稿、创建/登录/应用页和另一套 `/en/`。`/robots.txt` 声明正式 sitemap 并限制私有路径抓取；noindex 和服务端鉴权仍独立实现，robots 不是保密措施。预发布整体不收录并受 Access 保护，不提供可索引的预发布 sitemap。未来网站语言真实发布后才扩语言路由；主题不进入 URI。

## 4 邮件验证码流程

### 4.1 默认策略

以下是本项目可调整的安全与体验默认值，不是邮件厂商保证值；由 `config/auth.json` 统一提供 UI 与服务端配置。

| 项目 | P0 默认 |
| --- | --- |
| 验证码 | 密码学安全随机的 6 位数字字符串，保留前导零 |
| 单个验证码有效期 | 最长 10 分钟且不晚于所属 flow 到期，以服务端 UTC 时钟为准 |
| 认证 flow 有效期 | 30 分钟；验证/关联不能使过期 flow 复活 |
| 重发 | 至少间隔 60 秒；同一 flow 最多 5 次发送，包括首次 |
| 错误尝试 | 同一 flow 累计最多 5 次；重发不清零，不锁死整个账号 |
| 按邮箱发码限制 | 5 次/小时、20 次/天；login/link/reauth 共用预算 |
| 按 IP 发码限制 | 30 次/15 分钟；按实际共享网络误伤调整 |
| 敏感操作证明 | 为当前操作新完成的既有方式验证，最多保留 10 分钟；长期会话本身不算证明 |
| 应用会话 | 30 天固定绝对期限，不用后台轮询无限续期；可主动退出或全部撤销 |

Google 与 OTP 产生的所有身份 proof 共用 `proofExpiresAfterSeconds`：实际截止为 `min(verifiedAt + 600s, flow.expiresAt)`，包括待注册、待关联与敏感操作证明。验证码实际截止为 `min(createdAt + 600s, flow.expiresAt)`；重发、等待确认和派生后续意图都不能延长原 flow 或已有 proof。邮件与 UI 显示服务器给出的实际剩余时间或截止时间，不在剩余不足 10 分钟时仍宣称有完整 10 分钟。

发码和验证计数使用权威原子状态，防止多个 Worker/区域绕过；Workers 边缘限流用于前置削峰，不能替代按邮箱和 flow 的权威预算。可用 DO 协调及 D1 条件更新；不使用非原子的 KV 读改写消费验证码。异常流量按风险要求 Turnstile，服务端验证其结果；设置账户实际邮件额度与全站预算熔断。发码额度耗尽不使已发出的有效码失效，也不禁用原有会话或 Google 登录。

### 4.2 请求、验证、重发

1. 用户在 `/login` 输入邮箱，POST 请求验证码。服务端验证邮箱、同源 Origin/CSRF、flow 与额度，为请求创建随机 challenge。格式错误返回 422；存在和不存在的账号使用相同的 202 结构及处理路径，只有证明邮箱后才可进入账号选择或关联。
2. Worker 调用邮件适配器发送文本与 HTML 邮件。浏览器进入 `/login/verify`，显示刚输入的邮箱和服务器返回的到期、重发时间；刷新从 flow 恢复。页面说明为“查看邮箱”，不把已接受的请求显示成“已送达”。
3. 提交 `challengeId`、验证码字符串和 request ID。验证码还需匹配浏览器 flow、用途、有效期、代数、剩余次数与消费状态；验证成功只生成一次身份结果，按第 5 节登录、注册或等待显式关联。验证码不放 URL、Cookie、localStorage、日志、指标或邮件主题。
4. 重发使用新的 request ID 和当前 challenge，生成新码，只废止**这个 flow** 的旧码，不废止其他浏览器的码；继承错误计数。使用同一 request ID 重试发送不会再发第二封；同 key 不同 body 返回 409。
5. 换邮箱取消当前 challenge，重新输入，但保留合法的任务和返回目标；再次发送仍受邮箱/IP 配额。达到次数或 flow 到期可重新开始，不能由前端改时钟绕过。GET 或邮件安全扫描不消耗任何验证码。

邮箱原文与比较 key 分开。统一去除首尾空白、域名小写并按 IDNA 转为稳定域名形式；本地部分保留大小写，不去除点号或 `+tag`，不猜测不同地址互为别名。使用受控解析器拒绝 CR/LF、多个收件人及超长字段，不拼接原始邮件头。P0 支持普通邮箱和国际化域名；需要 SMTPUTF8 的 Unicode 本地部分在所选传输实际验证支持前返回具体格式提示，不宣称所有邮箱语法已验证。这与任意语言的视频文案无关。

持久化只保存 `HMAC-SHA-256(secret, challengeId + purpose + generation + emailKey + code)` 等明确编码字段的摘要，密钥独立放 Worker Secret，并保存密钥版本；普通 hash 不足以保护低熵数字码。原码只在生成和发送的受限内存中使用，比较采用常量时间方案。challenge 使用至少 32 字节随机 ID，且 ID 本身不提供认证能力，必须匹配 HttpOnly flow cookie。

验证次数、一次消费、身份归属、首次 user/workspace 创建和会话写入需以条件更新、唯一约束和原子事务收敛；失败不能留下“码已消费但账号只建一半”。同码并发最多一个登录结果。验证响应丢失时，只有 Cookie 对应该 flow 完成记录中的有效 session、user 且 request ID 一致，才可恢复结果，不能接受浏览器中任意其他账号的 Cookie。没有收到对应会话 Cookie 的重试返回 `AUTH_RESTART_REQUIRED`，按原配额重新发码进入已创建的同一个账号，不再次消费旧码或创建工作区。不得为省一次重试在数据库保存明文 session token。

发送 API 超时视为结果未知，不做无界自动重发或假定厂商幂等。该码在剩余有效期仍可验证；UI 提示稍等或到冷却后申请新码。明确发送拒绝可取消 challenge，但与账号是否存在无关。只有真实投递事件/受控收件箱检查才能区分接受、投递、退信和收件箱到达。

### 4.3 错误契约

| code | 状态/结果 | 用户可执行动作 |
| --- | --- | --- |
| `INVALID_EMAIL` | 422 | 修改邮箱格式 |
| `AUTH_RATE_LIMITED` | 429、`Retry-After` | 等待服务端允许后重试；不暴露注册状态 |
| `AUTH_CODE_INVALID_OR_EXPIRED` | 400 | 检查输入或申请新码，错误预算不清零 |
| `AUTH_ATTEMPTS_EXCEEDED` | 429 | 当前 flow 结束，冷却后重新开始 |
| `AUTH_FLOW_EXPIRED` / `AUTH_RESTART_REQUIRED` | 409 | 返回登录重新验证，保留合法任务 |
| `AUTH_EMAIL_UNAVAILABLE` | 503 | 稍后重试，或使用已关联的 Google 方式；不能绕过验证 |
| `AUTH_LINK_CONFLICT` | 409，验证过身份后才显示 | 保留原账号，取消关联或联系支持 |
| `AUTH_REAUTH_REQUIRED` | 403，`params.actionIntentId` 指向当前会话的操作意图 | 完成为这一个敏感操作新发起的身份验证，再提交原操作 |

沿用 04 的 `code/messageKey/params/message/fieldErrors/retryable/requestId` 错误结构。精确到期信息只能来自本浏览器已授权的 flow；用户可见提示英语化，供应商原始错误只保留安全分类。

## 5 统一账号与显式关联

`users.id` 是稳定业务主键；Google identity 使用经过验证的 issuer 与 `sub`，邮箱 identity 使用本系统验证过的 email key。`provider + subject` 唯一，一个 identity 只能属于一个 user。提供方的 email 是资料，不是迁移项目或查找授权的主键。Google email 变化不改原 `sub` 的归属，也不静默修改既有邮箱登录方式。

Google 官方明确建议以 `sub` 标识用户，并说明第三方邮箱即使 `email_verified=true`，也未必能证明其当前邮箱控制权。本产品统一要求显式关联；即便 Google 对 Gmail/Workspace 邮箱具有其文档定义的权威性，也不仅凭相同 email 合并既有账号。[Google 身份标识](https://developers.google.com/identity/openid-connect/openid-connect)、[邮箱权威性](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)

| 经过验证的情况 | 处理 |
| --- | --- |
| login 流程中已存在的 Google `sub` 或 email identity | 登录它已归属的原 user；不按 email 重新找另一人 |
| login 流程中全新 email identity、没有关联提示 | 原子创建 user、identity、一个默认 workspace 和 Owner membership；重复请求复用结果 |
| login 流程中未知 Google `sub` | 在 `/login/link` 显示不泄露查重结果的通用 Create account / Connect existing account 选择；新建明确确认后原子创建，连接则证明原方式，避免用不可信 email 去重或静默第二账号 |
| 已登录用户添加另一方式 | 从 Account 显式发起，验证既有方式与新方式后确认；只新增 identity，不创建/搬迁工作区或订单 |
| 邮箱 OTP 验证后发现同邮箱的 Google 资料提示 | 暂缓自动注册，在 `/login/link` 选择连接原账号；还须证明原 Google identity，显示确认后关联 |
| 新 Google identity 对应已有邮箱 identity | 只有 Google 的邮箱权威性校验通过，或本系统 OTP 已证明该邮箱，才可显示相关关联提示；仍需已有方式证明并确认 |
| Google 邮箱不是当前权威资料 | 不凭该值查询并展示邮箱注册状态、预留邮箱或阻止真实邮箱持有人注册；仅作为提供方资料 |
| 新方式已经属于另一个 user | 关联返回冲突；禁止移动 identity、合并项目/账单或绕过唯一约束 |

验证码消费或 Google 验证后可留下短时的服务端 proof，绑定 flow/browser、purpose、provider+subject、适用的目标 user、验证时间、到期和消费状态；不继续接受旧码或旧提供方 token。`purpose=login` 的验证先得到同一 flow 的 `login-resolution` 结果：已知 identity 直接完成登录，未绑定的新 identity 可进入待注册/关联选择。选择连接时，可在这个 flow 内补充原账号证明；最终注册或关联确认由服务端将尚未消费的 resolution 原子派生为**一个** register 或 link 意图并消费，继承原验证时间和截止时间。尚未最终确认且新 identity 仍未绑定时，允许改选独立注册；这不会复制 proof，也不能使两个分支同时成功。已固定的 link/register proof 不得任意换用途，任何 login-resolution/link/register 结果都不能转成 reauth；敏感操作必须重新开始对应的验证。

未知 Google 的新建确认和独立注册仅接受原始 `purpose=login` 的 login-resolution 分支；从 Account 发起的固定 link 或敏感操作 reauth 不得进入注册，验证失败也不能降级成创建新账号。

原账号证明必须来自它**已经关联**的方式；Google 验证须匹配准确的 `sub`，不能证明了另一个同邮箱 Google 账户就通过。匿名用户在同一 flow 完成两份有效证明后，可将原身份对应的 user 固定为关联目标，不要求先有应用 session。已登录用户从 Account 发起关联则从开始固定原 user 和 session，最终必须仍是该有效会话；不能中途切换目标账号。用户确认之前不写新 identity；确认时重查两份证明、适用的原会话、账号状态和 identity 唯一性，原子提交并轮换或签发会话。客户端不能传新 email、provider 或目标 `userId` 替换已验证对象，重发也不延长已取得的证明。

同邮箱的提供方资料提示不能成为账号抢注锁。已证明的新 identity 若仍未绑定，而用户无法或不愿连接原账号，可在明确告知“旧项目和订单不会带入，原登录方式仍进入原账号，P0 不合并两个已成型账号”后，选择 **Create a separate account**，调用注册确认接口建立独立账号；不自动悄悄创建第二套工作区，也不让未验证的 Google 邮箱阻止真正邮箱所有者使用产品。已经绑定的 identity 不允许走此分支；它只能登录原账号。关联与注册确认并发时，最终事务重查 identity 唯一性，只允许一方提交，另一方返回冲突；新 user/identity/workspace/membership 一起回滚，不留下孤立账号。对可能关联的旧账号，在获得其证明前不展示工作区、订单、其他邮箱或身份详细资料。

P0 支持添加 Google/邮箱方式和撤销会话，暂不提供自助解绑、任意改登录邮箱或合并两个已存在的账号。Account 只显示已实现的动作；支持流程不能凭一封邮件或付款截图擅自改变身份归属。关联完成后的用户、工作区和订单 ID 保持不变。

## 6 Google、会话与退出

Google 使用服务端 authorization code flow；由 `POST /api/auth/google/start` 创建绑定浏览器的随机 state、nonce 与 PKCE S256，再 303 到固定 Google 授权端点。回调沿用 `GET /api/auth/google/callback`，核对一次性 state、PKCE、JWT 签名、issuer、audience、expiry、nonce 和用途。只申请 `openid email profile`，不请求 Drive、YouTube 或发布权限。生产和预发布分别登记准确的 callback，并隔离密钥、flow、数据库及 Cookie。

用户拒绝授权、供应商错误、失效或重放 callback 均不建立会话，回到保留合法任务的登录页。用于关联和敏感操作的证明要新发起 provider 往返或新邮箱验证码，并匹配原 identity；不能把旧 id_token、普通导航、Google 账户选择器或仅持有应用 Cookie 当成完成此项验证。

reauth 选到了未关联的 Google identity 或其他 user 的身份时，拒绝此次验证并保留原有效会话；不注册、不关联新方式、不改变 action intent 的 actor。

应用 Cookie 名为 `__Host-promobento_session`，值是至少 32 字节的随机不透明 token；D1 仅保存 hash、user、创建/到期/撤销时间和安全版本。Cookie 使用 `Secure; HttpOnly; SameSite=Lax; Path=/`，不设 Domain；每个授权请求检查会话与当前 membership。新登录及关联时轮换当前 token，不能把匿名 flow cookie 升格成登录 token。关联后撤销旧会话并签发新会话，防止旧安全上下文继续使用。30 天到期由服务端强制，浏览器 Max-Age 不得超过剩余期限。

全部退出、Owner 转移和工作区删除使用对应的操作意图。原业务请求先验证会话、Origin/CSRF、角色、资源和输入；缺少该操作的有效证明时创建或复用随机 `actionIntentId`，在 403 `AUTH_REAUTH_REQUIRED` 的 `params` 返回该 ID，并建立或关联当前会话的 auth flow，不执行业务操作。意图固定 actor、原 session、action、resource、必要的 target、版本和规范化业务请求摘要。Google start 或 email challenges 以 `purpose=reauth` 携带 `actionIntentId`，只验证该 actor 已关联的身份；不能由客户端替换意图中的账号或操作。

取得 proof 后，原 mutation 保持原业务 request ID 和业务字段，携带 `actionIntentId` 重新提交。服务端重查原会话、权限、操作上下文、摘要与证明期限，并将证明的单次消费和业务变更原子提交；修改目标、工作区或版本需新意图和新验证。摘要不包含 CSRF 与 `actionIntentId` 等认证传输字段；先前 403 不作为业务幂等成功结果，实际成功后才按原请求返回可重复读取的结果。不同敏感动作不能复用同一 proof，也不能仅以普通会话最近活动时间代替证明。

`POST /api/auth/logout` 的 scope 省略时默认为 `current`，非 current/all 的值返回 422。`scope=current` 在有效会话下正常校验 Origin/CSRF，再撤销当前会话并清 Cookie；确实没有有效会话时，同源检查后清除无效 Cookie 并返回 204，不要求一个仍有效的 session 来验证 CSRF，重复调用不报成注销失败。`scope=all` 必须有有效原会话和匹配 `logout_all` 操作意图的证明，并原子消费证明、撤销该 user 全部会话（包含当前）；匿名请求不能借此操作其他用户。退出成功回 `/login` 或公开页；不删除主题 Cookie、不删除云端项目、不取消已付款的后台渲染。撤销后旧 token 不能访问私有 API；已签发的短时下载链接仍受其独立有效期与下载授权规则约束，不承诺收回已经下载的文件。

认证 mutation 包括登录前发码、Google start、关联、注册确认、取消 flow 与退出，除上述无有效会话的 current 退出分支外，均检查同源 Origin 与绑定 flow/session 的 CSRF token；SameSite 不能替代 CSRF。Google callback 使用协议 state/nonce 保护；Waffo webhook 使用独立签名校验，不套用浏览器 CSRF。登录 flow cookie `__Host-promobento_auth_flow` 同样 host-only/HttpOnly/Secure，最多 30 分钟，不进入视频内容、账务指纹或分析标识。

验证码/Google 验证成功但仍待注册或关联确认、以及已取得 reauth proof 但尚未提交对应操作，都属于 pending，不清除仍有效的 flow。只有最终登录、注册、关联或敏感操作成功，以及显式取消或到期时，才结束 flow 并清理 Cookie；必要的脱敏完成记录可短时保留以支持既定重试规则。auth flow、challenge 及关联 action intent 到期后 24 小时内删除临时邮箱资料、hash、验证码摘要和 proofs，只保留脱敏安全事件与受限的反滥用计数；正式身份、业务记录与有效应用会话不属于这批临时清理对象。原始验证码始终不持久化。

## 7 邀请与只读审阅

Owner 创建邀请后复制 `/invite/:token`，48 小时有效、单次使用、可撤销；P0 不自动发送邀请邮件。页面展示必要的团队邀请说明及登录/Join workspace 操作；Google 或邮箱登录后回到该页，**还需明确提交接受**，不在认证回调中自动入队。确认前显示当前登录身份，允许切换账号。

接受时原子检查 token、撤销/到期、工作区状态、成员关系及最多 3 人的名额；并发抢最后名额只有一个新成员成功。同一用户已是成员时返回已加入，不再占名额；已成功接受后的同用户重试，在当前仍为成员且工作区可用时幂等返回原结果，其他用户不能重放消费。后来被移除或工作区已不可用时返回当前无权限的 404，旧邀请不重建 membership，也不恢复历史资格。成功响应的 `nextPath` 固定为 `/app/projects?workspaceId=<acceptedWorkspaceId>`，进入被邀请工作区的项目列表；即使保留着创建选择，也不在此次接受后自动返回 `/create` 或开始项目。新账号的默认工作区和被邀请工作区是不同关系，接受不覆盖原默认工作区、不改 Owner、不转移个人项目。成员移除、Owner 转移、工作区删除的 URI 见路由表；转移/删除需第 6 节对应 action intent 的既有方式新验证及确认，禁止留下无 Owner 的工作区。

审阅保持默认 7 天且不晚于项目期限，只授权指定版本及必要的预览媒体。`GET /api/projects/:projectId` 为成员专用；`/review/:token` 的独立 loader 按分享范围取数据，不能转调成员全量接口暴露账单、原素材或其他版本。撤销分享立即停止签发新预览授权；媒体链接使用短期、只读、同范围授权。

## 8 Cloudflare 邮件与部署

首选 Cloudflare **Email Service → Email Sending**，使用 `send_email` binding 的 `env.EMAIL.send()` 和结构化文本/HTML；不额外引入 SMTP 或 Node 邮件 SDK。截至 2026-10-19 UTC，官方仍标 Email Sending 为 Beta；任意收件人发送需 Workers Paid、Cloudflare DNS 和已完成 onboarding 的发送域名。Email Routing 用于接收/转发支持邮件，不能代替此发送能力。[概览](https://developers.cloudflare.com/email-service/)、[接入](https://developers.cloudflare.com/email-service/get-started/send-emails/)、[Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)

正式发信人规划为 `PromoBento <login@auth.promobento.com>`，预发布为 `PromoBento Preview <login@auth-staging.promobento.com>`；分别配置只允许对应 sender 的 binding、DNS 邮件认证与环境隔离。Reply-To 为实际验证过的支持地址；未配置时不能伪称有收件支持。发送域与网站主机不是同一概念，新增邮件子域不创建新应用会话域，也不更改现有支持邮箱 MX 而不检查影响。[域名配置](https://developers.cloudflare.com/email-service/configuration/domains/)、[邮件认证](https://developers.cloudflare.com/email-service/concepts/email-authentication/)

新账号的发送额度根据信誉和实际账户状态调整，不预设厂商保证的每日容量。M0 确认当前额度，设置全站发送预算与退信监控；发送 API 返回 `messageId` 只代表接收请求，不能当作进入收件箱的证据。运行时适配器只保留 `sendLoginCode` 一类最小接口，P0 仅实现 Cloudflare；若目标账号或送达验收不通过，明确阻塞并另行记录替代传输决定，不静默换供应商。[额度](https://developers.cloudflare.com/email-service/platform/limits/)

认证邮件使用英语资源，正文包含验证码、用途、期限、非本人请求说明和支持入口；不带客户视频、促销或附件。HTML 插值转义，纯文本版本也可读，字体与颜色在常见邮件客户端可用。验证码不放 subject、preheader、可跟踪图片或链接。未来新增网站语言时一并翻译事务邮件，当前不依据用户输入内容猜邮件语言。

本地/CI 默认使用受控 mock 邮件适配器，不开启真实 remote binding；本地模拟结果不算送达验收。Cloudflare `remote: true` 会真实发信，只在明确的预发布集成测试使用团队控制的收件地址，生产配置不能有调试验证码旁路。本地调试码仅允许在隔离测试 fixture 内使用，不写共享 CI 日志。[本地邮件开发](https://developers.cloudflare.com/email-service/local-development/sending/)

## 9 必须验收的边界

| ID | 场景 | 通过条件 |
| --- | --- | --- |
| AUTH-01 | Google 与邮箱，两类创建入口、邀请和订单回跳 | 选择/来源保留；登录不直接接受邀请，不把未付订单改成成功；主题不变 |
| AUTH-02 | 过期、5 次错误、重发旧码、不同浏览器、用途转换与证明上下文 | 原子限次；重发不重置计数；别的 flow 仍可用；login-resolution 仅按规定派生一个 register/link 结果，不能转 reauth；两种方式都受实际 proof/flow 截止约束，修改 action/actor/resource/target 不可复用证明，pending 验证不提前清 flow |
| AUTH-03 | 同码并发、重复发送、身份首次注册竞态、响应丢失 | 一次消费、一个 user/default workspace；按既定恢复分支重试，不复用原码签发第二会话 |
| AUTH-04 | Google→邮箱、邮箱→Google、相同资料邮箱、第三方 email_verified、provider email 变化 | 双证明与确认后才关联；已有 identity 不迁移；非权威邮箱不抢注、不泄露状态、不静默第二工作区 |
| AUTH-05 | CSRF、state/nonce/PKCE 错误、重放、恶意 returnTo、API 错误方法 | 拒绝并返回明确安全错误；无外跳、无跨账号会话、无 GET 退出或自动入队 |
| AUTH-06 | 到期、当前/全部退出、关联轮换、移除成员、跨环境 Cookie | 原 token/旧权限失效；主题及已付作业保留；私有响应不串缓存 |
| AUTH-07 | 发码滥用、共享网络、地址格式与大小写、换邮箱、邮件故障 | 配额不可绕过，无账号枚举，错误可恢复；不宣称所有邮箱语法或所有语言已实测 |
| AUTH-08 | 最后一个成员位并发、重复接受、过期/撤销、共享越权 | 至多 3 人，同用户幂等；匿名只能看获准版本，无 Owner 丢失 |
| AUTH-09 | 真实 Cloudflare 与受控 Gmail/Outlook/自定义域邮箱 | 记录环境、DNS/额度、发送接受与实际到达耗时；过期前留足输入时间，真实验证码能完成登录 |
| URI-01 | 注册路径、默认跳转、深链接、404/405/410、robots/sitemap | 路由表与应用一致；无假 200、索引占位符、私有 sitemap 或空翻译页 |

AUTH-09 是真实外部集成验收，适合留关键记录；普通 JSON、文档及路由一致性检查随提交或 CI 报告，不新增过程档案。上述均为应用阶段验收目标，本次规格检查通过不代表任何认证端点、邮件投递或生产部署已经实现。

安全设计参考：[OWASP 一次性验证与防枚举原则](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)、[OWASP 会话管理](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。验证码长度、时限、限流和会话期限是 PromoBento 的产品取舍；不把密码恢复示例中的全部步骤当成邮箱登录要求。
