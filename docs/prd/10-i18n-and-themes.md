# 多语言能力与 Light / Dark Mode

v2.2 consistency-1。**网站首发英语，客户视频文案可任意语言混排。** 修订仅去掉旧视频语言/样式枚举，不改变已确定的主题、Cookie、SSR和网站多语言规则。

## 1 网站和内容分别管理

| 概念 | 字段 | 规则 |
| --- | --- | --- |
| 网站界面语言 | uiLocale | en；未来只有完整上线语言才开放 |
| 客户文案 | Composition文本/已确认事实 | Unicode原文、多语混排；不需要全局语言选择或识别确认 |
| 内容排版元数据 | 文本块language/direction | 可省略、und/mul；仅辅助字形/方向，不是准入条件 |
| 网站主题 | themePreference | system/light/dark，默认system；不进入视频hash |
| 当前外观 | resolvedTheme | light/dark；影响网站与新checkout外观，不影响金额 |
| 作品视觉 | Composition源码、可选styleLabel | 自由值，不使用clean或bold的封闭枚举 |

`config/localization.json`仍只为website_ui，supportedUiLocales=[en]，隐藏未上线网站语言入口。验证码邮件按同一网站消息体系首发英语，不按邮箱后缀/Google账户或视频文案猜邮件语言。API传未开放uiLocale返回422 UNSUPPORTED_UI_LOCALE，但客户视频内容不能触发该错误。

## 2 国际化与用户原文

i18next/react-i18next请求级实例和集中英语资源，模块覆盖common/marketing/auth/projects/editor/billing/settings/platforms/errors/admin；SSR/hydration使用相同消息、locale和时区，不修改模块级全局语言。支持命名插值、复数、Intl；缺key/参数/复数由CI报错，运行回退安全英语错误和requestId，不向用户展示内部key或堆栈。客户正文不进入翻译资源。

静态导航、字段标签、空态、aria、政策/帮助/邮件等均登记资源和内容版本。纯文本安全呈现，链接用受控组件，不把用户HTML或翻译字符串当自由脚本。金额明确USD，日期首次未知时区按标注UTC，hydration后可转换UI时区；视频确认的价格、币种、日期不能自动换算或重写。

默认生成/改稿保留各字段原语言及混排，只有用户明确要求才翻译指定内容，例如英文标题/中文说明；翻译不扩写承诺，不触发额外语言收费。网站根lang=en/dir=ltr，视频文本块方向独立，RTL与数字/URL隔离，不倒转字符串或镜像素材。无法识别语言不是创建/生成/导出失败理由。

字形检查涵盖实际字体覆盖、复杂塑形、换行、RTL/CJK、数字/URL、组合字符与安全区；不能只凭字体加载事件称全部字符可用。字幕动效不拆组合字符，连写文字优先按块/行处理。错误按字段提供字体/布局修复，不禁整种语言。实际文本、字体/回退、方向随不可变源码快照固定，重试和补平台不重新识别/换字体。

## 3 网站语言与SEO扩展

新增网站语言前完整补齐界面、帮助/政策、元数据和无障碍，验证插值/复数/Intl/移动布局/方向后再开allowlist。英语网站仍可编辑任意客户文本，不等待同语网站上线。P0不建翻译后台；伪本地化与约40%文案扩展只为验证架构，不进入生产UI名单。

主域promobento.com，英语沿用根路径而非重复/en；canonical干净无主题/UTM，不按Accept-Language重定向到未上线语言。不得创建空/zh页面、虚假hreflang或sitemap。未来真实双向语言页才登记对应canonical/hreflang，不全部canonical回英语。主题不进URL，真实私有路由索引与no-store按12。

## 4 主题交互与持久化

公开页/应用顶栏用单个44×44太阳/月亮图标，表达下一步动作：当前Light→月亮，Switch to dark mode；当前Dark→太阳，Switch to light mode。支持Tab/Enter/Space/可见focus，图标对读屏隐藏，动作只出现一个可访问名称；不加Appearance文字头部三选菜单、不三态循环或隐藏手势。

初次没有有效Cookie按System，设备无偏好默认Light；设备外观变化不主动写偏好。用户点击根据当时resolvedTheme取反并立即保存显式light/dark，之后系统变化不能覆盖。Settings Appearance显示模式及Use device setting恢复system；公开/只读页脚也有恢复动作，访客无须登录。免费、Owner、Editor、审阅者都可使用。

