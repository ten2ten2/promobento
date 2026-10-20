# 网站国际化与主题

**网站首发英语，客户视频文字允许任意语言混排。** 本章定义当前语言、主题、Cookie、SSR 和缓存规则；作品样式由 Composition 决定。

## 1 网站与视频分别管理

| 概念 | 字段 | 当前规则 |
| --- | --- | --- |
| 网站语言 | uiLocale | en；完整新语言上线后才扩 allowlist |
| 客户文案 | 文本/已确认事实 | Unicode 原文和混排，不需语言选择或识别确认 |
| 文字元数据 | language/direction | 可省略，und/mul 可用，只辅助排版 |
| 主题偏好 | themePreference | system/light/dark，默认 system；不进入视频 hash |
| 有效外观 | resolvedTheme | light/dark，仅影响 UI 和新 checkout 外观 |
| 作品标记 | styleLabel | 自由描述标签，不是渲染分支或封闭枚举 |

[localization](../../config/localization.json) 仅配置 website_ui；验证码邮件按网站消息体系英语首发，不据邮箱后缀、Google 资料或视频文案猜语言。未开放 uiLocale 返回 422 UNSUPPORTED_UI_LOCALE，但用户视频不会触发语言未上线错误。

## 2 消息与用户原文

i18next/react-i18next 使用请求级实例，SSR/hydration 共享消息、locale 和初始时区，不修改模块级当前语言。导航、按钮、标签、空态、错误、aria、帮助短消息和邮件进入 `locales/*.json`；完整政策、About 和帮助文章放在 `content/pages/<locale>/*.md`，维护规则见[页面内容](../../content/pages/README.md)。客户正文不进入翻译目录。命名插值、复数、Intl、缺 key/参数检查由 CI 验；UI 错误可安全英语回退并提供 requestId，不泄露内部 key/堆栈。该回退不用于逐段替换或混合语言法律正文。

资源和用户文字安全输出为纯文本，链接使用受控组件，不把输入 HTML 当脚本。金额明确 USD；首次未知时区显示标注 UTC，hydration 后可转换 UI 日期，但已确认视频报价、币种、日期不换算或重写。

生成/改稿默认保留各字段原语言与混排，只按明确指令翻译指定范围；翻译不扩承诺，也不按语言加价。网站根 lang=en/dir=ltr，文字块方向独立；RTL 与数字/URL/品牌名正确隔离，不倒转字符串或镜像素材。识别失败不能阻止正常创作。

检查实际字形、字体覆盖/塑形、换行、安全区、CJK/RTL/组合字符；加载成功不证明全部字可画。动效不能拆坏组合字符，连写可优先整块/行。问题定位具体字段并给字体/布局修复，不禁整种语言。实际文本、方向、字体/回退和资源随版本冻结，重试/补目标不重新识别或换字体。

## 3 扩展与 SEO

新网站语言须完整覆盖 UI、帮助/政策、邮件、元数据和无障碍，通过插值/复数/Intl/移动排版后开放；网站语言未上线不妨碍同语客户文案。P0 不做翻译后台，伪本地化和约 40% 文字扩展只验架构，不进入生产。

英语使用根路径，不复制 /en；canonical 无主题/UTM，不按 Accept-Language 跳不存在的页面。无空翻译 URI、虚假 hreflang 或 sitemap；真实翻译页面双向映射后再上线。主题不进 URL，私有索引和权限见 12。

