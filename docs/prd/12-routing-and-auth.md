# URI、登录与账号

本章定义路由、登录和账号安全。数值来自[auth.json](../../config/auth.json)，路径、方法和最低权限来自[routes.json](../../config/routes.json)，界面见[02](02-ux-and-ui.md)，网站偏好见[10](10-i18n-and-themes.md)。本文中 `flow` 指一次验证流程，`proof` 指验证成功后短时有效、只能按用途消费的证明，`identity` 指绑定到内部账号的登录方式。实际集成进度见[实施状态](../implementation-status.md)。

## 1 身份、页面与工作区

P0 提供 Google 与邮箱验证码登录，登录和注册共用入口。不提供密码、magic link 或额外的网站语言步骤，邮箱验证码也不称为多因素认证。内部 user_id 稳定，identity 与项目/订单 ID 分离；关联两种登录方式须分别验证，并由用户确认。

业务站点/API 同源：正式 promobento.com，预发布 staging.promobento.com；不可信 Composition 预览使用 [预览配置](../../config/preview.json) 中的受限 origin，不能共享应用会话。预览配置、隔离域和资产代理未验证前不开放真实预览，具体限制按 14。API `/api`，路径小写名词/短横线，无尾斜线，动态参数如 :projectId/:orderId。配置 auth 是最低入口，不替代资源权限、Owner、CSRF 或签名。

/create 先选任务/15或30秒/平台，素材上传、预处理、方向卡和生成前均须 Google/邮箱登录；匿名阶段只保留低成本的选项和公开自有样片，不接收/处理客户素材或生成方向。/login 共用 Google/邮箱；/login/verify 验证码，/login/link 待注册/关联确认。/app→/app/projects、/app/settings→/app/settings/account 为 302/private,no-store；Account、Appearance、Brand、Members、Orders 使用已注册页面。Help 复用 /help；搜索资源只含真实 robots/sitemap，不提供空 /llms.txt 或未实现页面。

/terms、/privacy、/refund-policy 的完整正文来自[内容目录](../../content/pages/README.md)。注册路由不等于正文已发布；仅在内容通过发布条件后公开提供，草稿、未完成变量和编辑提示不能进入正式页面。文章全文由 SSR/构建产物输出，仍遵守 10 的主题与缓存隔离。

GET /login 创建/恢复服务端 flow 和 host-only Cookie，输出绑定 CSRF，不建账号、不发码。已绑定账号的 flow 只在原有效会话恢复，不能覆盖/泄漏另一账号；不匹配取消或重新开始。匿名 GET /api/auth/session 只返回 authenticated=false，不创建 flow。无有效 challenge/proof 的 verify/link HTML 302 回登录并用安全 flash code 提示，对应 API 409；邮箱和证明不进 URL。

新账号原子创建一个默认 workspace/Owner membership。接受邀请可切换合法成员工作区，不引入多客户购买产品。列表/Brand/Members/Orders 使用 workspaceId query；省略时服务端选仍有权限的最近或默认工作区，并返回规范化链接。失效选择不能静默写另一个工作区。详情从真实项目/订单推导工作区，不信浏览器“当前工作区”。已无工作区的登录用户看到空态及 Account/Help，不因列表访问再创建默认工作区。

