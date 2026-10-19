# UI 设计规范

版本：1.1。确定日期：2026-10-20，Asia/Shanghai。适用于 PromoBento P0 网站的公开页面、创建流程、编辑器、交付、设置与后台。本次修订落实用户确认的「杂志排版」主体与「专业工具」配色，沿用已确定的主题图标和偏好行为；页面代码与生产验证仍按 M0–M4 实施。

## 1 设计方向与规范归属

界面采用**杂志排版的层级与留白，配合专业工具的冷中性色和蓝灰强调色**。品牌字标与展示标题使用衬线字体，正文与操作控件使用无衬线字体。首页用非对称的文案与作品分栏、细分隔线和开放式内容区建立层次；进入编辑器后保留同一配色与字标，提高信息密度，让素材、文字与预览成为视觉中心。

- 同一操作区域只保留一个主要 CTA。主页引导创建，编辑器引导预览与导出，交付页引导下载。
- 两类首批用户共用组件、导航和编辑器；用途入口、素材例子和必要字段提示区分人群，视觉层级相同。
- 项目、素材与购买摘要可使用薄边框、小圆角的容器；用途说明、流程与普通正文优先采用留白和细分隔线，展示区域让作品占据主要空间。
- 品牌字标写作 PromoBento，采用 display 字体、24 px、500 字重，周围至少 12 px 留白。首版使用文字字标；视频中的客户品牌按其自己的快照展示。
- 衬线标题用于公开页、页面开篇与作品展示；表单标签、按钮、数据、场景列表、属性面板和编辑器操作保持无衬线字体。编辑器沿用品牌视觉，但按持续编辑所需的尺寸与密度排版。
- 主按钮采用实色蓝灰、小圆角；选中状态用下划线、边界或标记配合浅蓝灰底。普通内容区不使用投影；彩色状态提示只出现在需要表达状态的位置。
- 内容使用真实产品截图、课程交付物或明确标注的 Sample 内容。示意稿不构成客户背书、实际支付或成片生成证据。

| 权威源 | 负责内容 |
| --- | --- |
| 本章 | 视觉方向、页面构图、组件用法与 UI 验收 |
| [02 界面与流程](02-ux-and-flows.md) | 操作步骤、状态、权限和异常处理 |
| [05 支付](05-waffo-billing.md) | 价格、额度、订单、版本及扣费语义 |
| [10 网站国际化与主题](10-i18n-and-themes.md) | 网站语言、主题偏好、SSR 与缓存；视频内容独立 |
| [theme-tokens.json](../../config/theme-tokens.json) | Light / Dark 颜色及颜色配对 |
| [ui-tokens.json](../../config/ui-tokens.json) | 字体层级、尺寸、间距、圆角、阴影、层级与动效 |
| [可视化参考](../design/ui-reference.html) | 四个核心页面的可切换参考状态，由模板和 tokens 生成 |

tokens 是开发数值的来源；本章解释其用途。参考页展示构图和状态，不能覆盖业务规则。修改规范时同步来源配置与参考模板，再生成参考页；不手工维护第二套颜色。发生冲突时保持 03 的格式、05 的账务和 10 的语言/主题规则，并修复本章或参考稿。

## 2 组件与样式方案

| 层次 | 确定方案 | 实施规则 |
| --- | --- | --- |
| 页面 | React、TypeScript、React Router | 沿用 Cloudflare SSR 工程 |
| CSS | Tailwind CSS + CSS 自定义属性 | 语义颜色与尺寸由 tokens 映射，按需构建 CSS |
| 基础组件 | shadcn/ui 的 Base UI 版本 | 引入所需组件源码，由项目维护 |
| 交互 primitives | `@base-ui/react` | 对话框、菜单、选择器、Tabs 等采用同一体系 |
| 图标 | `lucide-react` | 静态导入使用到的图标 |
| 网站字体 | Georgia / Times New Roman 展示字体；Arial / Helvetica / system sans 操作字体 | 首版采用系统字体栈，无新增网站字体下载；不决定视频字体 |

