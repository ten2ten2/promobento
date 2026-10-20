# 界面与用户流程

网站静态文案首发英语，客户视频原文可多语言混排。视觉数值以 [11](11-ui-design-spec.md) 和 UI tokens 为准；业务状态与权限不能由参考界面推断。

## 1 页面与信息架构

| URI | route ID | 最低入口边界 |
| --- | --- | --- |
| `/` | `public.home` | public；index |
| `/use-cases/software-promo-video` | `public.use_case.software` | public；index |
| `/use-cases/course-promo-video` | `public.use_case.course` | public；index |
| `/examples` | `public.examples` | public；index |
| `/examples/:slug` | `public.example` | public；index |
| `/formats` | `public.formats` | public；index |
| `/pricing` | `public.pricing` | public；index |
| `/create` | `create.entry` | public；noindex |
| `/login` | `auth.login` | public；noindex |
| `/login/verify` | `auth.verify` | auth_flow；noindex |
| `/login/link` | `auth.link` | auth_flow；noindex |
| `/invite/:token` | `invite.preview` | invite_token；noindex |
| `/app` | `app.index` | session；noindex |
| `/app/projects` | `app.projects` | session；noindex |
| `/app/projects/:projectId` | `app.project` | member；noindex |
| `/app/projects/:projectId/exports/:releaseId` | `app.export` | member；noindex |
| `/app/billing/orders` | `app.orders` | owner；noindex |
| `/app/billing/orders/:orderId` | `app.order` | owner；noindex |
| `/app/settings` | `app.settings` | session；noindex |
| `/app/settings/account` | `app.settings.account` | session；noindex |
| `/app/settings/appearance` | `app.settings.appearance` | session；noindex |
| `/app/settings/brand` | `app.settings.brand` | member；noindex |
| `/app/settings/members` | `app.settings.members` | member；noindex |
| `/review/:token` | `review.preview` | review_token；noindex |
| `/help` | `public.help` | public；index |
| `/privacy` | `public.privacy` | public；index |
| `/terms` | `public.terms` | public；index |
| `/refund-policy` | `public.refund_policy` | public；index |
| `/admin` | `admin.index` | access_admin；noindex |
| `/robots.txt` | `seo.robots` | public；not_applicable |
| `/sitemap.xml` | `seo.sitemap` | public；not_applicable |

此表与 [路由配置](../../config/routes.json) 同步校验；默认跳转、returnTo、认证、邀请和真实 HTTP 错误按 [12](12-routing-and-auth.md)。

## 2 首页与首次进入

主文案：Turn your product or course into a promo video. 辅助：Use your real assets. Direct the motion, refine any frame, and export for your channels. 两类用途入口同层级；样片使用授权素材或明确测试品牌，SSR/搜索按 07。

头部为 44 px 太阳/月亮按钮，图标表示下一步动作；默认 System，点击记住显式选择，Settings 与公开页脚 Use device setting 恢复。不改变视频、播放器位置、未保存字段或订单。首次入口就说明“每账号一次免费样片，正式文件 US$19 起；继续创作可购买 US$39 项目包”，真实商品值来自服务端目录。素材上传、预处理、方向卡和生成前均须登录；登录跳转不假定浏览器文件授权一直存在，不提供匿名素材/方向流程。

## 3 创建与生成

流程：Setup → Assets → Details → Creative direction → Studio。软件入口可默认 YouTube/X，课程入口可默认 Reels/TikTok，六平台始终可选。时长默认 30 秒，仅可另选 15 秒；Feed 方形是该平台的选项，不是任意平台通用画幅。

登录后创建可先保存空 draft。Owner 明确选择使用一次免费试用时提交 `requestTrial=true`，默认 false；服务端按其内部 user_id 跨工作区原子领取并绑定一个项目。不可用或并发已领取时仍可建稿，返回 `trialStatus=unavailable`，不偷偷扣其他成员资格；显示既有试用项目（仅有权限时）或“Buy project pack — $39”先购创作入口。该新稿未付费前不能上传、处理素材、取方向卡、调用 AI、云预览或运行目标 QA；合法复制的素材引用可保留、按权限读取。Editor 只使用共享项目已有额度，无个人领取按钮；需要购买时复制链接交 Owner，不自动发消息。

