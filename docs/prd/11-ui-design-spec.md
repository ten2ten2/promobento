# UI 设计规范

适用于公开网站、登录、创建、Studio、交付、设置与后台。**杂志排版的层级和留白，结合专业工具的冷中性色、蓝灰操作色。** 当前参考见 [Agent Studio](../design/agent-studio-reference.html)，是离线设计示例，不是生产功能。

## 1 唯一视觉来源

[ui-tokens](../../config/ui-tokens.json) 定义字体、尺寸、间距、层级和动效，[theme-tokens](../../config/theme-tokens.json) 定义颜色与配对。02 定义用户流程，05 定义权益，10 定义语言/主题，12 定义认证，14 定义版本/执行。参考由当前模板与配置生成，不另写一份有冲突的颜色/平台/配额配置。

品牌为 PromoBento 文字字标，display 字体 24/32 px、500 字重、至少 12 px 留白。公开标题使用 Georgia / Times New Roman / serif；正文和控件使用 Arial / Helvetica / system sans，编辑器与数据不滥用衬线/斜体。每个操作区域一个主要 CTA，两人群入口同级；作品是视觉中心，事实不能用装饰暗示未经证明的收益。

## 2 组件、颜色与排版

采用 React/TypeScript、React Router、Tailwind CSS variables、shadcn/ui Base UI、@base-ui/react 和静态导入的 Lucide；组件源码按需进入 packages/ui。不混用不同 primitives 示例，不让脚手架覆盖 Cloudflare/Vite 配置；SSR 不访问 window/document。版本选择和实际 hydration 验证见 [依赖策略](../dependency-policy.md)。

Light 为白底/冷灰表面/深蓝灰操作，Dark 为炭灰/深灰表面/浅蓝灰操作。所有具体色值从 tokens 生成；选中区文字使用 selectionText，必要输入边界用 borderControl，轻分隔用 border。错误/成功/警告配对语义背景且同时有文字/图标；危险实心按钮使用 dangerText。普通内容无常驻投影，菜单/对话框使用指定阴影，portal 继承主题。

普通文本目标 4.5:1、大字 3:1，必要控件/focus 3:1，验实际背景。禁用原因仍可读，不以低对比度文字承载关键解释。网站系统字体不等于跨设备字宽保证，客户原文不因缺字而改写；视频字体/资源独立冻结。

| 用途 | 字体 | 字号/行高 | 字重 |
| --- | --- | --- | --- |
| Hero | display | 52/55；小屏 44/46 | 400 |
| Page title | display | 32/38 | 400 |
| Section title | sans | 20/28 | 600 |
| Body/input | sans | 16/24 | 400 |
| Label/button | sans | 14/20 | 500 |
| Small metadata | sans | 12/16 | 400 |

关键价格、错误和操作不放 12 px 小字。数字使用等宽数字；错误正文换行，不能省略处理方式。长项目名可截断但可访问全文。图标默认 20 px、紧凑 16 px、特征 24 px，strokeWidth 1.75；纯图标按钮有唯一读屏名。

## 3 尺寸、响应式与浮层

tokens 中 4 px 间距体系、页面边距 16/24/32、最大公开宽 1200、创建宽 960、表单 640、正文 760。控件默认高 44、桌面紧凑 36、主营销 CTA 48；触摸点击面积仍至少 44×44。textarea 初始 112。圆角 0/2/4/8/12，作品内容不强制裁成圆角；焦点环 2+2 px。

断点 640/768/1024/1280/1536。公开首页文案/作品非对称双栏，窄屏上下；创建宽屏主表单+摘要，手机单列；应用导航宽 224。Studio ≥1280 为 248 标记栏+弹性画布+320 属性栏，768–1279 属性侧面板，<768 预览/时间+底部属性/AI 面板，不缩小整套桌面界面。

站点头 72、应用头 64、Studio 头 56、工具条 48，文字放大可自然增高。画布 contain，不因 UI 容器拉伸或裁切内容。手机面板最大 85dvh，普通对话框最大 480，核对购买 640；软键盘和底栏需给正文/当前字段留安全空间。

根层级 base 0、sticky 20、dropdown 30、sheet 40、dialog 50、toast 60、tooltip 70。对话框里的菜单属于其浮层上下文，不因全局 dropdown 数字落到遮罩下。关闭按栈恢复焦点，背景滚动锁定在 iOS 实测。hover 120 ms、普通状态 180、面板 240；减少动态取消 UI 位移，不改视频时序。

## 4 页面与组件行为

Button 显示真实 loading/disabled 原因且保持尺寸；Input 有外部 label，错误关联字段；Tabs/Select 可键盘切换，平台预览与导出选择是不同控件。镜头列表可任意数量或没有标记，提供拖拽之外的键盘移动。进度只用真实阶段/帧数，未知不能用固定倒计时。状态、错误和付费条件不能只藏 tooltip/toast。

