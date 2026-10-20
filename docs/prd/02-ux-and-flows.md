# 界面与用户流程

v2.2 consistency-1。网站文案首发英语，客户视频原文可混排；UI视觉继续遵守11及既有tokens。制作交互以本章和14为准，历史四页参考不是运行中的Agent Studio。

## 1 页面与信息架构

| URI | route ID | 边界 |
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

页面默认跳转、returnTo、邀请、Google/邮箱关联和404/405/410保持12规则；这些页面不因新增Agent API改变地址。

## 2 首页与首次进入

主文案：Turn your product or course into a promo video. 辅助：Use your real assets. Direct the motion, refine any frame, and export for your channels. 软件与课程入口同层级，演示标测试品牌，公开SSR和搜索策略按07。

头部保持44px太阳/月亮按钮，图标表达下一步主题；默认跟随设备，点击记住显式选择，设置/公开页脚Use device setting恢复。不改变客户视频颜色、当前播放器、未保存字段或订单。Google/邮箱页面不丢创建选择；文件授权不假定跨登录跳转保留，所以上传在登录后。

## 3 创建流程

选择发布任务 → 真实素材 → 确认事实 → 创意方向/直接生成 → Studio。软件入口可默认YouTube/X，内容入口默认Reels/TikTok，但六平台均可选。时长默认30秒，仅另选15秒。Instagram Feed方形通过该预设选项选择，不能把任意aspect作为所有平台通用选项。

素材上传展示大小/编码/处理状态、可恢复错误及起止片段/焦点。至少一张合法素材可继续，不强制三张。事实面板展示将上屏的产品名、对象、卖点、可选价格/日期、CTA等，用户确认后才能进入生成；网址作为背景/CTA不自动抓取。

生成前说明：本次1次整片创作/局部改稿，可用候选交付才扣次，系统内部修复不另扣，候选已交付后审美拒绝仍计次。Director可展示三个不同方向的实际关键帧，也可按明确指令直接做；不展示只有一个选项的视频语言下拉框。

状态展示排队、理解、方向、难镜头、编码、音频、抽帧检查、候选可用；能获得实际帧数才显示进度百分比。`awaiting_user`和预算暂停保存工作释放计算；恢复/取消按14，不能显示未定义的付费继续按钮。

## 4 Studio：编辑、声音与版本

桌面沿用248px导航、中央播放器、320px属性/AI面板。镜头标记可有任意数量，也可连续一镜到底；不是必须六场景。时间线以整数帧为准，声音与画面共用时钟。右侧Content/Media/Layout/Audio/AI Edit，普通变量不调用模型。

点选冻结当前revision、targetId、帧号和归一化坐标；DOM/source map可以定位时显示对象，Canvas/WebGL没有对象ID时请求可信渲染服务取该帧，仍能给Agent修改。主站不读取跨域iframe DOM，不信任源码自报截图或QA。交互预览明确独立origin、受限bridge与最小授权。

AI改稿先出候选与影响范围，不覆盖旧稿；用户比较before/after，Accept执行CAS，Reject保留旧稿。文字/颜色改变不相关声音时复用audioHash；节奏和镜头改变需重新对齐声音并重检。当前时间位置、评论上下文和原版随回滚保留。全局改稿先告知影响，不谎称“只改一处”。

约1秒输入停顿自动保存，显示Saving/Saved/Offline draft/Conflict；请求携baseRevision，冲突409，提供查看服务器版本、保留本地和明确重做，不静默覆盖。至少20步会话撤销/重做及20个草稿检查点；已购快照不随检查点清理。恢复旧版本生成新草稿，不覆盖历史。

原始录屏默认静音，用户可明确启用原声。支持上传旁白/配乐及Agent作曲与多音效事件，预览必须能听实际混音；自动播放限制用真实播放按钮。音轨超长提示裁剪/缩稿，不自动加速或延长视频；用户选择静音不加假音轨。音色/采样授权未确认就使用已获准的合成器，不宣传未开放TTS或逐词对齐。

