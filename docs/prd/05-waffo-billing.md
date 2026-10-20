# Waffo 支付与权益

本章定义当前商品、订单、退款和成片权益。创作操作计量由 [14](14-production-contracts.md) 补充，不能覆盖本章购买保障。真实收款需通过商户、域名、签名、订单查询和收款退款验收。

## 1 商品和购买意图

P0 使用 Waffo Pancake，一次性项目包及追加包，无自动续费、提现余额或跨项目通用充值。目录币种 USD；实际支付方式取商户已开通能力。

| SKU | 目录价 | 条件 | 授予当前项目 |
| --- | --- | --- | --- |
| `project_v1` | US$39 | 有有效素材及确认快照，未购买初始包 | 3 个成片版本、5 次整片创作、15 次局部改稿、20 段及 1,200 秒素材处理预算 |
| `extra_versions_v1` | US$12 | 已购、未清理且资源可恢复 | 3 个成片版本、2 次整片创作、10 次局部改稿、20 段及 1,200 秒素材处理预算 |

SKU 是稳定商品 ID，不随文档修订重命名。素材处理预算是累计处理权益，不放宽 01/输入配置对同时保留素材数、单段格式/时长和总上传的限制。免费项目次数见 01 与 agent-policy；删除项目不返还已用免费次数。

订单保存 `purchase_intent`：初始包固定 `purchase_and_export`，必须有已确认 snapshot；追加默认 `top_up_only`，可无 snapshot，不触发编码。用户明确选择 `purchase_and_export` 的追加包只导出其已确认快照。test/production 商品 ID、商户和密钥分离。

有效项目正常截止取仍有效购买中最大成功付款时间加 90 天，延迟回调不得使日期倒退；追加延长未用余额，退款按有效购买重算。`access_expires_at` 与 `media_delete_after` 分开，正常到期后 7 天只读宽限。

## 2 内容身份、快照与消费

收费身份为 `UNIQUE(project_id, content_hash)` 的 release，**不是 snapshotId 或 revisionId**。`contentHash` 算法以 14 与参考测试为准；同内容恢复、重新 QA、重排目标记录顺序、仅修改非渲染 styleLabel 不产生新消费。新请求若内容已存在，返回原 release 及原购买快照，不用当前草稿重新装配已购文件；请求键相同但 body 不同仍按幂等协议返回 409。

snapshot 是不可变的确认收据，保存完整 Composition、事实证明、全部合法 target 的来源、依赖、音轨、封面、规则和 renderer。新 snapshot 可指向同一内容身份而不产生第二次扣费。只有改变实际内容指纹并导出才消费新版本；不用 AI 相似度判断收费，也不以“换了宣传主题”为由拒绝合法项目编辑。

提交新内容导出时原子预留 1 个版本，固定 `initialTargetIds` 和初批文件清单；每个所选目标有 video、cover、mapping 三种逻辑产物。全部通过编码和内容 QA，且 reservation 有效、grant 未冻结、项目未删除，才原子写 ready、consume、published_at 并开放下载。等价逻辑文件可复用物理对象，ZIP 随后派生，不决定消费时点。

部分失败只重试失败文件；首次完整发布前不下载零散结果。最终失败释放预留，同 release 重试可新建 reservation，但 consume 按 release 唯一。每个 reservation 的释放幂等，同 release 同时最多一个有效预留。队列重复投递不增加消费。

补平台只运行该 snapshot 已冻结来源，不调用 Agent，不扩大首次清单、不新预留或消费，不把已交付 release 退回未交付。补平台失败保留原文件并免费恢复。重新下载、ZIP、授权刷新和系统兼容修复均不另收成片版本。

## 3 独立状态

| 实体 | 当前状态值 | 边界 |
| --- | --- | --- |
| 订单 | created / checkout_open / awaiting_confirmation / paid / expired / canceled / review_required | 提供方付款事实不能被旧 pending 消息降级 |
| 退款 | requested / processing / succeeded / failed | 申请成功不等于资金已退回 |
| 导出 release | reserved / rendering / ready / failed / cancelled | 与 exportManifest Schema 同名；snapshot 单独保存，不是 release 状态 |
| 权益预留 | reserved / consumed / released | 唯一操作与审计，不靠 paid 布尔值代替 |

订单的 `canceled` 和创作/导出的 `cancelled` 属于各自当前协议，不混用序列化字段。付款返回页只读取权威状态；用户关页不取消已付交付。