复制项目保留当前有权读取的不可变素材和源包引用，不继承原项目的购买快照、QA 授权或处理/创作/成片权益。普通参数可本地编辑，新上传、云预览、QA 或创作前先购 US$39 项目包；不能仅凭复制来的成片或相同内容哈希显示 US$19 已可导出。

上传显示实际大小、编码、处理进度、恢复入口及录屏起止/焦点。至少一份合法视觉素材可继续。事实面板展示产品名、受众、卖点、可选报价/日期和 CTA；确认默认未选，模型不能代勾。网址只作为背景/CTA，不自动抓取。

公开 returnTo 的 `platforms` 只包含平台 ID，解析时取其合法默认构图；创建界面明确选出的 `targetIds`（包括 Feed 方形）保存在服务端 flow/草稿上下文并重新校验，不放宽认证返回 URL allowlist。恢复登录后保留已选择目标，不把方形悄悄改回默认。

点击生成前说明当前项目的来源和剩余额度：免费样片含 1 次成功整片、最多 3 张方向卡和 2 轮 AI 改稿，正式导出需付费。整片/改稿轮各消费相应 1 次成功额度，可用候选交付才扣次，内部修复不另扣；无可用结果不扣用户次数，已发生系统费用仍计入预算，不能靠重试重置。Director 按需展示三个实质不同方向的真实关键帧；明确指令或直接生成不要求再次三选一。方向刷新受同一操作和系统预算限制，无视频语言选择或识别确认门槛。

阶段显示排队、理解、方向、难镜头、代码、音频、实际帧检查与候选可用；有真实数据才显示百分比。等待用户和预算暂停保存工作并释放计算，恢复/取消按 14。不存在可销售 SKU 时不显示“付款解锁继续”。

## 4 Studio、改稿和声音

桌面为 248 px 镜头标记栏、弹性画布、320 px 属性/AI 面板；允许任意镜头数或连续一镜到底。时间线使用整数帧，音画共用时钟。Content / Media / Layout / Audio / AI Edit 分组，已结构化变量可在本地不限次编辑且不调用模型。替换素材若需新上传、预处理、QA 或云预览，展示独立的可用状态与预算限制；不把“参数编辑不限”写成“无限渲染”。

一轮改稿以 `comments` 数组提交 1–5 条批注，共用一个 base revision；每条保留自己的 targetId、帧号、归一化坐标和文字，可指向不同相关镜头。面板可添加/删除待提交批注，显示“本轮最多 5 条，合计 4,000 个字符”和剩余数量；服务端按 Unicode 码点计数，超限指出需要缩短的内容。提交前说明“一次提交计 1 轮修改”，不按每条评论重复扣次。

DOM/source map 可显示候选对象；Canvas/WebGL 没有对象 ID 时也允许精确帧+坐标反馈。最终审片截图由可信渲染服务重新取帧，不把客户端或不可信源码上传的图片当作证明。主站不得读取跨域 iframe DOM；由受限 bridge 返回最小信息。

Agent 改稿生成不可变候选及影响摘要，不覆盖当前草稿。用户比较 before/after，Accept 执行带权限与 base 的 CAS，Reject 保留当前稿；过时请求返回 409。全局修改先告知范围，不承诺无关片段绝对不变。颜色或文字未触及声音时复用音轨，节奏变更重新同步并验片。保留当前时间、讨论上下文和完整源码/音频恢复能力。

输入停顿约 1 秒自动保存；Saving / Saved / Offline draft / Conflict 对应真实状态，携带 baseRevision，禁止静默覆盖。至少 20 步会话撤销/重做与 20 个草稿检查点；已购版本、活动候选和在途任务引用不能因检查点裁剪丢失。恢复同内容创建新 revision，但按 contentHash 去重成片权益。