Cookie仍为 `promobento_theme`：system/light/dark、Max-Age=31536000、Path=/、SameSite=Lax、生产Secure、host-only，无Domain；由服务端偏好API写HttpOnly，SSR loader传给客户端。首次/导航/系统变化/登录不主动覆盖显式选择，退出认证不删主题。生产和staging隔离。

同页写入单一串行队列，最多1个在途，仅保留最新待保存值；先前响应不能把UI回滚，最终Cookie与最后意图一致。不能仅取消请求或忽略旧响应就认为旧Set-Cookie不再生效。未知结果标未保存，待前一写结束后按队列重试最新值；失败保留主题/草稿，显示themeSaveFailed英语提示和重试。Cookie不可用/到期时当前任务可继续，刷新按System回退，不宣称未保存选择一定恢复。

POST preferences执行Origin/CSRF和枚举验证，匿名可改本浏览器主题、已登录可改自己的已上线UI语言，不接受workspace/价格/输出语言/作品样式。主题不触发模型、project autosave、编码或账本写入。离线参考localStorage只是示意，不证明生产Cookie已经实现。

## 5 SSR、CSS、缓存和视觉隔离

SSR root输出data-theme=system|light|dark；System由首屏prefers-color-scheme CSS和color-scheme决定，不等useEffect，不猜设备。两套tokens同版本交付；hydration仍使用SSR偏好，matchMedia仅在必要控件/新checkout读取。

SSR按钮可同时输出两组图标+隐藏文字，通过同一CSS仅显示正确的一组，另一display:none退出可访问树；不能固定aria-label覆盖实际动作。延迟/禁JS下颜色、图标和可访问语义仍正确，不出现闪烁或hydration警告。

匿名且无会话/主题/语言Cookie的公开英语HTML可缓存System；相关Cookie存在的个性HTML private,no-store并绕过共享缓存。创建/登录/认证API/应用/邀请/审阅/管理员/私有授权与Set-Cookie均no-store。仅内容hash公共静态资源可长缓存；不能只加Vary:Cookie就自称隔离，实际Cache Rules/Worker行为需两浏览器验证。

网站仍使用既有 `config/theme-tokens.json`、`config/ui-tokens.json`；Georgia/Times衬线展示、Arial/Helvetica等无衬线正文，冷中性表面和蓝灰操作。系统字体回退不等于跨设备字宽一致；网站字体与视频受控字体不同。Dark不采用全局invert。普通文字4.5:1、大字3:1、必要控件/边界/focus3:1，按实际背景检测，状态不只用颜色。

视频在独立origin中使用冻结Composition样式/字体，不读--ui-*、主题Cookie或操作系统配色；Light网站可播放任意深/浅风格，Dark同理。prefers-reduced-motion减少编辑器UI动效，不改变客户视频时间线。复杂片可有任意自定义styleLabel，UI/manifest不得以clean|bold作为允许范围。

## 6 外部页面与验收

新Waffo checkout的language=en、darkMode由合法resolvedTheme决定；缺提示用Light。已存在活动session不因切主题再创建，可恢复请求体也不改变。提供方允许的语言切换不影响视频；钱包/银行/Google等外部界面不承诺自定义。站内返回恢复网站偏好。支付细则和单位/签名继续05，本次不改提供方协议。

I18N-01..09保留：英语网站/非英语浏览器；未上线uiLocale拒绝；复数/金额/UTC-hydration；缺key回退；CJK/RTL/组合字符/未知字形；无假语言SEO；伪本地化；并发SSR隔离；无视频语言字段仍能创建和混排。

THEME-01..11保留：首次System无写Cookie；设备变化及显式选择优先；刷新/导航/登录恢复；两浏览器缓存隔离；键盘/读屏/44px；任意视频风格×Light/Dark内容hash和账务不变；三个视口与减少动态；Cookie无效和保存失败；Waffo新session与原session外观；Use device setting恢复；快速连点和迟到Set-Cookie最终一致。

两个人群各测明暗主流程，System独立测试，不把视频矩阵机械乘UI主题。真实字形、网站SSR、Cookie、缓存、外部跳转未运行不能称通过。静态tokens对比度、离线参考检查和契约fixture只能证明各自检查范围。