shadcn/ui 当前的新项目默认方案为 Base UI。本项目尚无应用组件，因此直接采用这套方案；初始化仍显式记录 Base UI 选择，避免未来默认值改变。组件组合采用当前 Base UI API，不能混用旧 Radix 示例的 props。shadcn 提供的是项目需要维护的源码，组件按需落到 `packages/ui`；项目卡片、素材列表、事实确认和导出摘要属于业务组件。[官方默认方案](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)、[Base UI 概览](https://base-ui.com/react/overview/about)

先建立 Cloudflare 官方 React Router 工程，再按 existing-project 流程接入组件。保留 Cloudflare 与 React Router 的 Vite 配置，不让 UI 脚手架覆盖 Worker 配置。React Router 工程采用 TypeScript 和 CSS variables；若生成 `components.json`，RSC 配置为 false。浏览器 DOM 操作放在客户端生命周期，服务端渲染不读取 window/document。[Cloudflare React Router](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/)、[shadcn React Router](https://ui.shadcn.com/docs/installation/react-router)

本次确定选型，不提前安装尚无应用使用的包。实际引入时按 [依赖策略](../dependency-policy.md) 选目标平台兼容范围内的最新正式版，记录 CLI/registry、组件源码和包版本，精确锁定并运行真实 SSR/hydration 检查。已有 mise 工具链不因 UI 文档修改而升级。

## 3 色彩、主题与状态

Light 采用白底、冷灰面板与深蓝灰操作色，Dark 采用炭灰背景、深灰面板与浅蓝灰操作色。下表的基础色来自用户确认的组合预览；交互状态按相同色系派生。信息层级主要由文字、空间和边框表达，阴影用于菜单和对话框。

| 语义 | Light | Dark | 使用位置 |
| --- | --- | --- | --- |
| bg | #FFFFFF | #161819 | 页面背景 |
| surface | #F7F8F9 | #202326 | 面板、项目与素材容器 |
| surfaceRaised | #FFFFFF | #282D32 | 下拉菜单、弹层 |
| text | #25282D | #E5E8EC | 正文、标题 |
| textMuted | #656D75 | #ACB4BF | 辅助说明、元数据 |
| primary / primaryText | #253E5B / #FFFFFF | #B8CCE5 / #182D44 | 主要操作 |
| primaryHover / primaryActive | #1E334D / #182A40 | #CCDCF0 / #A2BCD9 | 主要操作的 hover / pressed |
| border | #DCE0E4 | #3B4148 | 结构分隔 |
| borderControl | #7A838D | #7E8995 | 需要边界识别的输入控件 |
| focus | #253E5B | #B8CCE5 | 键盘焦点 |
| selection / selectionText | #E9EEF3 / #253E5B | #293443 / #E5E8EC | 选中场景、选项 |

成功、警告、错误、信息提示分别使用 `success`、`warning`、`danger`、`info` 及其 `*Bg` 配对；始终有文字和图标。危险实心按钮使用 `dangerText`，不能直接套用普通按钮的文字颜色。其 hover/active 和各语义背景均已写入 theme tokens。

结构边框可以较轻；控件的可识别边界使用 borderControl。正文与背景的目标对比度为 4.5:1，控件边界及焦点为 3:1；检查实际组件组合。选中容器内的标题和辅助文字均使用 selectionText，不能将 textMuted 直接叠在 selection 上；普通 hover/pressed 表面使用各自的 surfaceHover/surfaceActive 配对。禁用控件仍显示原因或旁边的可读说明，不能让低对比度提示承担关键解释。

`ui-tokens.json.themeTokenMap` 明确 shadcn background、foreground、primary、input、ring 等语义到 `--ui-*` 的映射。组件 hover/selected/loading 也使用语义变量，不保留与主题冲突的硬编码色。

主题继续采用 `data-theme="system|light|dark"`、CSS 媒体查询和第 10 章的 Cookie/SSR 方案。System 的深色分支必须覆盖所有组件；不能仅适配显式 Dark。应用与 portal 都能取得 tokens，浮层不能因挂到 body 而恢复成另一套主题。[shadcn 主题](https://ui.shadcn.com/docs/theming)

网站导航与应用顶部用一个 44 × 44 px 的太阳/月亮图标按钮。当前有效 Light 时显示月亮，动作是 Switch to dark mode；当前 Dark 时显示太阳，动作是 Switch to light mode。默认跟随系统，用户点击后立即切换并记住显式选择；后续系统变化不覆盖。头部不放 Appearance 文字或三选菜单，Settings 的 Appearance 组保留 Use device setting 恢复入口；公开页和只读审阅页在页脚提供同名动作。无 JS 首屏的图标及可访问名称、保存失败和连续点击行为按第 10 章验收。

视频画布使用自己的背景、文字、字体和 `--video-*`。UI 模式切换只改变播放器外壳与工具，客户截图、Logo、字幕、视频 Clean/Bold 配色和帧内容保持独立。

## 4 字体、字号与图标

网站采用两组系统字体栈，生产与离线参考使用相同声明：`typography.displayFontFamily` 为 Georgia、Times New Roman、serif；`typography.fontFamily` 为 Arial、Helvetica，再回退到 ui-sans-serif/system-ui 和系统无衬线字体。展示标题默认 400，操作标签 500，紧凑分组标题 600；700 留给确需强调的短内容。网站不新增字体下载，也不把系统字体文件复制进仓库或分发。

系统字体栈保留各设备的字体回退，不能承诺跨平台完全相同的字宽和换行。应用验收需检查实际字体、目标浏览器的布局与缺字；无相应字体的测试环境只能验证其回退效果。用户项目名和自由输入保留原文，字体缺字回退不触发语言选择。视频继续使用独立的、受控并随渲染版本固定的字体；网站系统字体策略不改变预览与容器的成片一致性要求。

| 文字样式 | 字体 | 字号 / 行高 px | 字重 | 用途 |
| --- | --- | --- | --- | --- |
| Wordmark | Display | 24 / 32 | 500 | PromoBento 文字字标 |
| Hero | Display | 52 / 55 | 400 | 宽屏首页主标题，字距 -2.4 px |
| Hero compact | Display | 44 / 46 | 400 | 小屏首页，字距 -1.8 px；允许自然换行 |
| Page title | Display | 32 / 38 | 400 | 项目列表、创建、交付的页面开篇 |
| Section title | Sans | 20 / 28 | 600 | 页面分组、面板标题 |
| Body | Sans | 16 / 24 | 400 | 正文、说明与输入内容 |
| Label | Sans | 14 / 20 | 500 | 按钮、表单标签、工具条 |
| Small | Sans | 12 / 16 | 400 | 次要时间与辅助元数据 |

- 输入文字默认 16 px；关键价格、错误与行动说明不放在 12 px 的小字里。
- 价格、额度、时长和进度采用等宽数字；正文保持普通比例字体。URL 和错误编号可使用配置中的 monospace 字体。
- 英语标签用 sentence case；长项目名允许截断，但详情/编辑入口能访问完整名称。正文和错误信息换行，不靠省略号隐藏处理方法。
- 正文阅读宽度不超过 760 px，常规表单正文建议 640 px；营销标题限制自然行长，避免把一个单词拆开。展示标题可少量使用斜体强调，不将大面积衬线或斜体延伸到数据与编辑控件。
- Lucide 图标默认 20 px、1.75 stroke；密集工具条 16 px，功能说明 24 px。图标按钮必须有可访问名称，关键行动保留文字。装饰图标对读屏隐藏；品牌平台名称以文字显示，不把通用图标冒充官方商标。[Lucide React](https://lucide.dev/guide/react/getting-started)

## 5 尺寸、间距与层级

所有数值以 ui tokens 为准，常规尺寸由 4 px 基础间距组成。少量 44 px 控件等有明确可用性用途的尺寸独立列出。

| 项目 | 确定数值与规则 |
| --- | --- |
| 间距序列 | 0、4、8、12、16、24、32、48、64、80、96 px |
| 页面左右留白 | 小屏 16，中等 24，宽屏 32 px |
| 公开页内容宽度 | 最大 1200 px，居中 |
| 创建流程宽度 | 最大 960 px；常规表单字段区建议 640 px |
| 模块纵向间距 | 小屏 48、宽屏 80 px；应用内分组一般 24/32 px |
| 控件高度 | 默认 44，密集桌面 36，首页主要 CTA 48 px |
| 触控目标 | 至少 44 × 44 CSS px；小图标通过按钮留白获得点击面积 |
| 多行输入 | 初始最小高度 112 px，可按内容增高 |
| 圆角 | 0 px 作品展示，2 px 小元素/主要按钮，4 px 输入与普通控件，8 px 必要容器/浮层；需要独立包围的大型预览外壳可用 12 px，full 用于头像 |
| 焦点环 | 2 px outline + 2 px offset；不能被父级裁切 |
| 普通对话框 | 最大 480 px；购买/版本核对最大 640 px，窄屏留 16 px 边距 |
| 手机底部面板 | 最大 85dvh，内容内部可滚动，保留关闭和当前操作 |
| 动效 | hover/focus 120 ms，普通状态 180 ms，面板 240 ms；减少动态效果时取消位移与装饰动画 |

普通内容与面板的 raised 阴影为 none，floating 用于菜单，modal 用于对话框；两主题分别取配置值，不用阴影代替边框。编辑器常驻三栏主要靠分隔线，不为每个字段增加投影。展示图可方角，圆角属于网站外壳而非客户视频的固定裁切。

根级层级按 base 0、sticky 20、dropdown 30、sheet 40、dialog 50、toast 60、tooltip 70 分配。Portal 位于统一浮层宿主；应用内容根使用 isolation:isolate。Dialog/Sheet 内的菜单、Select、Popover 继承当前弹层上下文并位于父层内容之上，不无条件套用根级 dropdown=30；关闭按弹层栈顺序恢复焦点。采用当前 Base UI 官方的 portal/backdrop 样式并验证 iOS 滚动，不能在 SSR 期间创建不存在的 DOM 容器。[Base UI Quick start](https://base-ui.com/react/overview/quick-start)、[Dialog](https://base-ui.com/react/components/dialog)

## 6 响应式布局

CSS 断点采用 640、768、1024、1280、1536 px。行为转换由任务需要决定，不能仅把桌面三栏等比缩小。

| 区域 | 宽屏 | 中等宽度 | 小屏 |
| --- | --- | --- | --- |
| 公开页 | 1200 px 容器，12 栏栅格 | 8 栏，24 px 外边距 | 4 栏，单列为主，16 px 外边距 |
| 首页 Hero | 非对称双栏，衬线文案与成片示例并列，细线标注输入与输出 | 宽度不足时示例置于文案下 | 标题、CTA、价格提示、样片依次排列 |
| 创建页 | ≥1024 px：主表单 + 约 280–300 px 摘要 | 表单与摘要上下排列 | 单列步骤；当前输入与 Continue 都可访问 |
| 应用列表/设置 | ≥1024 px：224 px 导航 + 内容 | 导航折叠到菜单 | 内容单列，次级筛选折叠 |
| 编辑器 | ≥1280 px：248 px 场景栏 + 弹性画布 + 320 px 属性栏 | 768–1279 px：场景入口与画布常驻，属性用侧面板；空间不足时场景也折叠 | <768 px：预览 + Scenes/Properties 底部入口；场景抽屉、属性底部面板 |
| 交付文件 | 版本摘要与平台文件列表并列 | 摘要在上、文件列表在下 | 每个平台文件单独分组，下载按钮可直接点击 |

站点导航高 72 px，应用列表顶部 64 px，编辑器顶部 56 px；文字放大或内容换行时允许自然增高。编辑器工具条基准 48 px。画布按可用区域等比 contain，四种构图不拉伸、不裁掉客户内容。

窄屏保持页面纵向滚动；仅场景条或明确的 Tabs 区允许局部横向滚动。固定底栏计入安全区与正文底部留白；软键盘弹出后当前字段、错误和继续操作不能被遮挡。200% 缩放时重排为较窄布局，不要求用户缩小浏览器。

## 7 基础组件规范

| 组件 | 视觉与状态 | 交互要求 |
| --- | --- | --- |
| Button | Primary、Secondary、Ghost、Destructive；默认/hover/pressed/focus/disabled/loading | Loading 保持按钮宽度并显示动词状态；重复提交受控；禁用原因在附近可读 |
| Theme button | 单个 Ghost 图标按钮，44 × 44 px；Light 显示月亮，Dark 显示太阳 | 图标表示下一步动作，tooltip 与可访问名称一致；点击按当前有效主题取反并保存；恢复 System 在 Settings 中完成 |
| Input / Textarea | Label 在外部上方，helper 在下方；错误边框 + 文字 | Placeholder 只做例子；可见 label 与控件关联；不改写用户语言 |
| Checkbox / Radio | 选中标记 + 边框 + label | 平台多选用 checkbox；互斥时长/样式用 radio；分组有可访问名称 |
| Select / Combobox | 当前值清楚，菜单使用浮层表面 | 有搜索需要才用 combobox；键盘选择、关闭、返回焦点正确 |
| Tabs / Segmented control | 选中有形状或下划线，辅以颜色 | 键盘可切换；平台预览与“选择导出平台”是不同控制，不混淆范围 |
| Card | 8 px 圆角，16/24 px 内边距，薄边框、无常驻投影，预览比例固定 | 仅在需要独立容器时使用；项目主链接与更多菜单分离，不嵌套可点击元素 |
| Scene item | 缩略图、序号、类型、时长、标题与错误数量 | 选中有边框/标记；拖拽之外提供键盘移动；重排后保留选中项 |
| Upload zone | 虚线边框、支持范围和 Browse files | 拖拽、键盘、手机文件选择均可用；上传/处理/失败状态对应真实文件 |
| Status badge | 文字 + 可选图标；语义色成对使用 | Draft、Processing、Ready、Failed 等取真实状态；不只显示色点 |
| Inline alert | 字段错误、页面提示、阻止项与建议项分级 | 能跳到具体场景/字段；付款与导出问题不能只短暂显示 toast |
| Dialog / Sheet | 标题、说明、关闭、底部操作；背景遮罩 | 焦点管理、Escape、关闭恢复焦点；有业务保留要求时按 02/05 处理，不默默丢草稿 |
| Tooltip | 小型文字提示，4 px 圆角 | 辅助解释，键盘可访问；不承载唯一的必填提示或付费条件 |
| Toast | 简短结果，状态类型可识别 | 保存成功等轻提示可消失；可恢复错误提供持久入口，不模拟支付成功 |
| Progress / Skeleton | 固定预览比例，减少布局跳动 | 确定进度才显示百分比；未知进度显示阶段；尊重 reduced-motion |
| Slider | 显示实际值，拖拽之外可键盘调节 | 音量/时间有单位与可访问名称；裁切区间保持起止点关系 |
| File row / Table | 文件名、格式、状态和下载操作对齐 | 小屏转为带字段标签的行卡；文件名可换行，不能把下载藏入 hover |

表单错误在用户离开字段或提交时给出，输入过程中不反复打断；修改后按实际校验清除。成功颜色不表示商业事实已经被 AI 验证；事实由用户确认。

## 8 首页规范

首页任务是让两类团队知道输入什么、能得到什么、如何开始和何时付费。

1. 顶部字标、Examples、Pricing、Help、主题图标、登录/项目入口；主要 Create a video 与当前上下文保持一致。
2. Hero 使用已确定的英文标题 “Turn your product or course into a promo video.” 和辅助说明，采用轻字重衬线排版，可对短语作斜体强调；主 CTA 为 Create a video，次 CTA 为 Watch example。组合预览中的展示文案不自动替代正式产品定位与消息资源。
3. CTA 附近说明免费预览及当前项目包价格/版本数，实际产品价格由服务端目录提供。参考稿的金额仅按 05 展示示例，不作为另一份价格配置。
4. 右侧或下方显示素材到成片的可理解示例；先看见成片主体，再看平台比例，不放无法证明的收益数字或客户徽标。
5. Software product team 与 Course / digital product team 两个用途入口同级，优先使用带下划线选中态的文字入口或平铺内容区；下接样片、三步说明、六平台预设、价格与 FAQ。区块以留白、细分隔线和文字层级组织。
6. 手机首屏保留主标题、CTA、免费预览说明；样片自然向下延伸，不把全部信息压成极小卡片。

公开示例可免登录。上传或生成之前进入已有 Google 登录流程，回跳恢复选择。外部支付商标与合作说明只使用真实允许的内容。

## 9 创建流程规范

Create 页面承载 02 的前四步，第五步进入编辑器。步骤名称为 Setup、Assets、Details、Style；步骤条显示当前步骤与已完成状态，可返回编辑，不伪造业务完成。

| 步骤 | 主要内容 | 主要行动与反馈 |
| --- | --- | --- |
| Setup | 两类任务、15/30 秒、六个平台 | Continue；默认值可修改，平台始终可见 |
| Assets | 截图/录屏/Logo，处理状态与必要裁切 | Upload assets / Continue；至少一份合法视觉素材即可继续 |
| Details | 产品名、受众、卖点、CTA，价格/日期/优惠等选填字段 | 确认事实勾选默认未选；错误指向具体字段 |
| Style | 三种叙事结构、Clean/Bold 成片样式，使用当前素材的缩略预览 | Generate storyboard；显示剩余 AI 次数，失败可 Fill in manually |

桌面摘要显示当前素材缩略图、时长与平台；手机摘要折叠为可展开区。步骤切换保留输入和处理状态，错误摘要提供返回字段的入口。含价格/日期/承诺的内容遵循事实确认规则。

网站文案为英语；用户输入可以同段多语混排。流程中不放 Video language 选择器，也不增加语言识别确认。UI 的系统字体栈不强制成为视频字体。

## 10 编辑器规范

### 10.1 桌面构图

- 顶栏左侧：返回项目、项目名和保存状态。右侧：主题图标、协作者/审阅、撤销重做、成片版本余额和主要导出行动。空间不足时低频操作进入 More，主题图标、导出与保存状态保留。
- 场景栏：248 px；按场景顺序显示缩略图、标题和时长。错误和评论显示数量，点击进入对应位置。
- 中间：播放器、时间位置和播放控件。下方是当前平台预览、安全区开关与四构图入口；保留画布周围呼吸空间。
- 属性栏：320 px；Content、Media、Layout、Audio 分组。选项目级对象时显示项目/品牌设置，选场景时显示对应字段。
- 编辑结构继续采用场景列表与播放进度条；不出现任意轨道叠加、逐帧自由剪辑等未定义功能。

### 10.2 状态与行动文案

AI 使用次数显示在 Generate / Rewrite 对应位置；成片版本余额显示在导出附近，二者不能统一写成含义不清的 credits。

| 当前状态 | 主要行动 | 必须说明 |
| --- | --- | --- |
| 尚未购买 | Buy & export — $39 | 确认面板展示实际内容快照、3 个成片版本、此次用 1 个、保留期与税费 |
| 已有版本余额，准备新内容 | Export new version | 本次用 1 个，成功交付后剩余数量；提交前确认 |
| 尚未完成且仍可继续的支付会话 | Continue payment | 展示该订单的原内容快照；新草稿另存 |
| 付款确认中或需要核查 | View payment status | 保留查询与核查提示，不引导重复付款 |
| 额度耗尽 | Add 3 versions — $12 | 默认仅增加额度；同时导出必须明确选择 |
| 同一版本已交付 | Download files / Add platform files | 重下与同版补平台沿用既有权益，不重复扣版本 |
| 当前操作需要购买，且用户不是 Owner | Ask owner / Copy project link | 沿用站内申请/复制机制，不自动外发消息；Editor 仍可使用已有权益导出 |

以上金额和份数来自 05，真实按钮由订单/权益状态与服务端目录决定。关闭付款页面不被绘制成失败付款或付款成功；站内状态以服务端核实结果为准。

先判断当前快照和任务，再判断是否需要购买。当前快照已预留或正在导出时显示 View export status，重复操作复用原任务；已经交付时，即使余额为 0 也保留 Download files / Add platform files。只有导出不同的新内容且额度不足时，才以追加包为主要入口。

Saving、Saved、Offline draft、Conflict 靠近项目名。字段保存不遮住整个编辑器。冲突有明确查看与处理入口；AI 改写展示修改范围、前后差异和 Accept/Discard，不能直接覆盖原文。

### 10.3 手机构图

预览在上方，场景选择和属性编辑通过底部入口打开。打开面板时保留当前场景、播放位置和输入；面板内部允许滚动。撤销、播放、平台和导出都可操作；不把手机用户送到只能查看的页面。

## 11 交付、项目与辅助页面

交付页顶部显示固定版本、缩略图、时长、创建时间和状态；正在导出旧快照且存在新草稿时明确提示。版本切换先区分已交付版本与当前草稿。

| 交付状态 | 呈现与行动 |
| --- | --- |
| 付款确认中 | 订单状态和查询中提示；View payment status，不要求立即重复支付 |
| 排队/准备/渲染/编码/校验 | 当前阶段；有真实数据才显示进度 |
| 首批文件失败 | 明确失败阶段与 Retry failed files；不放出未发布的零散中间文件 |
| Ready | 各平台 MP4、封面、Copy posting instructions；同文件映射避免让用户误以为重复收费 |
| 补平台进行中 | 原有文件继续可下载，新文件显示自己的状态 |
| ZIP 准备中或失败 | 成片文件保持 Ready；Download all 暂显示准备/免费重试 |
| 项目过期/素材清理 | 显示实际期限与允许操作；素材已清理时不出售无法完成的恢复 |

P0 下载后由用户在对应平台上传，不出现自动 Publish to TikTok / YouTube 的承诺。可复制的发布说明和外链不改变素材权限。

项目列表采用“缩略图 + 项目名 + 状态 + 更新时间/期限 + 更多操作”；筛选优先 All、Drafts、Processing、Ready。空态引导 Create a video 或明确的 Sample project，不填充虚构客户内容。手机卡片单列，桌面按可用宽度排列。

Settings 使用分组设置页，Appearance、Brand、Members、Orders、Support 按已有权限显示。Appearance 显示当前模式、是否跟随设备及 Use device setting 恢复入口；不要求登录或购买才能恢复设备设置。Review 为指定版本的只读预览，醒目标明审阅范围和期限；创建链接前说明持链接者可观看，原素材与高清文件下载遵循既有权限。Help/政策页使用 760 px 阅读宽度；Admin 复用表单、表格和状态组件，字段详情按权限展开。

## 12 可访问性与内容规则

键盘能完成创建、切场景、编辑、付款前确认与下载；所有可点击元素有可访问名称和可见焦点。提供 Skip to content。活动菜单/对话框控制焦点与滚动，关闭后恢复焦点，错误通过关联描述和适当的 live region 宣告。

主要操作触控区域至少 44 px。支持 200% 文本/页面缩放、减少动态效果、长项目名和网站伪本地化。将来网站语言扩展使用 CSS logical properties；当前 UI 仍为英语，用户文案始终按原文保存和排版。

主题变化、进入表单、显示错误不能造成客户画布样式变化或草稿丢失。动画仅表达 hover、进入/退出和重排关系；不让持续装饰动效抢占编辑器注意力，不用固定倒计时假装渲染进度。

## 13 交付物与实施验收

本次仓库交付 UI 规范、两份设计配置、生成器与离线参考页。运行 `mise run build:ui-reference` 更新参考，运行 `mise run check:ui-reference` 检查生成物一致性；`mise run check:repo` 检查文档和配置关系。

参考页为英语、四页面和样例状态，通过图标切换 Light/Dark，并可恢复跟随系统；不连接用户账号、上传、AI、Waffo 或云端渲染。参考页与网站规范采用同一系统字体栈；实际字形取决于测试环境可用字体。Base UI 交互、目标设备字体回退与真实内容排版由应用阶段验收。参考页的页切换、主题切换与浏览器存储只是离线模拟，不是生产路由、HttpOnly Cookie 或 SSR 的实现。

| ID | 应用验收 | 通过条件 |
| --- | --- | --- |
| UI-01 | 首页、创建、编辑器、交付在 390×844、768×1024、1440×900 | 主行动可见、文字不截断、正文无无意义横向滚动 |
| UI-02 | 首访跟随系统、图标切换、保存重访、恢复设备设置 | 控件/浮层/首屏一致；图标和名称表示下一步动作；点击后记住选择并忽略系统变化；恢复后重新跟随系统；保存失败与连续点击符合 THEME-11 |
| UI-03 | 所有基础组件状态 | 默认、hover、pressed、focus、disabled、loading、error 有实际样例 |
| UI-04 | 键盘和弹层 | 无焦点丢失/困在错误位置；Escape、关闭恢复焦点与滚动正确 |
| UI-05 | 200% 缩放、长名字与伪本地化 | 标签、按钮和对话框可重排，关键内容可访问 |
| UI-06 | 手机创建与编辑 | 文件选择、改字、焦点、预览、付款、下载均可完成；键盘不遮住当前任务 |
| UI-07 | 真实视频与网站主题组合 | UI 换色不改帧内容、客户素材、字体、导出样式或版本身份 |
| UI-08 | 免费/有余额/耗尽/活动订单/不同角色 | CTA 与服务端权益一致，次数与版本清楚区分 |
| UI-09 | 事实、保存与 AI 修改 | 不预勾事实确认；错误定位字段；冲突与改写有明确确认路径 |
| UI-10 | 付款延迟、失败、补平台与 ZIP | 状态真实；不重复扣费；文件可见性符合 05 |
| UI-11 | SSR/hydration 与 portals | 无服务器 DOM 访问，首屏一致，浮层继承主题，手机遮罩/滚动正确 |
| UI-12 | UI 与文案分离 | 网站英语，混排文字可直接输入，创建与导出无语言选择/识别确认 |
| UI-13 | 视觉方向与实际字体 | 明暗配色采用共享 tokens；品牌/展示用 Display，操作/编辑用 Sans；系统字体回退后标题、控件和用户文本仍可读，缺字按具体内容定位 |

应用实现后以实际页面和业务状态验证；参考页与静态色彩检查不替代上述应用验收，也不改变 M0 的 Cloudflare/Waffo 可行性出口。当前完成范围与阻塞以 [实施进度](../implementation-status.md) 为准。普通样式修改的构建与检查结果进入 CI 或提交说明，关键外部集成、人工验收与实测才按 [验证记录约定](../evidence/README.md) 留存。

## 14 官方依据与资产记录

以下官方资料核查于 2026-10-19。组件行为和许可来自官方资料；本章的颜色、尺寸、布局与取舍是 PromoBento 的产品设计决定。

- [shadcn Base UI 默认方案](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)、[CLI](https://ui.shadcn.com/docs/cli)、[主题](https://ui.shadcn.com/docs/theming)：基础方案与引入方式。
- [Base UI 快速开始](https://base-ui.com/react/overview/quick-start)、[组件组合](https://base-ui.com/react/handbook/composition)、[MIT 许可](https://raw.githubusercontent.com/mui/base-ui/master/LICENSE)：交互 primitives、portal 与源码许可。
- [Cloudflare React Router](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/)、[shadcn React Router](https://ui.shadcn.com/docs/installation/react-router)、[Tailwind Vite](https://tailwindcss.com/docs/installation/using-vite)：沿用既定 SSR 工程接入样式。
- [Lucide React](https://lucide.dev/guide/react/getting-started)、[Lucide 许可](https://lucide.dev/license)：图标按需导入，保留 ISC 及相关 Feather MIT 声明。

实际引入第三方源码、字体或图标时保存版本、来源和对应许可。网站当前仅声明系统字体栈，无字体文件分发；将来若引入字体资产，需单独记录来源与许可。离线参考中的示例产品界面为本项目绘制的演示内容，不使用真实客户资料或未取得许可的品牌背书。