原始录屏默认静音，可显式启用原声。支持上传旁白/配乐、程序化作曲和多个 SFX，播放器使用实际混音；自动播放限制用明确播放按钮。音轨超长引导裁剪或缩稿，不自动加速/延长视频。显式静音不生成假空音轨；采样不可用可使用已授权合成器，未验收 TTS/逐词对齐不宣传可用。

## 5 平台准备、审核和付款

主目标可先审阅。Prepare platform layouts 显式启动 `prepare_targets`，在系统预算内为当前内容准备全部 7 个合法目标的真实布局、预览和 QA，不扣新的用户成功次数，也不提前编码全部高清文件。响应式规则不能覆盖失败的镜头；必要的 Agent 目标修复也须在付款前完成并纳入冻结身份。准备产生基于原稿的新不可变候选，通过当前 base 的 CAS 接受后才能冻结；不能向原 revision 补写字段。期间用户改稿产生冲突时保留准备结果并说明，不能合并进新稿或自动收费。

平台切换展示真实布局和安全区。目标缩略图可用于切换，不能仅凭静态图冒充全片动态 QA；播放真实预览并展示需要审阅的时段。交互预览保持隔离并标明 Preview / Paid download。BLOCK（越权、未确认事实、非法尺寸、依赖缺失等）不能豁免；REVIEW 显示具体规则/时段，由当前有权成员明确确认，修改内容后重新评估。预检不是平台审核或商业真实性保证。

购买面板按当前项目资格提供以下路径，价格和计数来自当前商品目录：

| 入口 | 用户确认与执行 |
| --- | --- |
| Buy & export — $19 | 仅当前已确认稿；全部 7 个合法目标、高清无水印、1 个版本，0 新整片/0 新 AI 改稿。固定 `purchaseIntent=purchase_and_export`，付款后自动导出订单快照 |
| Buy project pack — $39 | 无在途/有效初始购买，且无成片或希望先创作时，`purchaseIntent=top_up_only`，不带 snapshotId；新增 5 次整片、15 轮改稿、3 个版本，不自动渲染 |
| Buy project pack & export — $39 | 无在途/有效初始购买，全部目标已准备且用户明确确认时，`purchaseIntent=purchase_and_export`；同样新增全部权益，本次成功发布消费 1 个版本 |
| Upgrade project — $20 | 同一有效单片初始购买最多一笔在途或有效升级；新增 5 次整片、15 轮改稿、2 个版本，默认 `top_up_only`，可显式选择已冻结的新稿并导出 |
| Add to project — $12 | 仅完整项目包或已升级项目；新增 2 次整片、10 轮改稿、3 个版本，默认 `top_up_only`，可显式选择已冻结的新稿并导出 |

凡 `purchase_and_export` 都显示冻结内容、封面、时长、首次所选目标、本次使用 1 个版本及期限/税费，缺任何合法目标来源或 QA 返回 VARIANTS_NOT_READY，不创建该导出 checkout。`top_up_only` 禁止携带快照，也无需未生成影片的全目标准备。免费样片和已做修改保留为付费项目起点，不重新生成、不从新增的项目包/升级创作次数中扣除。升级显示已有版本及使用记录，只补差额；单片项目不出现 US$12 追加入口。

活动订单关联其他草稿时展示其原快照供明确继续，不能新稿封面套原订单。付款期间编辑保存为独立草稿，交付只读取订单快照。单片完成后普通参数仍可编辑和预览，不同内容的正式下载引导升级；同内容重下和补目标不重复收费。

升级及全部子追加全额退款结清后，原单片购买仍有效时重新显示升级入口；初始购买全链退款结清后，按快照条件重新显示单片或先购项目包入口。存在未知付款、活动订单或未结算退款时显示原付款/退款状态，不创建重叠的初始或升级订单。重新购买保留旧账本与提供方付款去重，不把退款记录或原试用使用清零；已清理项目仍关闭恢复付款。