语言标识与 URI 映射、法律译文 `sourceVersion` 及缺失/过期处理按[内容多语言规则](../../content/pages/README.md#4-多语言)。未发布语言页面返回真实 404；新政策生效前审阅已启用语言，不用过期译文取得对新版本的接受。

## 4 主题交互和持久化

顶栏只有一个 44×44 太阳/月亮按钮，表示下一动作：Light 显示月亮/Switch to dark mode，Dark 显示太阳/Switch to light mode。支持键盘、focus、tooltip；图标读屏隐藏，仅一个可访问名称，不三态循环或加头部三选菜单。

无有效 Cookie 按 System，设备无偏好默认 Light；设备变化不主动写偏好。点击以当时有效主题取反并保存 light/dark，随后系统变化不能覆盖。Settings Appearance 和公开/审阅页脚提供 Use device setting 恢复 System，访客无需登录或购买。

主题 Cookie 为 `promobento_theme`：system/light/dark、Max-Age 31536000、Path=/、SameSite=Lax、生产 Secure、host-only、HttpOnly，无 Domain；服务端偏好 API 写入，SSR loader 下发。首次/导航/登录不覆盖选择，退出不删除主题，生产与预发布隔离。

一个浏览器页面维护单一串行写队列，最多一在途，只保留最新待写值；最终 Cookie 与最后意图一致。取消 fetch/忽略旧响应不意味着迟到 Set-Cookie 不生效。未知结果标未保存，前一请求收尾后重试最新值；失败保留 UI/草稿并提示重试。Cookie 不可用时当前任务可继续，刷新按 System，不谎称已持久化。

偏好 POST 校验 Origin/CSRF/枚举；匿名只改本浏览器主题，登录用户只改自己已上线 UI 语言，不接受工作区、金额或输出风格。主题不触发模型、草稿保存、编码或账本。离线参考的 localStorage 不是生产 Cookie 实现。

## 5 SSR、缓存与视觉隔离

SSR 输出 data-theme=system/light/dark；System 首屏由 prefers-color-scheme 与 color-scheme CSS 决定，不等待 useEffect、不猜设备。hydration 初值与 SSR 一致。按钮可预先输出两套图标和隐藏文字，由 CSS 仅显示正确一套，另一 display:none 退出可访问树；延迟/禁 JS 时语义仍正确。

匿名无会话/主题/语言 Cookie 的公开英语 HTML 可缓存 System；有相关 Cookie 的个性化 HTML private,no-store 并绕过共享缓存。创建、认证、应用、邀请、审阅、后台、私有授权和 Set-Cookie 一律 no-store。公共内容 hash 静态资源可长缓存；不以 Vary:Cookie 代替实际隔离，需两浏览器验证。

网站 tokens 来自 theme/ui 配置，视觉、响应式和可访问性按 [02](02-ux-and-ui.md)。系统字体不保证跨设备字宽相同，视频使用独立受控资源。Dark 不全局 invert；对比度须在两种主题的实际前景背景组合中验证。

视频在独立来源运行冻结样式，不读取 UI tokens、Cookie 或设备配色。Light/Dark 网站均可播放任意深浅作品。prefers-reduced-motion 只减少 UI 动画，不改视频时间线。styleLabel 不能用于在冻结后偷偷切换实际渲染风格。

## 6 外部界面与验收

新 Waffo session 使用 language=en、合法 resolvedTheme→darkMode，缺提示 Light；活动 session/未知结果请求体不因换主题重建。钱包、银行、Google 页面只用真实提供方能力，返回站内恢复偏好；支付详细协议见 05。

| ID | 必须验收 |
| --- | --- |
| I18N-01 | 不同浏览器/提供方语言下网站 en；未知 uiLocale 拒绝而混排视频可创建 |
| I18N-02 | 复数、插值、USD、UTC/hydration、缺 key/错误安全回退 |
| I18N-03 | CJK/RTL/组合字符/缺字；不自动翻译、删字或加语言门槛 |
| I18N-04 | 无假语言 SEO，伪本地化/40% 扩展，并发 SSR 无串用 |
| THEME-01 | 首访 System 无写 Cookie、设备变化、显式选择优先、刷新/登录恢复 |
| THEME-02 | 两浏览器缓存隔离、延迟/禁 JS 首屏/图标/读屏一致 |
| THEME-03 | 按02验证键盘、触控、视口、缩放与减少UI动效，主题不能隐藏主行动 |
| THEME-04 | 任意作品风格×Light/Dark 下 keyframe/contentHash/账务不变 |
| THEME-05 | Cookie 无效、快速点击、迟到 Set-Cookie、失败重试和恢复设备设置 |
| THEME-06 | Waffo 新会话外观与活动会话复用，未重复 checkout |

两个人群分别测明暗主流程；System 独立测试，不机械翻倍视频矩阵。静态颜色、离线参考和契约通过只证明各自范围，真实字形、SSR/Cookie/缓存和外部往返须实际验收。
