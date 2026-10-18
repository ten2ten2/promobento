# Waffo 支付与权益

## 1 支付产品决定

支付提供商固定为 Waffo.ai，使用其 Pancake 商户服务。P0 仅售一次性项目包与追加包，不提供自动续费、套餐订阅、可提现余额或跨项目通用充值。

| 内部 SKU | 目录价 | 购买条件 | 授予项目权益 |
| --- | --- | --- | --- |
| `project_v1` | USD 39.00 | 有有效素材与可预览快照，项目未购买初始包 | 3 个成片版本、5 次整片分镜、15 次局部改写、20 段及 1,200 秒素材处理预算 |
| `extra_versions_v1` | USD 12.00 | 已购买项目包，项目未清理且有可恢复素材 | 3 个成片版本、2 次整片分镜、10 次局部改写、20 段及 1,200 秒素材处理预算 |

同项目所有有效未用权益共用正常使用期限，按仍有效购买中最大的提供商成功付款时间加 90 天计算；不按回调到达顺序覆盖。追加付款同时延长旧余额，退款按仍有效购买重算。`access_expires_at` 与 `media_delete_after` 分开保存，正常到期后媒体宽限为 7 天。无自动扣款。免费次数与已购次数分别记录，删除项目不能返还已消耗的免费额度。

订单包含 `purchase_intent`：初始包固定 `purchase_and_export`，必须有已确认 snapshot；追加包默认 `top_up_only`，snapshot 可空，不启动导出。追加包可明确选择 `purchase_and_export`，付款后导出其指定快照。

Waffo 中创建两个对应的一次性商品，test 与 production 的商品 ID 独立配置。币种 P0 为 USD。具体支付方式使用该商户、商品类型和币种实际支持的选项，界面不提前承诺尚未开通的渠道。

## 2 成片版本计费语义

一个版本冻结内容、视频语言、素材、录屏选段、音轨、时长、四种构图、封面、视频样式、renderer 和平台预设版本。平台勾选集合不是新版本身份，因此补选平台不重复扣额度。界面语言、System / Light / Dark 和 Waffo 收银台外观不参与成片版本身份，不改价格或 USD 币种。

普通草稿修改不扣成片额度。首次导出一个新快照时，原子预留 1 个版本。相同快照的重复点击返回已有 release 或 job；不同快照需要新的额度。不能使用主题相似度或 AI 判断决定用户的收费边界。

首次预留固定 `initial_artifact_manifest`，包括首批所选平台的 MP4、封面与映射清单。全部校验成功且 reservation 有效、grant 未冻结或撤销、项目未删除时，原子写 `ready + consume + published_at` 并开放下载。并发补平台不扩大首批清单，在首次交付后继续生成；release 一旦已交付，不因补平台退回未交付。ZIP 是随后生成的派生下载，免费重试，不决定首次消费时点。

部分平台失败只重试失败文件；在首次整批交付前，中间文件不开放下载。最终失败释放预留，同一版本重试可以再次预留，成功消费仍按 release 唯一。下载接口检查批次发布状态，不能仅依据单个文件 ready。

已交付版本补选平台不需要新预留。新平台失败不影响已有文件，系统继续免费恢复失败文件；不能因此再次收费或自动撤销已交付版本。重复下载、ZIP、授权链接刷新、系统兼容性修复不扣新版本。

每次预留使用独立 `reservation_id`，同 release 同时至多一个有效预留；`consume` 按 release 唯一，`release` 按 reservation 唯一。重试不会通过重复账本行创造余额。

## 3 本地状态模型

订单、退款、项目权益和渲染各自有状态，不能挤进一个 `paid` 布尔值。

| 实体 | 状态 | 重要说明 |
| --- | --- | --- |
| 订单 | `created`、`checkout_open`、`awaiting_confirmation`、`paid`、`expired`、`canceled`、`review_required` | 已确认支付不被旧 pending 事件降级；过期记录仍允许通过权威对账纠正 |
| 退款 | `requested`、`processing`、`succeeded`、`failed` | 退款申请成功不等于钱已经退回 |
| 成片版本 | `draft_snapshot`、`reserved`、`rendering`、`ready`、`failed`、`canceled` | ready 首次发生时消费额度并开放下载 |
| 权益预留 | `reserved`、`consumed`、`released` | 每个转换有唯一操作 ID 和审计记录 |

前端付款返回页只读取服务端状态，不负责创建权益。用户付款后关闭页面，回调和 outbox 仍应推进已确认快照的导出。

## 4 Waffo 的公开接口映射