首页按 02 的主文案和两用途呈现，CTA 附免费预览/当前价格说明，真实值来自服务端目录。样片来源和演示品牌明确，无虚构评价/Logo。手机主标题、创建按钮和免费说明可读，作品向下自然延伸。

创建步骤为 Setup、Assets、Details、Creative direction。可返回编辑且状态保留，事实确认默认未选；无固定视频样式白名单、无视频语言步骤。方向预览必须基于用户素材的真实可运行关键帧，直接生成不强制三选一。

## 5 认证与设置

登录使用约 480 px 单列，Google 的 Continue with Google 和邮箱 Email address / Send sign-in code。邮箱 autocomplete=email，禁自动首字母/拼写；无密码/找回密码页。验证码为单个 text/inputmode=numeric/autocomplete=one-time-code，支持整段粘贴与前导零，填满仍明确 Verify and continue。

数字、冷却、尝试和实际到期取 auth 配置及服务器，不在 UI 维护另一套计时规则。请求被接受不写“已送达”，重发倒计时不逐秒读屏；异常持久展示，保留创建选项与输入。关联页只在有授权 proof 时展示目标资料，显式完成双方验证及确认，同邮箱不自动合并。独立账号创建须说明项目订单不带入；邀请 GET 不加入，登录后仍明确 Join workspace。

Account 只展示真实已关联方式、添加 Google/邮箱、当前/全部退出；不提供未实现的解绑/密码/MFA。全部退出、Owner 转移和工作区删除按 12 重新验证对应操作。Brand/Members/Orders 按角色显示，Support 指向 Help，不造重复设置页面。

## 6 Studio 和交付

顶栏保存、撤销、协作、版本余额和主要行动，镜头可任意数量；画布、时间位置、目标预览、安全区、Content/Media/Layout/Audio/AI Edit 共同组成编辑器。点选携带帧/target/revision/坐标；无 DOM 也支持可信取帧兜底。AI 候选比较后 Accept/Reject，冲突和未保存状态明确，不能直接覆盖当前稿。

| 状态 | 主要行动 | 说明 |
| --- | --- | --- |
| 来源尚未全目标准备 | Prepare platform layouts | 先准备和验证，不创建付款 |
| 未购买且准备完成 | Buy & export — $39 | 原快照、3 个版本、本次 1 个、期限/税费 |
| 不同内容且有余额 | Export new version | 新 contentHash，确认成功交付后消费 |
| 活动付款/未知付款 | Continue payment / View payment status | 只用原订单原快照，不诱导重复付 |
| 同内容已预留或执行 | View export status | 不重复开任务/扣次 |
| 同内容已交付 | Download files / Add platform files | 余额 0 也保留，不再创作/收费 |
| 新内容无余额 | Add 3 versions — $12 | 默认仅加额度，购买导出须明确选 |
| 非 Owner 需购买 | Ask owner / Copy project link | 不自动外发消息 |

创作成功次数与成片版本分别显示，不统称 credits。普通变量不调用模型；候选交付消费与接受不重复消费清楚展示。Q0/Q1 来源准备与 Q2 编码后校验区分，参考里的 Candidate ready 不代表全部目标或付款已就绪。

交付页展示实际版本/期限/阶段；初批失败不下载零散文件，ready 后逐目标 MP4/JPG/映射，补目标保持原文件可下。ZIP 准备/失败是独立状态。无自动 Publish 承诺。项目列表用真实缩略图、名称、状态、时间/期限与菜单，空态引导创建或明确 Sample，不填假用户数据。

## 7 主题、可访问性与检查

主题按钮及 Cookie/SSR 行为以 10 为准。Settings 和公开/审阅页脚均有 Use device setting；视频样式与 UI 完全隔离。键盘可完成创建、编辑、核对付款和下载，Skip to content、可见焦点、live region、Escape/关闭恢复焦点均可用。

| ID | 应用验收 |
| --- | --- |
| UI-01 | 首页/创建/Studio/交付在三个视口主行动可见，无正文无意义横滚 |
| UI-02 | 基础组件默认/hover/pressed/focus/disabled/loading、浮层栈和 iOS 滚动 |
| UI-03 | Theme 首屏、持久化、失败与快速点击按 10；不改作品或订单 |
| UI-04 | 单输入 OTP、登录/关联/邀请所有 pending/失败/冲突可恢复，不显示虚假成功 |
| UI-05 | 自由创意、任意标记、点选兜底、候选对比/CAS、预算/QA 与全部目标准备 |
| UI-06 | contentHash 去重行动、Owner/Editor 边界、过期/已清理/部分文件/ZIP 状态 |
| UI-07 | 44 px、200% 缩放、键盘/读屏、RTL 混排/缺字与减少动态 |

`build:agent-reference` 从当前模板、tokens、预设和配额生成参考，`check:agent-reference` 验同步性。参考仅静态样例和本地交互，没有登录、模型、真实视频或支付；生成通过不等于浏览器/应用验收。