## 4 提供方适配与来源

以下是用于实现的提供方协议参考，不是本仓库已完成集成的声明。实施时核对官方 SDK/文档和实际账户并冻结适配版本；具体签名与单位不得由其他支付商经验推断。

| 任务 | 接入契约 |
| --- | --- |
| SDK | `@waffo/pancake-ts`，在 workerd 验证，不以 Node 单测替代 |
| Checkout | `POST /v1/actions/checkout/create-session`；服务端 Merchant API Key、orderMerchantExternalId |
| 提供方幂等 | 显式 X-Idempotency-Key，本地长期唯一约束独立保留 |
| 付款事件 | order.completed 仅触发核验，不能直接凭浏览器返回授予 |
| 查询 | Orders & Payments 查询业务订单与 provider payment |
| 退款 | `POST /v1/actions/refund-ticket/create-ticket`；独立退款业务号，查询执行结果 |

来源：[API/幂等](https://docs.waffo.ai/api-reference/introduction)、[Checkout](https://docs.waffo.ai/api-reference/endpoints/orders/create-checkout-session)、[Webhook](https://docs.waffo.ai/api-reference/webhooks)、[订单查询](https://docs.waffo.ai/api-reference/endpoints/graphql/orders-and-payments)、[退款](https://docs.waffo.ai/api-reference/endpoints/refunds/create-refund-ticket)。

## 5 创建 checkout

1. 验 Owner、项目可恢复、SKU 条件、意图；需要导出时校验事实和全部 target 来源/QA，缺项返回 VARIANTS_NOT_READY，不创建 checkout。
2. 显示不可变 snapshot、封面、时长、首次目标、价格、税费、权益和保存期；只增额度不隐式消费版本。
3. Billing DO 与 D1 活动槽先原子 get-or-create 同项目/SKU 的活动订单，保存意图、价格/政策、币种、商品 ID、项目及快照，再调用提供方，不能先并发创建多个可付订单。
4. 意图和 snapshot 一致才无提示复用；不一致显示原订单/快照，让用户明确继续。创建另一会话前确认原会话不可支付，或安全过期并对账；本地 canceled 不证明外部不能收钱。
5. 服务端 Merchant API Key 请求携带业务订单号和受控 metadata，不以浏览器 Store Slug 模式替代需要的服务端字段。持久化高熵幂等键和请求体，未知结果只用同键重试/查询，不能马上另建订单。
6. successUrl 取可信 appUrl 与 `/app/billing/orders/{localOrderId}`，正式为 promobento.com；ID 服务端生成。会话 1,800 秒是内部策略，不使用任意 Host/前端 origin。
7. 新会话 language=en，darkMode 仅取合法 resolvedTheme，未知默认 Light。已存在会话和未知结果重试请求体不因主题切换改变，更不能因此重复创建订单。

提供方返回行为按实测适配：当前设计不依赖 cancelUrl 或取消 webhook；买家未点击 Done、关页、支付拒绝或 session 过期都由本地状态及权威查询处理。付款期间编辑另存草稿，交付读取原 snapshot，不用新封面冒充原购买内容。

## 6 签名、金额与事件核验

提供方适配需验证出站 RSA-SHA256/秒级时间戳、入站原始 body 与 X-Waffo-Signature/毫秒时间戳及签名覆盖格式。参考协议给出的 45 分钟重试容忍窗口不能替代业务去重；实施测试用原始字节及官方测试向量锁定，不能混淆两种时间单位。

限制 body 大小，验签，核对环境/store/事件，可靠写 inbox+outbox 后再 2xx（内部目标 10 秒）；数据库失败返回可重试错误。Inbox 唯一键为 environment/store/eventType/eventId，订单及 provider payment ID 另有唯一约束，不同包装事件也不能重复授予。测试事件不能授予生产权益。

order.completed 核对本地订单、provider 商品、币种、价格快照、付款 ID；不匹配进入 review_required，不按付款邮箱猜用户。金额是整数最小单位，提供方 display-format 字符串等明确转换，不用浮点。目录、税额、渠道实付、商户净结算分别保存；不强行要求含税实付等于 3,900/1,200 美分。

价格页说明税费由 checkout 展示；商户明确含税/另税分类。P0 不自行优惠、换汇或接受前端价格覆盖。金额/币种/商品不一致人工核查，不能静默改账。

## 7 原子授予、对账和迟到付款

单一事务标 paid、记录付款、授予 grant、更新期限、处理 inbox；purchase_and_export 同事务创建导出 intent+outbox，top_up_only 不产生导出。任一步失败可识别恢复，不留 paid 无权益。回调、返回页、Cron 并发收敛到一份 grant/首次导出；发送失败由 outbox 补发，渲染失败不改写付款事实。

返回页查询提供方同订单最多每 15 秒一次；Cron 每 5 分钟扫描，24 小时仍未知转人工核查，不当作提供方交易终止。迟到成功按事实恢复权益。两笔误重复初始包成功付款，默认经核实原路退款第二笔，不自动转成未选择商品。素材已清理后迟到付款先确认交易，再提供重新上传恢复或退款，不虚构可导出内容。

## 8 退款与权益仲裁

产品退款政策在适用商户条款和消费者权利范围内执行：初始包付款 7 天内且无成功交付版本可申请全额退款；系统持续无法交付或确认重复扣款进入全额退款。已交付的技术缺陷先免费修复，无法修复再退款。追加包新增版本未使用时可在 7 天内申请退款。

用户提交退款申请，核验后用唯一 refundTicketMerchantExternalId 和原币种 display-format requestedAmount.amount 发起；processing 期间不能声称到账，成功由真实事件或权威对账确认。

退款接受和首次交付经同一 Billing DO/事务仲裁。冻结 grant 的 available/reserved，暂停关联发布；冻结先发生则晚到 worker 不消费/发布，发布先发生按已交付政策判断。退款失败解除冻结并恢复同一 reservation/release；成功撤销未用权益并取消相关预留。消费按有效 grant 成功购买时间顺序分配，保留明确关联。

部分退款、已消费额度、多追加包由管理员明确处理，不用模糊比例自动退款。客户 P0 申请整笔退款。初始包全退而存在有效追加单时，列出关联订单，Owner 明确确认后对符合条件的未用追加各自幂等退款；已用或无法一起处理转人工核查，不能留仍付费却无法使用的权益。

没有有效购买才回到受限状态，失败退款或有效追加仍保有权益。期限按有效购买重算；媒体清理不早于通知后 7 天，也不早于其他有效购买正常截止+宽限。告知期只允许查看/按政策下载，不恢复已撤销编辑/AI/导出。退款回调不立即销毁媒体，财务审计可按权限查询。

## 9 商户上线、费用与测试

真实收款前准备 merchant/store/product ID、test/production 密钥/公钥、Webhook、税务分类、结算币种、支持渠道、政策、真实主体/结算资料、域名验证及商店审核。品牌不能代替 legalEntityName。预发布只给精确机器回调路径必要 Access 例外，仍验签/环境/商户；不得公开整个预发布应用。

来源：[域名验证](https://docs.waffo.ai/settings/domain-verification)、[AI 产品审核](https://docs.waffo.ai/mor/account-reviews/aigc-compliance)、[费用](https://docs.waffo.ai/mor/fees)。不将公开费用参考视为当前商户合同；按实账记录成功/失败支付、税、退款、提现分摊、AI、素材、全部目标准备/编码、存储、交付和人工支持，贡献不等于净利润。

验收包括成功、拒付/重试、关页、不点 Done、过期、丢回调查询、重复乱序、不同包装事件、错误签名、环境混用、税/单位/币种/商品篡改、并发 checkout/最后版本预留、付款后队列故障、清理与迟到付款、误双付款、退款申请/成功/失败/重复、退款与发布竞态、追加只增权益或明确同时导出。测试/赠送/真实交易在报表中分开。

## 10 创作次数与冻结来源

creative_generate 与 agent_patch 先预留，可用候选交付时分别消费一次。方向、作曲、构建、最多两轮内部修复不拆次数；此前系统失败/取消释放，交付后审美拒绝不返次，证实技术缺陷可幂等补偿。prepare_targets 为同内容的免费准备，受独立成本预算与去重约束，不新增隐含 SKU；详见 14。

付款后补平台不再次创作。系统缺陷/兼容性修复建立链接到原 release 的独立 correction revision 和文件，保留原收据及输出，不覆盖原版、不消费新版本。正式契约与测试只使用当前 Schema 和关联样例，不能用非执行的示例 hash 或参考测试冒充生产结果。
