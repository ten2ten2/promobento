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

头部为 44 px 太阳/月亮按钮，图标表示下一步动作；默认 System，点击记住显式选择，Settings 与公开页脚 Use device setting 恢复。不改变视频、播放器位置、未保存字段或订单。上传/生成前登录；登录跳转不假定浏览器文件授权一直存在。

## 3 创建与生成

流程：Setup → Assets → Details → Creative direction → Studio。软件入口可默认 YouTube/X，课程入口可默认 Reels/TikTok，六平台始终可选。时长默认 30 秒，仅可另选 15 秒；Feed 方形是该平台的选项，不是任意平台通用画幅。

上传显示实际大小、编码、处理进度、恢复入口及录屏起止/焦点。至少一份合法视觉素材可继续。事实面板展示产品名、受众、卖点、可选报价/日期和 CTA；确认默认未选，模型不能代勾。网址只作为背景/CTA，不自动抓取。

公开 returnTo 的 `platforms` 只包含平台 ID，解析时取其合法默认构图；创建界面明确选出的 `targetIds`（包括 Feed 方形）保存在服务端 flow/草稿上下文并重新校验，不放宽认证返回 URL allowlist。恢复登录后保留已选择目标，不把方形悄悄改回默认。

点击生成前说明：整片/局部操作各消费相应 1 次成功额度，可用候选交付才扣次，内部修复不另扣；交付后仅因审美拒绝仍计次。Director 按需展示三个实质不同方向的真实关键帧；明确指令或直接生成不要求再次三选一。无视频语言选择或识别确认门槛。

阶段显示排队、理解、方向、难镜头、代码、音频、实际帧检查与候选可用；有真实数据才显示百分比。等待用户和预算暂停保存工作并释放计算，恢复/取消按 14。不存在可销售 SKU 时不显示“付款解锁继续”。

## 4 Studio、改稿和声音

桌面为 248 px 镜头标记栏、弹性画布、320 px 属性/AI 面板；允许任意镜头数或连续一镜到底。时间线使用整数帧，音画共用时钟。Content / Media / Layout / Audio / AI Edit 分组，已暴露变量可直接编辑且不调用模型。

点选冻结 revision、targetId、帧号与归一化坐标。DOM/source map 可显示候选对象；Canvas/WebGL 没有对象 ID 时也允许精确帧+坐标反馈。最终审片截图由可信渲染服务重新取帧，不把客户端或不可信源码上传的图片当作证明。主站不得读取跨域 iframe DOM；由受限 bridge 返回最小信息。

Agent 改稿生成不可变候选及影响摘要，不覆盖当前草稿。用户比较 before/after，Accept 执行带权限与 base 的 CAS，Reject 保留当前稿；过时请求返回 409。全局修改先告知范围，不承诺无关片段绝对不变。颜色或文字未触及声音时复用音轨，节奏变更重新同步并验片。保留当前时间、讨论上下文和完整源码/音频恢复能力。

输入停顿约 1 秒自动保存；Saving / Saved / Offline draft / Conflict 对应真实状态，携带 baseRevision，禁止静默覆盖。至少 20 步会话撤销/重做与 20 个草稿检查点；已购版本、活动候选和在途任务引用不能因检查点裁剪丢失。恢复同内容创建新 revision，但按 contentHash 去重成片权益。

原始录屏默认静音，可显式启用原声。支持上传旁白/配乐、程序化作曲和多个 SFX，播放器使用实际混音；自动播放限制用明确播放按钮。音轨超长引导裁剪或缩稿，不自动加速/延长视频。显式静音不生成假空音轨；采样不可用可使用已授权合成器，未验收 TTS/逐词对齐不宣传可用。

## 5 平台准备、审核和付款

主目标可先审阅。Prepare platform layouts 显式启动 `prepare_targets`，为当前内容准备全部合法目标来源和 QA，不扣新的用户成功次数，也不提前编码全部高清文件。准备产生基于原稿的新不可变候选，通过当前 base 的 CAS 接受后才能冻结；不能向原 revision 补写字段。期间用户改稿产生冲突时保留准备结果并说明，不能合并进新稿或自动收费。

平台切换展示真实布局和安全区。BLOCK（越权、未确认事实、非法尺寸、依赖缺失等）不能豁免；REVIEW 显示具体规则/时段，由当前有权成员明确确认，修改内容后重新评估。预检不是平台审核或商业真实性保证。

全部目标来源齐全后，购买面板显示冻结内容、封面、时长、首次所选目标、US$39、3 个版本、本次使用 1 个及期限/税费。缺目标返回 VARIANTS_NOT_READY，不创建 checkout。活动订单关联其他草稿时展示其原快照供明确继续，不能新稿封面套原订单。付款期间编辑保存为独立草稿，交付只读取订单快照。

Owner 可购买、查看账单和处理退款；Editor 可确认消耗已有成片权益或复制链接给 Owner，不自动发消息。用完版本仍可在有效期普通编辑/预览。追加默认仅增额度，购买并导出须显式勾选。先查询同项目 contentHash 是否已存在 release；即使余额为零，已有内容仍显示下载或补平台，不重复要求购买。

## 6 交付与下载

首次文件集合固定为所选目标的 MP4、JPG、映射，全部通过完整编码 QA 且权益有效后原子发布并消费一次；中间 ready 文件不开放下载。最终失败释放预留，重试不多扣。ZIP 随后派生，失败免费重试，不影响已发布文件。

同版补目标只运行冻结来源，不调模型、不扩大首次批次、不影响已有下载。重下只签发新授权，不编码。关闭页面不取消已付款任务，用户回来可继续查询。宽限不允许新增导出或补平台；清理后不出售不可恢复服务。

## 7 协作、移动端与异常

Owner 管理成员、购买、退款和工作区删除；Owner/Editor 均可编辑、运行 AI、消耗已有版本、管理分享。匿名审阅者只能看限定版本，不评论、不执行 Agent、不取源码。分享默认 7 天且不晚于项目期限；邀请 48 小时、单次、可撤销，GET 不接受，登录后明确 POST 接受，最多 3 人。身份与邀请细则见 12。

验收视口 390×844、768×1024、1440×900。手机保持预览、帧定位、属性和 AI 底部面板、输入、撤销、付款和下载；不退化为只读。至少 44 px 触控、键盘/读屏名、焦点恢复、200% 缩放和减少 UI 动效；减少 UI 动效不改视频时间线。

| 情况 | 用户可执行处理 |
| --- | --- |
| 素材错误/上传中断 | 具体格式、重传失败文件；成功处理不重复扣素材额度 |
| 无可用候选的生成失败 | 不扣成功次数，保留原稿；重试或编辑已有参数 |
| 本轮预算上限 | 保存检查点，说明范围；仅剩余预算内恢复，不截短影片 |
| 混排、缺字或过长 | 定位文字区，提供字体/布局调整，不禁整种语言 |
| 旧 base / 两成员竞态 | 409，查看或保留候选，明确重新应用 |
| 浏览器能力缺失 | 给出兼容实现或可信预览方案，需用户确认，不假装静态图是完整动画 |
| 支付未知/渲染失败 | 保留订单查询和恢复，不诱导重复付款 |
| 项目过期/文件清理 | 显示实际期限与恢复条件，缺素材时关闭付款 |

普通用户只见可复制错误编号，不展示内部密钥、堆栈或 token 账单。设计参考见 [Agent Studio](../design/agent-studio-reference.html)，仅为离线样例，不连接服务。