针对已成功交付并消费版本、后因退款撤销交付权益的同一 contentHash，购买并导出前显示“Request restoration review”，先人工核查恢复收据/权益关联，核查未完成不新收单片款。不可用旧 release 自动跳过新授权或让新付款权益闲置。未消费/未发布失败退款后的正常重买、新内容购买及合格的 US$39 先购创作仍开放，不把人工流程扩大到所有退款项目。

Owner 可购买、查看账单和处理退款；Editor 可确认消耗已有成片权益或复制链接给 Owner，不自动发消息。用完版本仍可在有效期普通编辑/预览，AI 按实际剩余来源校验。先查询同项目 contentHash 是否已存在 release，并核验对应交付权益、来源与当前权限；仍有效时即使余额为零，也显示下载或补目标，不重复要求购买。权益已被退款撤销时显示真实状态及合格的重新购买入口，不能以已有文件绕过退款。未付费项目的宽限恢复仅在已有仍有效全目标快照时提供单片导出；无有效快照时先购项目包恢复，不能在只读宽限内跑准备/QA。生命周期与单片/完整项目恢复资格按 01/05。

## 6 交付与下载

首次文件集合固定为所选目标的 MP4、JPG、映射，全部通过完整编码 QA 且权益有效后原子发布并消费一次；中间 ready 文件不开放下载。最终失败释放预留，重试不多扣。ZIP 随后派生，失败免费重试，不影响已发布文件。

同版补目标只运行冻结来源，不调模型、不扩大首次批次、不影响已有下载。重下只签发新授权，不编码。关闭页面不取消已付款任务，用户回来可继续查询。宽限不允许新增导出或补平台；清理后不出售不可恢复服务。

## 7 协作、移动端与异常

Owner 管理成员、购买、退款和工作区删除；Owner/Editor 均可编辑、运行 AI、消耗已有版本、管理分享。匿名审阅者只能看限定版本，不评论、不执行 Agent、不取源码。分享默认 7 天且不晚于项目期限；邀请 48 小时、单次、可撤销，GET 不接受，登录后明确 POST 接受，最多 3 人。身份与邀请细则见 12。

验收视口 390×844、768×1024、1440×900。手机保持预览、帧定位、属性和 AI 底部面板、输入、撤销、付款和下载；不退化为只读。至少 44 px 触控、键盘/读屏名、焦点恢复、200% 缩放和减少 UI 动效；减少 UI 动效不改视频时间线。

| 情况 | 用户可执行处理 |
| --- | --- |
| 素材错误/上传中断 | 具体格式、重传失败文件；成功处理不重复扣素材额度 |
| 无可用候选的生成失败 | 不扣成功次数，保留原稿；系统已发生费用仍保留，剩余预算内重试或编辑已有参数 |
| 一次免费试用已在其他项目领取 | 保存空 draft，显示有权限的原试用项目或由 Owner 先购买 US$39 项目包，不开放未付费云操作 |
| 单片项目需要新内容或更多 AI | 普通参数仍可预览；引导 US$20 升级，不展示 US$12 追加捷径 |
| 本轮预算上限 | 保存检查点，说明范围；仅剩余预算内恢复，不截短影片 |
| 混排、缺字或过长 | 定位文字区，提供字体/布局调整，不禁整种语言 |
| 旧 base / 两成员竞态 | 409，查看或保留候选，明确重新应用 |
| 浏览器能力缺失 | 给出兼容实现或可信预览方案，需用户确认，不假装静态图是完整动画 |
| 支付未知/渲染失败 | 保留订单查询和恢复，不诱导重复付款 |
| 项目过期/文件清理 | 显示实际期限与恢复条件；宽限内有有效全目标快照才可单片导出，无快照先购创作；空 draft 缺素材不阻止合格的先购，已清理或墓碑项目关闭恢复付款 |

普通用户只见可复制错误编号，不展示内部密钥、堆栈或 token 账单。设计参考见 [Agent Studio](../design/agent-studio-reference.html)，仅为离线样例，不连接服务。