试用资格使用稳定的内部 user_id，领取、成员共享、复制和退款规则统一见[05](05-waffo-billing.md#11-一次试用及空草稿)。认证、关联登录方式或创建工作区不会另送额度。独立账号不凭邮箱相似性强行合并，也不因此保证赠送试用；仍须通过领取和反滥用校验。设备/IP 限流不能代替账号资格检查。

## 2 跳转、HTTP 与隐私

私有 HTML 无会话 302 到 /login?returnTo=...；JSON API 401，不回登录 HTML。开始 flow 时一次校验 returnTo 并服务端保存，回调/验证码阶段不能用新传值覆盖。默认 /app/projects。

仅允许已注册 /create、/app 页面、/invite/:token 的本站单斜线相对路径，最长 2048；拒绝绝对 URL、双斜线、反斜杠、控制字符、片段、点段、编码分隔符、多重编码和重复 query 键。解析/重新序列化不一致回退默认，不开放重定向。/login、/api、/admin、/review 不能作为用户输入返回目标。

/create query 只允许 audience/task/duration/platforms：audience 仅为 software/course，task 是自由文本而非任务枚举，仍受回跳 URL 的长度与编码限制；duration 仅 15/30，platforms 按平台 ID 校验和去重。应用列表/Brand/Members 允许 workspaceId，其余详情/Account/Appearance/邀请无业务 query。完整任务、已选 targetIds 与 Feed 方形保存在绑定的 flow/草稿上下文，目标按平台配对校验，不能扩张 returnTo allowlist。原始 UTM/referrer 不层层拼进 OAuth URL；来源按 07 脱敏，日志不留带邀请 token 的返回地址。

登录成功后重新验目标权限，无权资源 404 并保留项目列表入口。失败/重试/换邮箱保留合法任务。文件选择授权不保证跨页面登录后仍有效，上传在登录后开始。

导航型 POST/Google callback 成功用 303 到允许目的；JSON API 返回已校验 nextPath。Google start 用同源导航表单 POST，不以 fetch 自动跟随跨域跳转。GET 登录/验证码/邀请不验证或消费身份；Google callback 是一次性 state 协议例外。

未知 HTML 真 404，未知 API JSON 404，已知路径错误方法 405+Allow；无效/过期/撤销/被其他用户消费的邀请和审阅用不泄露细节的 410。不可见资源 404，已知功能缺角色 403，不能通用 SPA 200。GET/HEAD 的 HTTPS/规范主机/尾斜线可 308；mutation 不营销重定向，不信 Host 生成回调。

登录、创建、认证 API、应用、邀请、审阅、后台和 Set-Cookie 均 private,no-store 并绕过共享缓存，按需 noindex。认证/邀请/审阅 no-referrer，无会读 token URL 的第三方分析脚本。日志按路由模板脱敏，不写 callback query、OTP body、邀请路径。

事实、转写、展示授权、持久 export/snapshot 的 URI 与机器契约统一见 [04 §5](04-architecture-and-data.md#5-第一方-api)。读取 exportManifest 不依赖原浏览器、临时 job 或下载 URL，仍查当前成员、实际归属及保存期限；GET 不准备目标、创建订单或签发下载。路径/body 的 project、asset、release、snapshot ID 不一致即拒绝，上传完成从 uploadId 的服务端记录推导归属，不接受客户端换项目。

事实、转写和展示同意按[04](04-architecture-and-data.md)核验当前用户、资源及版本，冲突返回 409。展示同意只允许 Owner 授予或撤回，拒绝或撤回不影响制作、付款和下载。`support.tickets.create` 的会话只证明谁在提交：普通支持还须核验所附资源可见性，退款须核验原订单工作区的当前 Owner。P0 账号关闭统一通过 `brand.supportEmail` 人工受理，核验与执行条件见本章 §6，收到邮件或工单不构成关闭授权。支持人员不能凭请求字段改变订单归属或金额。交易与撤回规则见 04/05。

sitemap 只含已经发布的 index 页与样例 slug，须同时检查路由索引策略和内容发布状态，不含占位符、草稿、私有页或空语言；robots 不是保密措施，noindex 和授权独立。预发布整体 Access+不收录。后台验证 Access JWT 后映射应用管理员，不另设管理登录 URI。

## 3 OTP、flow 和会话期限

| 策略 | 当前默认与不变量 |
| --- | --- |
| 验证码 | 密码学随机 6 位数字字符串，保留前导零 |
| 码期限 | min(createdAt+600s, flow.expiresAt) |
| flow | 1800s，不因等待/重发/派生延长 |
| 重发 | 间隔 60s，同 flow 最多 5 次含首次 |
| 错误尝试 | 同 flow 累计 5 次，重发不重置，不锁死全账号 |
| 发码限制 | 同邮箱 5/小时、20/天，login/link/reauth 共用；IP 30/15分钟 |
| proof | min(verifiedAt+600s, flow.expiresAt)，包含注册/关联/reauth |
| 应用 session | 固定绝对 30 天，不以轮询滑动延长，可撤销 |

验证码和 proof 的剩余期限由服务端 UTC 确定；不足 10 分钟时 UI/邮件不能仍声称完整 10 分钟。权威计数和消费使用原子状态（DO/D1 条件写），边缘限流只削峰，不用 KV 非原子读改写。风险需要 Turnstile 时服务端核验；全站邮件预算按实账户配置。发码预算耗尽不废止有效码、已有会话或 Google 登录。

## 4 请求、验证、重发与恢复

1. `POST /api/auth/email/challenges` 校验邮箱、同源 Origin/CSRF、flow 和预算，建立随机 challenge；格式错误返回 422，已注册和未注册邮箱均返回 202，验证邮箱前不暴露账号状态。
2. 邮件适配器发送文本/HTML，进入 verify 显示已输入邮箱及实际截止/重发时间；刷新从 flow 恢复。202/messageId 仅接收请求，不等于投递或进收件箱。
3. 提交 challengeId、code 字符串和 requestId；校验浏览器 flow、purpose、generation、期限、次数和消费。成功只产生一次身份 resolution，按下节登录/注册/关联。code 不进 URL、Cookie、localStorage、日志、指标、subject/preheader。
4. 重发用新 requestId，只废止当前 flow 的旧码，其他浏览器不受影响，错误计数继承。同 requestId 重试不会再发第二封，同 key 异 body 409。
5. 换邮箱取消当前 challenge，保留合法任务，再发受邮箱/IP 预算。GET/安全扫描不消费码；前端改时钟/刷新不能绕过限制。

邮箱原文与 key 分离：去首尾空白，域名 IDNA ASCII 小写，本地部分保留大小写，不删点或 +tag，不猜别名。受控解析器拒绝 CR/LF、多收件人和超长头。普通邮箱与国际化域名可用，Unicode 本地部分在传输 SMTPUTF8 实测前提示具体格式问题；与视频任意语言无关。

只保存 HMAC-SHA-256(secret, 明确编码的 challengeId/purpose/generation/emailKey/code) 摘要和密钥版本，不保存普通无密钥 hash。原码仅生成/发送的受限内存使用，常量时间比较，密钥独立 Worker Secret。challenge 至少 32 字节随机，本身不是授权，必须匹配 HttpOnly flow Cookie。

错误次数、验证码消费、identity 唯一性及首次账号/工作区/会话创建使用条件写或事务，不能出现码已消费而账号只创建一半的情况。同码并发只产生一个结果。响应丢失后仅当 Cookie 对应该 flow 完成记录中的有效 session/user 且 requestId 一致可恢复；不能接受另一账号 Cookie。未收到对应会话 Cookie 则 AUTH_RESTART_REQUIRED，按原配额重新发码进已创建账号，不再消费原码或创建工作区；不得为恢复持久化明文 session token。

发送超时是未知，不无界重发；该码剩余期限仍可验证，冷却后用户可申请新码。明确拒绝可取消 challenge，路径不能按账号存在性变化。真实投递事件与受控收件检查区别接受、投递、退信及到达。

## 5 稳定账号与显式关联

Google identity 取经过验证的 issuer/sub，email identity 取本系统 OTP 证明的 key；provider+subject 唯一且只属一个 user。提供方 email 是资料，不是项目迁移/授权主键；Google email 改变不转移 sub 或悄悄修改已有邮箱登录方式。[Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect) 和 [邮箱权威性](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token) 按提供方定义核对，email_verified 不自动等于当前第三方邮箱控制权。

| 已验证情形 | 结果 |
| --- | --- |
| 已知 sub/email identity 登录 | 进入其原 user，不因 email 找另一账号 |
| 全新 email identity 且无关联提示 | 原子建 user/identity/default workspace/Owner，重复不多建 |
| 未知 Google sub | 通用 Create account / Connect existing account，不泄露邮箱查重；新建须确认，连接须证明原方式 |
| 已登录添加方式 | 从 Account 发起，证明原方式与新方式后确认，不搬项目或订单 |
| OTP 后有同邮箱 Google 资料提示 | 暂缓自动注册，可证明原 Google identity 后明确关联 |
| 新 Google 对应已有 email identity | 只有 Google 邮箱权威性成立或本系统 OTP 已证明邮箱才提示；仍需原方式 proof+确认 |
| Google 邮箱非当前权威 | 不用该值公开查重/预留邮箱/阻止真实持有人注册 |
| 新方式已属于另一 user | 冲突，不转移 identity 或合并账号 |

所有 proof 绑定 flow/browser、purpose、精确 provider/subject、适用 target user、验证时间/期限/消费状态；原提供方 token 或旧码不继续接受。purpose=login 先得 login-resolution：已知 identity 直接登录，未绑定可待注册/关联。原 flow 可补原账号 proof；最终只原子派生/消费一个 register 或 link 意图，保留原时间和截止。最终确认前新 identity 仍未绑定可改选独立注册，不复制证明、不允许双分支成功；固定 link/register 不换用途，任何 login-resolution 不转 reauth。

只有原始 login-resolution 可未知 Google 新建或独立注册；Account 的 link 和 reauth 失败不能降级注册。原账号 proof 必须是它已关联的方式、精确 sub，不能另一同邮箱 Google 账户替代。匿名双方 proof 可在同 flow 固定目标 user，不必先建立 session；Account 发起从开始固定 user/session，最终仍需原有效会话，不中途换目标。

确认时重查双方 proof、期限、账号、适用 session 和 identity 唯一性，再原子关联并轮换/签发会话。客户端不能用新 email/provider/userId 替代已验证对象；重发不延长 proof。新 identity 仍未绑定但无法/不愿连原账号时，可明确选择 Create a separate account，说明项目和订单不带入、原方式仍进原账号、P0 不合并成型账号；已绑定 identity 只能进原账号。并发关联/注册只有一个提交，其余全部回滚，不留孤立 user/workspace。得到原账号证明前不展示其工作区、账单或其他身份。

P0 只添加方式与撤销会话，不提供自助解绑、任意换邮箱或合并已有账号；支持人员不能凭一封邮件/付款截图改身份归属。关联不改变 user、project、workspace 和订单 ID，也不增加或重置试用领取资格、使用次数或系统预算。

## 6 Google、session 与敏感操作

Google authorization code flow 由同源 POST /api/auth/google/start 创建一次性 state、nonce、PKCE S256，303 固定授权端点；GET callback 验 state/PKCE/JWT 签名/issuer/audience/expiry/nonce/purpose。仅 openid/email/profile，不请求 Drive/YouTube/发布权限。环境回调与密钥隔离。

拒绝授权、错误、过期/重放不建会话，保留合法任务。关联和 reauth 都需新 provider 往返或新 OTP，不能用旧 id_token、账号选择器、普通导航或长期 Cookie 替代。reauth 选错/未关联身份就拒绝并保留原有效 session，不注册、不关联、不改 actor。

应用 Cookie `__Host-promobento_session`：至少 32 字节随机 token，D1 只保存 hash、user、创建/到期/撤销和安全版本；Secure/HttpOnly/SameSite=Lax/Path=/，无 Domain。每次授权校验 session 与当前 membership；新登录/关联轮换当前 token，不把匿名 flow token 升格为 session。30 天绝对到期，Max-Age 不超过剩余期限。

logout_all、transfer_owner、delete_workspace 需要对应 actionIntent。原请求先验 session/Origin/CSRF/角色/资源/版本，缺证明返回 403 AUTH_REAUTH_REQUIRED 和 params.actionIntentId，不执行业务。意图固定 actor、原 session、动作、资源、target、版本和规范化请求摘要；reauth 只验该 actor 已关联方式。

证明后保持原业务 requestId/字段并附 actionIntentId 重提；校验原 session、上下文、摘要、证明，再原子消费 proof+业务更新。改 target/工作区/版本需新意图。摘要不含 CSRF/actionIntent 等传输字段；先前 403 不缓存成幂等成功。不同敏感动作不能复用 proof，也不用最近会话活动代替。

P0 账号关闭按 `auth.accountClosure` 走客服邮件人工流程，不提供自助关闭 API，也不增加专用动作证明。邮件用于联络；客服引导用户通过该账号已关联的方式重新登录，并在这个新会话中提交明确的关闭申请。已绑定的 email_otp 使用新 OTP；Google 使用新提供方往返并匹配原 identity 的 issuer/sub，不能把资料中的同邮箱当成已绑定的邮箱身份。支持工单须关联这次登录记录、服务端 user 和关闭意愿；普通旧会话工单、来信或付款截图都不能单独证明本次授权。无法完成核验时不执行关闭。客服先处理工作区所有权及在途订单，保留必要的核验和处理记录，再关闭账号并撤销全部会话，告知必须保留的记录。关闭不等于退款，媒体与必要记录按 04/05 处理。

POST logout 的 scope 默认 current，非法值 422。current 有 session 正常验 Origin/CSRF 后撤销/清 Cookie；无有效 session 时同源检查后清无效 Cookie，204 幂等，不要求不存在的 session 来验证 CSRF。all 必须原有效 session+logout_all proof，原子撤销全部含当前。退出返回登录/公开页，不删除主题或项目，不取消已付渲染；短期下载授权按独立期限，不承诺收回已下载文件。

认证 mutation（登录前发码、start、关联、注册、取消 flow、退出）均执行同源与 flow/session CSRF，上述无 session current 为明确例外；SameSite 不替代 CSRF。Google callback 走 state/nonce，Waffo webhook 独立验签。flow Cookie `__Host-promobento_auth_flow` 同样 host-only/HttpOnly/Secure，最多 30 分钟，不进入视频/账务/分析。

验证码或 Google 已验证但待注册/关联确认，以及 reauth proof 未提交，都仍 pending，不清 flow。最终成功、取消或过期才终止，必要脱敏完成记录可短留以支持恢复。flow/challenge/actionIntent 到期后 24h 内删临时邮箱/hash/摘要/proof，只保留脱敏安全和受限反滥用计数；正式 identity/session/业务记录独立保留，原码始终不持久化。

## 7 邀请与审阅

Owner 复制 /invite/:token 邀请链接，48 小时有效、限一次接受、可撤销，不自动发邮件。GET、预取和扫描只展示有限信息；登录后显示当前身份，用户可切账号，并须明确点击 Join workspace。

接受事务校验 token/撤销/期限/工作区/成员/3人上限；最后名额只一个新成员成功。已是成员不重复占位；已成功接受后同用户仍有权限时幂等返回，后来被移除/工作区不可用返回 404，不恢复资格。其他用户不能重放消费。nextPath 固定 /app/projects?workspaceId=<acceptedWorkspaceId>，不自动回 create/新建项目；默认工作区、个人项目和 Owner 不被邀请覆盖。转移/删除按对应 reauth proof，工作区始终保留一个 Owner。

审阅默认 7 天且不晚于项目期限，只看指定版本及必要媒体。独立 review loader 不转调成员完整项目 API；不能拿 token 读账务、源码或其他版本。撤销立即停止新授权，已有短期媒体授权按其独立期限，只读同范围。

## 8 邮件集成与错误

采用 Cloudflare Email Service 的 Email Sending 和 send_email binding/env.EMAIL.send，不用仅收转邮件的 Routing 代替。所需套餐、域名 onboarding、额度和提供方当前状态按 [概览](https://developers.cloudflare.com/email-service/)、[发送接入](https://developers.cloudflare.com/email-service/get-started/send-emails/)、[Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) 在目标账户核实，不能靠配置存在宣称可发信。

正式 PromoBento <login@auth.promobento.com>，预发布 PromoBento Preview <login@auth-staging.promobento.com>；sender binding、DNS 认证和环境隔离，Reply-To 仅在 support@promobento.com 实际收件验证后启用。新增邮件子域不改变 session 域，不擅改已有 MX。上线前查实际信誉/额度，配置发送预算、退信监控；失败不静默更换提供方。来源：[域名](https://developers.cloudflare.com/email-service/configuration/domains/)、[邮件认证](https://developers.cloudflare.com/email-service/concepts/email-authentication/)、[额度](https://developers.cloudflare.com/email-service/platform/limits/)。

验证码邮件为英语，正文含 code、用途、实际期限、非本人说明及验证过的支持入口，HTML 转义且文本可读，无客户媒体、促销、附件、跟踪图片，不在 subject/preheader 放码。本地/CI 默认 mock，不开启真实 remote binding；真实送达只在明确预发布与受控收件地址验证，生产无调试旁路，测试码不写共享 CI 日志。[本地开发](https://developers.cloudflare.com/email-service/local-development/sending/)。

| code | HTTP 与恢复 |
| --- | --- |
| INVALID_EMAIL | 422，修改格式 |
| AUTH_RATE_LIMITED | 429/Retry-After，不暴露账号状态 |
| AUTH_CODE_INVALID_OR_EXPIRED | 400，检查或重发，不清错误预算 |
| AUTH_ATTEMPTS_EXCEEDED | 429，当前 flow 结束，冷却后重来 |
| AUTH_FLOW_EXPIRED / AUTH_RESTART_REQUIRED | 409，保留任务重新验证 |
| AUTH_EMAIL_UNAVAILABLE | 503，重试或已关联 Google，不绕验证 |
| AUTH_LINK_CONFLICT | 409，证明身份后显示，保留原账号 |
| AUTH_REAUTH_REQUIRED | 403，操作绑定 actionIntentId，重验后重提原动作 |

统一错误外壳见 04；到期信息仅授权 flow 可见，用户提示英语化，提供方原错误只保存安全分类。

## 9 AUTH/URI 验收

| ID | 必须覆盖 |
| --- | --- |
| AUTH-01 | 双登录方式、两创建入口、邀请/订单返回，选择来源主题保留，无自动接受邀请或假付款 |
| AUTH-02 | 过期、5次错误、重发旧码、跨浏览器/purpose、证明/flow 截止、pending 不提前清理 |
| AUTH-03 | 同码并发、重复发码、首次注册竞态、响应丢失；一个账号/workspace，原码不签第二 session |
| AUTH-04 | 双向关联、同邮箱、非权威 Google email、资料变更、身份冲突/独立注册，不转移或枚举 |
| AUTH-05 | Origin/CSRF/state/nonce/PKCE、重放、恶意 returnTo、404/405，无开放跳转或 GET 副作用 |
| AUTH-06 | 当前/全部退出、关联轮换、绝对到期、成员移除、跨环境 Cookie，已付交付保留 |
| AUTH-07 | 发码滥用、共享 IP、格式/大小写/IDNA、换邮箱、未知发送结果，额度不可绕过 |
| AUTH-08 | 最后名额、重复/过期/撤销邀请、移除后重放和分享越权，无 Owner 丢失 |
| AUTH-09 | 实际 Cloudflare 与受控 Gmail/Outlook/自定义域接收，记录接受/到达并在实际期限内成功登录 |
| AUTH-10 | 同 user 跨工作区/关联登录方式并发仅一次试用；Owner 自领、Editor 共享、邀请/删除/转移不重置；领取失败仍可建空稿先购 |
| AUTH-11 | 关闭申请通过支持邮箱人工受理；身份/账号控制权或明确关闭意愿未核实、所有权或在途订单未处理时不得执行；核验与处理记录可追溯，完成后撤销全部会话；不依赖未实现的自助 API |
| URI-01 | 所有注册路径、默认跳转、深链接、404/405/410、robots/sitemap，无空语言或假 200 |

安全依据：[一次性验证/防枚举](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)、[会话管理](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。上述期限和次数是产品策略。实际登录、发信和会话验收与配置检查分别记录。