## 5 平台准备、预检与付款

主目标候选可先审阅；点击准备交付后显式准备所有合法target的源码/资源/音轨和预检结果，显示Preparing platform layouts。此步不是高清MP4全部编码，也不占新的AI成功次数；重试按原revision/任务去重和限流。候选风格若改变，需要客户再确认，不把新艺术选择悄悄塞进已购版本。

平台切换预览实际构图与安全区；禁用失效素材、未确认事实、非法时长、缺依赖等BLOCK。REVIEW项提供具体帧/原因及范围确认，不设一键放行安全/事实/编码错误。预检通过不等于平台审核保证。

购买面板固定全部target源包、内容、封面、时长、首次所选平台、US$39、3个版本、本次用1个、保留期与税费。缺target时不跳Waffo。服务端创建checkout；活动订单旧快照必须显示原稿供选择，不拿新稿封面冒充。付款期间编辑产生新草稿，自动交付读取原snapshot。

只有Owner购买/看账单退款；Editor可以用已有权益导出且确认消耗，也可复制项目链接给Owner，不自动外发消息。余额耗尽仍能在有效期内普通编辑/预览，追加默认只加额度，选择购买并导出须明确确认。支付返回只读服务端状态，不以URL推断付款成功。

## 6 后台交付与下载

首次预留固定MP4、封面及映射文件集合，全部验证成功后原子发布并消费1个版本；中间文件不提前下载。最终失败释放预留，重复投递不多扣。ZIP随后派生可免费重试，不决定首次消费时点。

同已购snapshot补平台只运行已冻结源码，不再调模型，不影响已有文件、不扩大首次批次。重新下载只签发授权，不编码。用户关闭网页仍能下次回来取结果；短期URL过期可更新。项目宽限不允许新生成或补平台，清理后不能付款假装恢复。

## 7 协作、移动端与异常

Owner管理成员/购买/退款，Owner与Editor可编辑/运行AI/用版本导出/管理分享；未登录审阅者只能看获准快照，不能评论、Agent执行、源码下载。审阅token默认7天且不长于项目期限，可撤销；邀请48小时单次，GET不加入，登录后明确POST接受，至多3人；详见12。移除成员后旧权限立即无效，不靠前端隐藏。

390×844、768×1024、1440×900为最低视口验收。手机预览在上、时间位置可拖，属性和AI改稿在底部面板；保留输入/播放位置、键盘焦点、撤销/付款/下载。不以桌面提示替代移动端核心功能。44px触控、读屏名、弹窗焦点、200%缩放、减少UI动画偏好要可用，减少UI动效不改变成片。

| 情况 | 用户结果 |
| --- | --- |
| 无素材/格式错误/上传中断 | 具体范围与重传，已完成文件不重复计处理次数 |
| 生成失败且无可用候选 | 不扣成功次数，保留旧稿；可以修改已有参数或重新请求，不虚构固定模板兜底 |
| 达到本轮预算 | 说明原因、保存候选；仅已有剩余预算可恢复，不偷偷缩短视频 |
| 字体缺字/RTL混排/过长 | 指向实际文字区和字体建议，不删字或禁整种语言 |
| 旧base/两成员竞态 | 409，可查看/保留/重新应用，无静默覆盖 |
| 浏览器不支持复杂效果 | 明确能力问题，授权后选择兼容实现/受控预览，不能降为假静态视频 |
| 支付确认延迟/渲染失败 | 保留订单查询、恢复任务和错误编号，不要求立即重复购买 |
| 项目过期/已清理 | 明确正常期/宽限/恢复条件，素材不存在时关闭付款 |

普通用户不显示容器ID、SDK堆栈、token计费细节；给出可复制错误编号。新Agent参考见 `docs/design/agent-studio-reference.html`，是独立离线示意，不连接真实服务。