以下为本次从官方文档核查的接入点；实施时锁定版本并用测试环境校验。

| 任务 | 官方能力 | 实施要求 |
| --- | --- | --- |
| TypeScript SDK | `@waffo/pancake-ts` | 在 Cloudflare workerd 验证签名与请求；不假定 Node 环境测试即可证明兼容 |
| 创建收银台 | `POST /v1/actions/checkout/create-session` | 服务端 Merchant API Key 模式，记录 `orderMerchantExternalId` |
| 收银台语言与外观 | `language`、`darkMode` | 新会话默认 language=en；darkMode 来自校验后的有效主题，不影响订单幂等或价格 |
| 写操作幂等 | `X-Idempotency-Key` | 显式传入，SDK 不自动生成；本地仍永久按业务 ID 去重 |
| 一次性付款成功 | `order.completed` | 验签、匹配订单与商户、持久化，然后幂等授予权益 |
| 查询订单及支付 | Waffo GraphQL Orders & Payments | 以业务订单号与 provider ID 对账 |
| 申请退款 | `POST /v1/actions/refund-ticket/create-ticket` | 使用唯一退款业务号；等待执行结果 |

来源：[Checkout](https://docs.waffo.ai/api-reference/endpoints/orders/create-checkout-session)、[API 与幂等](https://docs.waffo.ai/api-reference/introduction)、[Webhook](https://docs.waffo.ai/api-reference/webhooks)、[对账](https://docs.waffo.ai/api-reference/endpoints/graphql/orders-and-payments)、[退款](https://docs.waffo.ai/api-reference/endpoints/refunds/create-refund-ticket)。

## 5 创建订单与付款快照

1. Owner 选择购买意图，服务端重新验证权限、项目可恢复状态和 SKU 条件；需要导出时还校验当前 revision、素材和事实。
2. `purchase_and_export` 固化四种构图及音视频内容，返回用于确认的 snapshot ID，展示封面、时长、平台与价格；`top_up_only` 仅显示新增权益和期限，不隐式消费版本。
3. 通过项目 Billing DO 与 D1 活动槽原子 get-or-create 同项目同 SKU 活动订单，保存意图、目录价、币种、商品 ID、workspace、project、snapshot 和政策版本。金额与权益从服务端配置读取；先完成活动槽争用，再调用提供商，不能各建一笔订单后才查重复。
4. 只有意图与 snapshot 一致才无提示复用会话。若活动订单关联旧稿，返回原订单与原快照供明确继续或返回草稿，不修改旧订单也不用新稿封面。创建新会话前按提供商能力确认旧会话不可支付，或等安全过期并对账；不能仅本地 canceled 就认为外部无法收费。提供商请求使用持久化的高熵幂等键，重试复用该键。
5. Waffo 请求使用 Merchant API Key；提供 `orderMerchantExternalId` 和受控 metadata。不要用浏览器 Store Slug 模式创建依赖这些字段的商业订单，因为该模式会忽略相关服务端字段。
6. `successUrl` 从可信环境 `appUrl` 与 `/app/billing/orders/{localOrderId}` 组合为绝对 HTTPS 地址；正式值为 `https://promobento.com/app/billing/orders/{localOrderId}`，localOrderId 必须服务端生成并校验。会话有效期设为 1,800 秒，这是本产品决定。
7. 首次创建会话时传 `language: "en"`。显式 Dark 对应 `darkMode: true`，Light 对应 false；System 由前端将当时的有效主题作为 `resolvedTheme` 提示发送，服务端仅接受 light/dark，缺少时用 false。外观提示不允许改变商品、金额、回跳域或购买意图。

Waffo 当前成功后由买家点击 Done 返回，且没有 `cancelUrl`。项目页保留继续付款入口，放弃收银台通过本地过期和对账处理，不等待并不存在的取消通知。

Waffo 的 language 设置收银台默认界面语言，与用户视频文案无关，买家可在其支持范围内切换；钱包、银行验证和 Google 登录等第三方界面由提供方控制。已有活动 session 沿用创建时外观，切换站内主题不能触发第二个可付款 session，也不能改变已经持久化的提供商重试请求体。恢复站内后使用站内保存的主题与英语 UI。[官方语言与外观字段](https://docs.waffo.ai/api-reference/endpoints/orders/create-checkout-session)

服务端请求超时意味着结果未知，不意味着订单未创建。先用相同幂等键安全重试或查账，不能立即另造一个可支付订单。Waffo 的幂等缓存窗口不替代本地长期唯一约束。

付款期间新编辑进入其他草稿 revision；订单指向原快照，后台自动导出也只读取原快照。额外包购买可以仅增加额度，或在确认面板选择同时导出一个已冻结的新版本。

## 6 签名与回调处理

出站按 Waffo 官方 Merchant API 认证使用 RSA-SHA256，请求时间戳单位为秒。入站使用原始请求 body 验证 `X-Waffo-Signature`；其时间戳单位为毫秒，签名涵盖时间戳与原始文本。官方推荐 45 分钟重试容忍窗口，真正去重依据事件与业务唯一键，不能套用其他支付商的短窗口。[官方认证入口](https://docs.waffo.ai/api-reference/introduction)、[Webhook 认证](https://docs.waffo.ai/api-reference/webhooks)

处理顺序为：读取原始 body 并限制大小；验签；校验环境、商户 store 与支持的事件；持久化 inbox 和待处理 outbox；可靠写入成功后返回 2xx，目标在 10 秒内完成。数据库失败返回可重试错误，不先返回成功再寄希望于进程内任务。

Inbox 唯一键包含 environment、store_id、eventType、eventId。处理成功购买还需订单与 provider payment ID 的业务唯一约束，即使提供商重复包装成不同事件也不能重复发额度。测试回调打到生产端不能授予生产权益；验签 SDK 自动识别环境不等于本应用允许两个环境混用。

`order.completed` 只表示进入付款核验处理。系统匹配业务订单、商品、币种、价格快照和付款 ID；无法匹配进入 review_required，不猜测所属用户。金额字段按实际文档单位转换，不能将支付邮箱作为项目归属凭证。

## 7 税费与金额核对

本地保存 `catalog_amount_minor`、`currency`、`provider_product_id`、商品版本或价格快照、税处理模式、实际支付金额与退款金额。目录价与税额、渠道实际收款、商户结算净额是不同概念。

价格页显示目录价和适用税费的结账说明，最终金额由 Waffo 收银台显示；商户配置需要明确含税或另计税的处理。后端以已配置 SKU 以及 Waffo 权威订单价格快照核对交易，而不是无条件要求回调实付金额等于 3,900 或 1,200 美分。

测试必须覆盖有效税务场景、零税场景、金额被篡改、币种错误及金额字符串单位。P0 不自行优惠、换汇或接纳未知价格覆盖；发现报价与已配置商品不一致，保留记录并人工核查，不静默改账。

## 8 原子授予与首次导出

核验成功后的单个原子业务批次包含：订单标记 paid、记录 provider payment、写入权益 grant、更新项目期限、标记 inbox 已处理。仅当购买意图为 `purchase_and_export` 时，同批创建已确认快照的导出 intent 与 outbox；`top_up_only` 只增加权益和期限，没有渲染任务或额度消费。

若任意步骤失败，重试必须从可识别状态恢复，不能只把订单置为 paid 后丢失 grant。消费队列前再次检查 entitlement 与 snapshot，导出 intent 的业务 ID 保证首次导出只启动一次。

不同 webhook、支付返回页和 Cron 对同订单并行执行，必须收敛到一份 grant 和一份首次导出。创建 outbox 后发送失败由 dispatcher 补发。原始支付记录不能因渲染失败被改写成未支付。

## 9 对账与特殊情况

支付返回页可触发受限对账：同订单最多每 15 秒一次提供商查询，客户端可更频繁读取本地状态。Cron 每 5 分钟扫描待确认订单，超过 24 小时仍未知进入人工核查；该时长是产品运营策略，不是提供商交易一定终止的证明。

关闭收银台、失败尝试和 session 过期不保证收到 webhook。通过官方查询确认订单与付款记录；收到比本地过期更晚的真实成功付款仍应按事实恢复权益。

同项目若因边缘故障出现两笔初始项目包成功付款，第二笔进入重复付款处理，不能默默收钱却不给交付。默认对可确认的误重复购买发起一次原路退款，记录状态和原因；不自动把它转换成用户未选择的其他商品。

如果素材在长期延迟支付到来之前已被清理，先确认交易，禁止虚构可导出的项目；提供重新上传恢复或退款处理。支付入口在过期清理后必须关闭，正常用户不会被引导为已不存在的文件付款。

## 10 退款政策与实现

P0 在价格页与退款页公开以下产品政策，并以适用商户条款和消费者权利为边界：初始项目包在付款后 7 天内、尚无成片版本成功交付时可以申请全额退款；系统持续无法交付或可确认的重复扣款进入全额退款处理。已经交付但存在技术缺陷，先提供免费修复，无法修复再处理退款。追加包未使用所增成片额度时可在 7 天内申请退款。

用户提交的是退款申请。服务端在核验后使用官方退款接口，`requestedAmount.amount` 采用 display-format 字符串，币种匹配原付款，并传 `refundTicketMerchantExternalId`。请求完成仍可能处于 processing；通过实际退款事件或权威对账确认 succeeded，界面不能提前写“退款到账”。

退款接受与首次交付通过同一项目 Billing DO 和原子状态提交仲裁。冻结覆盖 grant 的 available 与 reserved，关联在途任务暂停发布，可暂存私有结果。冻结先发生时，旧 worker 不能再消费或发布；交付先发生时，按已交付条件重新判断退款资格。退款失败解除冻结并恢复同一 reservation 或 release，退款成功撤销未消费权益并取消相关预留。消费按有效 grant 的成功购买时间顺序分配，保留 grant 与 reservation 关联。

已消费额度、多个追加包和部分退款需要管理员明确处置。P0 客户自助提出整笔订单退款；部分退款保留后台人工流程，不自动按模糊比例计算。初始包全退且存在有效追加订单时，处理页面列出关联订单；默认把仍符合退款条件的未用追加订单一并纳入，Owner 明确确认明细后各订单建立独立幂等退款。已使用或无法一并处理的情况进入人工核查，不能留下仍付费却无法使用的追加权益。

只有不存在有效购买时，项目才回到受限状态。退款失败或仍有效的追加购买继续享有对应权益；已撤销的 grant 不能触发新导出。历史交易与退款记录仍可查询。

项目期限根据仍有效购买的最晚成功时间重算。媒体清理截止不早于通知后 7 天，也不短于其他有效购买正常截止后的宽限期；这个媒体告知期只允许查看或按政策下载已有文件，不恢复已撤销的编辑、AI 和导出权限。不得在退款回调中立即销毁素材。

## 11 Waffo 商户与上线配置

部署真实收款前准备 merchant/store/product ID、test 与 production 密钥及公钥配置、Webhook 地址、商品税务分类、付款与结算币种、支持邮箱、政策页、商户主体与结算资料，并完成域名控制验证及必要商店审核。

对外商店及商品品牌为 PromoBento；`legalEntityName` 仍使用真实商户主体，不用产品品牌代替。正式 webhook 为 `https://promobento.com/api/payments/waffo/webhook`；帮助、隐私、条款、退款页和支持地址统一取品牌配置。当前主域已选定，控制权、DNS/TLS、支持邮箱与 Waffo 生产域名验证均未在本次文档任务中完成。

预发布的 Waffo test webhook 必须能被提供方服务端访问：只对精确回调路径配置适当 Access/挑战例外，继续强制验签、环境、商户和事件校验。不得把整个预发布应用公开，也不能把浏览器已登录 Access 当作测试 webhook 连通证明。OAuth callback 同样按实际登录链路测试，保留 state/PKCE 与会话校验。

这些是提供商和真实收款环境的接入条件；开发可以先用 test mode 完成。不能写“未审核账号一定能生产收款”。Waffo 对 AI 产品可能有额外审核要求，应如实说明本产品使用 AI 生成脚本、用户真实素材与确定性模板合成，不假称接入不存在的真人或视频生成模型。

来源：[域名验证](https://docs.waffo.ai/settings/domain-verification)、[AI 产品审核说明](https://docs.waffo.ai/mor/account-reviews/aigc-compliance)。提供商审核分类以实际商户审核为准。

## 12 成本口径

Waffo 公开详细费用表当前列出卡及数字钱包成功交易 3.9% 加 US$0.50，也列出特定失败尝试、退款与提款费用。经营报表必须按实际渠道和商户结算记录计算，不能只扣一次成功交易费就声称得到净利润。[官方费用表](https://docs.waffo.ai/mor/fees)

每笔订单分别记录：实收、税款、成功与失败支付费用、退款、退款费用、提现分摊、AI、素材处理、成片渲染、存储、交付和人工支持。费用表是截至 2026 年 10 月 18 日的参考，最终使用实际商户费用与账单。

## 13 必须通过的支付验收

成功支付；关闭收银台；会话过期；支付拒绝后重试；用户不点击 Done；回调丢失后对账；重复与乱序回调；无效签名；测试与生产混用；两标签页重复购买；最后一个额度的并发预留；收款后队列故障；素材清理与晚到付款；退款申请、成功、失败和重复结果。

真实付款模式只能在已核验商品、域名、签名、环境与一笔完整收款退款流程后开启。测试交易和赠送订单在所有收入和转化报表中单独标识。
