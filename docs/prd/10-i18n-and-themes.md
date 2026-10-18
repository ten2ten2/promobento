# 多语言能力与 Light / Dark Mode

## 1 网站国际化的范围

用户最终澄清：“支持多语言能力，首发英语”针对网站。网站包括公开页面、登录、编辑器操作界面、帮助、政策和后台；先交付英语界面，以后增加其他网站语言。Light / Dark Mode 继续属于 P0。

视频文案是用户内容，可以在同一视频、场景、标题或段落中混用任意语言，与网站国际化无关。创建、生成、手动编辑、预览和导出均不要求选择一种视频语言，也不要求确认自动识别结果。

| 概念 | 代码字段 | 首发规则 | 影响范围 |
| --- | --- | --- | --- |
| 网站界面语言 | `uiLocale` | `en` | 导航、表单、帮助、政策、错误、无障碍标签、后台 |
| 用户文案 | 场景 `text` 等内容字段 | 原文及多语混排，不设语言名单 | 视频文字与用户编辑内容 |
| 可选内容语言元数据 | `language` / 文本块元数据 | 可省略；未知可用 `und`，混排可用 `mul` | 辅助排版，不是用户必选项或准入条件 |
| 网站主题偏好 | `themePreference` | `system`、`light`、`dark`；默认 system | 网站与播放器外壳，不进入项目快照 |
| 当前有效网站主题 | `resolvedTheme` | `light` 或 `dark` | CSS 呈现和新建 Waffo 收银台外观 |
| 视频视觉样式 | `videoStyle` | `clean` 或 `bold` | 视频背景、客户品牌色与过渡，属于内容快照 |

`config/localization.json` 只配置网站国际化，首发 `supportedUiLocales=["en"]`。其中不包含视频语言白名单、默认视频语言或视频语言选择器。首发隐藏网站语言切换器，未来只有完整网站语言上线后才显示对应入口。

网站偏好 API 的未启用 uiLocale 返回 422 `UNSUPPORTED_UI_LOCALE`；不调用 AI、不创建渲染作业或扣减额度。视频文案不会触发“语言未上线”错误。浏览器 Accept-Language、Google 账户语言和网站 Cookie 不改写用户内容；语言识别不确定也不阻断正常工作。

## 2 英语 UI 与国际化工程

使用 i18next + react-i18next，按模块维护 stable message key；从英文资源产生消息 key 类型。`locales/en.json` 是首批关键文案种子，实施者必须补齐所有实际界面，不能把种子当作完整覆盖证明。推荐模块为 common、marketing、auth、projects、editor、billing、settings、platforms、errors、admin。

所有用户可见静态文案进入资源：按钮、字段标签、校验、空态、toast、菜单、tooltip、aria-label、上传/导出状态、账务状态、确认弹窗、工单提示和下载说明。长篇英语政策和帮助可以存独立内容文件，但同样登记语言与内容版本。客户输入、项目名称、品牌名称和事实数据不进入 UI 翻译字典。

使用命名插值，例如 `{{count}}`、`{{amount}}`；数量通过 i18next 的 `_one` / `_other` 规则处理，不拼接“数量 + 英语词”。资源字符串按纯文本输出；React 负责文本转义，禁止为了渲染翻译或用户输入使用不受控 HTML。确需链接时使用受控组件占位，不接受资源中的任意脚本或客户 HTML。[i18next 复数](https://www.i18next.com/translation-function/plurals)、[插值](https://www.i18next.com/translation-function/interpolation)

API 错误返回稳定 code、messageKey、安全 params 和英语 message 回退，前端通过 key 显示。缺少 key 时显示通用英语错误并保留 requestId，记录缺失告警；不能直接向客户显示内部 key。开发和 CI 对缺少生产必需 key、重复 key、插值不匹配及无效复数配置报错。

使用 Intl 格式化数字、金额、日期和相对时间。UI 的英语资源代码为 en，默认数字格式 locale 为 en-US；金额明确 currency=USD。语言偏好只改变显示格式，不改变目录价、账本单位或付款币种。项目事实中的价格、促销日和时区按客户确认内容展示，不根据观看者环境重新解释。[Intl](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl)

每个 SSR 请求创建自己的 i18n 实例或请求上下文，不能在共享 Worker 模块中修改全局当前语言。服务端把实际语言与本页所需资源传给客户端，hydration 使用同一组值；首发不等待远程翻译服务返回才显示页面。[react-i18next SSR](https://react.i18next.com/latest/ssr)

SSR 与首次 hydration 使用同一时区。首次尚未取得浏览器时区时，时间先按明确标注的 UTC 显示，客户端就绪后再更新为已验证的 IANA 时区；不能让服务器和客户端在首次渲染分别用各自默认时区，造成日期差异或 hydration 报警。货币和已确认视频事实不随该更新改变。

## 3 用户文案与网站翻译资源的边界

网站的按钮、标签和提示进入英语资源；用户输入的标题、正文、CTA、手动字幕、产品名和原始素材不进入网站翻译字典。文案以 Unicode 原文保存，允许同片、同段混排，无需统一成单一语言。

普通分镜生成和 AI 改写默认沿用用户各字段的语言与有意混排，不因网站为英语而把所有内容翻成英语。只有用户明确提出翻译或语言要求时，才对指定内容执行；要求可以直接写在文案指令里，例如“标题保留英文，说明用中文”。不新增全局 Video language 选择器或语言识别确认步骤；识别失败不作为拒绝生成的理由。

用户确认仍然针对商业事实和候选文案。名称、商标、URL、币种、数值与促销日期不得被模型擅自改写，翻译不自动换算价格或扩写承诺。原始截图、录屏和音频保留原样。手动编辑不消耗 AI 次数；明确的 AI 改写及内容版本导出继续使用既有配额、事实确认和快照规则，不按语言增加费用。

预览画布、输入框和文本块可以使用自己的语言/方向元数据；网站根保持 `lang=en`、`dir=ltr`。自动方向仅辅助处理，必要时允许纠正文本排版；实际使用的方向在渲染快照中固定。RTL 与数字、URL、拉丁品牌名混排时正确隔离方向，保留逻辑文本顺序，不反转字符串或镜像客户素材。[W3C 文本方向](https://www.w3.org/International/questions/qa-html-dir)、[混排隔离](https://www.w3.org/International/articles/inline-bidi-markup/)

浏览器预览与容器使用同一组受控字体及回退顺序，检查实际缺字、塑形、断行与安全区。字体加载成功不等于字符均可正确呈现；问题定位到具体字段并提供字体、布局或文字调整入口，不把整种语言列为禁用。截断和字符动效不能拆坏组合字符；复杂连写优先整块/整行动效。换行与字形问题属于内容渲染质量，不属于网站语言上线流程。[Unicode 换行](https://www.unicode.org/reports/tr14/)、[字体检查的边界](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/check)

实际文案、用于排版的可选语言元数据、方向、字体和 videoStyle 随内容 revision 固定；uiLocale 与网站主题不参与视频内容 hash。改稿保存在新草稿，已确认的购买/成片快照不变；重试或补平台不重新识别语言或切换字体。同一冻结版本仍按原免费补文件与重下规则处理。

## 4 网站多语言的扩展路径

首版网站使用 UTF-8、stable message key、命名参数、复数、Intl、CSS logical properties 与请求级语言上下文。测试伪本地化和长文本，用于验证未来网站语言扩展，不作为用户文案准入名单。

新增网站语言时，补齐界面、政策/帮助、页面元数据和无障碍文案，验证插值、复数、数字日期、移动布局及该网站语言所需的方向，再开启 UI allowlist 和真实页面。用户视频内容不需要等待相应网站语言上线；英语网站可以编辑中英混排及其他语言的文案。

网站语言配置更新不改变已有视频、素材、订单或 renderer 版本。P0 不建立翻译管理后台；当前只交付英语网站资源，后续按真实需求增加完整网站语言。

## 5 SEO 与 URL

主域为 `https://promobento.com`，首发公开页面输出 `<html lang="en" dir="ltr">`。英语沿用 `/`、`/pricing`、两类用途页等根路径，不另外复制一套 `/en/` 页面。页面 canonical 指向本页干净 URL，不包含主题、语言偏好或获客参数。主题通过 Cookie 和 CSS 保存，不改变 URL。

不创建 `/zh/` 等空翻译页，不生成不存在语言的 sitemap 或 hreflang，不依据 Accept-Language 重定向到未上线页面。普通英语 URL 不因不同浏览器语言返回不同语言正文。未来真实上线其他语言时增加稳定的语言路径、各自 canonical 与对应页面的双向 hreflang；不能把所有真实翻译页 canonical 回英语页。[Google 多语言站点](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites)

## 6 主题交互与持久化

公开页面导航、应用顶部和 Settings 的 Appearance 均提供 System / Light / Dark。选项用文字与选中状态表达，可用键盘操作。手机把入口放入导航菜单；访客、Owner、Editor 和只读审阅者都能使用，不收费。

| 场景 | 结果 |
| --- | --- |
| 首次访问，没有有效偏好 | System，按系统选择 Light 或 Dark；浏览器无偏好时为 Light |
| 用户选择 Light | 立即使用 Light；后续系统改变外观不覆盖显式选择 |
| 用户选择 Dark | 立即使用 Dark；后续系统改变外观不覆盖显式选择 |
| 用户选择 System | 立即跟随系统，系统之后改变时自动更新 |
| 刷新、导航、OAuth 返回、再次访问 | 恢复当前浏览器的有效偏好 |
| Cookie 不可用或已过期 | 当前页面可用；新请求按 System 回退，不阻断创建付款 |

偏好 P0 按浏览器保存，Cookie 名 `promobento_theme`，值仅为 system/light/dark，Path=/，SameSite=Lax，生产 Secure，host-only，不设置跨子域 Domain。由服务端偏好接口设置 HttpOnly Cookie；客户端从 SSR loader 接收当前偏好，切换后在内存立即更新并提交保存。持久化请求失败时用英语说明，没有因此重载或清空草稿。正式和预发布的主题及会话互不共享。

`POST /api/preferences` 支持同源调用，执行 Origin/CSRF 检查与枚举校验。未登录可保存本浏览器主题；已登录可更新自己的 uiLocale 偏好，首发仅 en。接口不接受 workspace、价格、导出语言或视频样式的隐式变更。主题改变不能触发 AI、autosave 项目 revision、重新编码或账务写入。

## 7 SSR、CSS 与 Cloudflare 缓存

SSR root loader 读取有效 Cookie，输出 `data-theme="system|light|dark"`。Light 和 Dark 使用明确 tokens；System 使用首屏 CSS 媒体查询 `prefers-color-scheme`。同步设置相应 `color-scheme`，适配原生表单、滚动条及浏览器控件。服务器不需要猜测访客系统外观，首屏也不需要等 useEffect 或远程请求再改颜色。[MDN 主题偏好](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-color-scheme)、[React Router 状态管理](https://reactrouter.com/explanation/state-management)

关键主题 CSS 随首屏样式提供；两套 tokens 在同一个版本中交付。hydration 使用服务器给出的 themePreference，System 的当前有效颜色交给 CSS 处理。JS 中只在组件确实需要或新建 checkout 时读取 matchMedia；不得在 React 首次渲染用另一套判断覆盖服务端属性。

| 响应 | 缓存规则 |
| --- | --- |
| 匿名、无会话/主题/语言偏好 Cookie 的公开英语 HTML | 可按公开策略缓存，统一输出 System；不要因匿名访问主动写偏好 Cookie |
| 有相关 Cookie 的个性化 HTML | private, no-store；绕过共享 HTML 缓存 |
| `/app`、订单、OAuth callback、私有素材授权、审阅及管理员响应 | 维持鉴权与私有缓存规则；不进入公共 HTML 缓存 |
| `POST /api/preferences` 与其他 Set-Cookie 响应 | no-store，不缓存用户偏好写入 |
| 带内容 hash 的 CSS、JS、字体与公共静态资源 | 可 CDN 长缓存；版本更新生成新 URL |

不能只写 `Vary: Cookie` 就认为 Cloudflare 已自动隔离主题。通过实际 Cache Rules/Worker 缓存逻辑绕过个性化 HTML，并用两个浏览器验证；Cloudflare 默认不按一般 Vary 值区分缓存。[Cloudflare Origin Cache Control](https://developers.cloudflare.com/cache/concepts/cache-control/)

## 8 语义色彩、可读性与视频隔离

`config/theme-tokens.json` 提供首版 Light/Dark 初值。组件引用 `--ui-bg`、`--ui-surface`、`--ui-text`、`--ui-border-control`、`--ui-primary`、`--ui-focus`、`--ui-danger` 等语义变量，不在业务组件中散落固定白底黑字。两个主题覆盖默认、hover、focus、selected、disabled、loading、empty 和 error 状态。

网站普通文字目标对比度至少 4.5:1，符合大字定义的文字至少 3:1；识别控件和状态所必需的边界、图形与焦点目标至少 3:1。错误、选中和作业状态同时有文字或形状标识。对比度基于实际前景和背景组合，不只检查色板。源要求和例外分别见 [W3C 文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) 与 [非文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)。

Dark 需要重新选择表面、文本、边界和状态色，不使用全局 invert/filter。截图、录屏、客户 Logo 与成片画布保持原色；有透明 Logo 时由客户视频设计决定其衬底，不偷偷随网站主题换色。播放器外壳、控制条和安全区工具适配 UI 主题，导出画面只取视频数据。

renderer 与预览画布只使用 `--video-*` 或明确的场景样式；不能读取 `--ui-*`、主题 Cookie 或操作系统配色，也不能被全局 dark 选择器命中。SceneDocument 显式存 videoStyle、direction 和客户色值；字体与帧逻辑继续按 04 固定。Light UI 可以播放 Bold 成片，Dark UI 可以播放 Clean 成片。

主题切换以即时换色为主，不强制整页渐变；尊重 prefers-reduced-motion。编辑器 UI 减少动态效果不改变客户视频的动效时序。

## 9 Waffo 与其他外部界面

Waffo 新 checkout 传 `language: "en"`，并把当前有效主题映射成 `darkMode`。System 的有效主题由客户端在新建请求时解析，只是外观提示，不能影响业务订单身份。缺少提示时默认 Light；已存在活动订单继续复用原 session，不为了换色创建第二次可付款会话，也不改变一次未知结果重试的原始请求体。[Waffo Checkout](https://docs.waffo.ai/api-reference/endpoints/orders/create-checkout-session)

Waffo 允许买家在收银台切换其支持的语言；这不改变 PromoBento 网站语言或用户文案。Google 登录、钱包和银行验证页由各提供方控制。返回 PromoBento 后仍恢复本地英语界面及主题偏好，付款结果继续只由回调和对账确认。

## 10 P0 验收矩阵

| ID | 操作或输入 | 必须结果 |
| --- | --- | --- |
| I18N-01 | 浏览器 en/zh/es，Google 账户不同语言 | 自有界面始终英语；无未开放语言入口，lang=en |
| I18N-02 | 网站偏好 API 显式传未上线 uiLocale | 422 UNSUPPORTED_UI_LOCALE；只校验网站偏好，不限制项目文案或调用 AI |
| I18N-03 | 0、1、2 个剩余额度，插值金额和日期 | 复数和插值正确；USD 与事实金额不变，SSR/hydration 一致 |
| I18N-04 | 缺 key、错误参数、供应商错误 | 构建发现缺项；运行时英语回退，不显示内部 key/堆栈 |
| I18N-05 | 中英混排、RTL 与数字/URL、组合字符、未知字形和原始截图 | 原文与素材保留；按实际字形/方向处理或定位具体字段，不静默翻译、删字或要求先选语言 |
| I18N-06 | 页面源码、canonical、sitemap、偏好参数 | 只有真实英语页面，无虚假 hreflang 或占位翻译 URL |
| I18N-07 | 测试专用伪本地化目录和约 40% 文本扩展 | 资源和插值可替换，主要布局不被固定英语宽度锁死；伪语言不进入生产 allowlist 或 sitemap |
| I18N-08 | 并发 SSR 请求与浏览器时区不同 | 无跨请求语言污染，首屏日期一致；视频确认事实不随观看者变化 |
| I18N-09 | 同片/同段多语文案，不传 language 或语言识别无结果 | 可创建、生成、编辑并进入正常预览/导出流程；无全局视频语言选择或识别确认门槛 |
| THEME-01 | 首次访问，系统 Light / Dark，禁用或延迟 JS | System 首屏配色正确，无先浅后深闪烁，无 hydration 警告 |
| THEME-02 | 手动 Light / Dark 后再改变系统主题 | 显式选择优先；System 时才跟随系统变化 |
| THEME-03 | 刷新、导航、登录往返、重新访问 | 同浏览器偏好恢复，草稿、播放器与选择不丢失 |
| THEME-04 | 访客与登录用户、两浏览器不同偏好访问同 URL | 个性化 HTML 不串主题或账户；静态资源仍正常缓存 |
| THEME-05 | 两主题的表单、菜单、弹窗、错误、禁用和键盘焦点 | 对比度、可访问名称和操作通过；状态不只用颜色 |
| THEME-06 | Clean / Bold × Light / Dark UI | 同快照 keyframe、内容 hash、release、额度不因 UI 主题变化 |
| THEME-07 | 390×844、768×1024、1440×900；减少动态效果 | 主题入口可操作，编辑器与内容可读，未重做客户视频动效 |
| THEME-08 | 无效 Cookie、偏好保存失败、预发布与生产 | 安全回退，主任务可继续；host-only Cookie 不跨环境共享 |
| THEME-09 | System/Light/Dark 下首次结账，随后切主题重开付款 | 新会话英语与 darkMode 正确；原活动 session/请求体复用，付款快照不变 |

两个人群各跑 Light 与 Dark 的关键用户闭环。保留原四构图渲染矩阵，增加有针对性的 UI/视频样式隔离检查；不为了网站两套颜色把全部云端视频测试翻倍。测试伪本地化仅验证网站扩展架构，不证明第二种网站语言已上线；用户混排文本另按真实排版验证。

## 11 交付与完成定义

P0 交付包括网站英文资源、类型与缺 key 校验、请求级 i18n、已上线网站语言校验、语义 tokens、主题选择器与 Cookie、SSR 首屏和缓存规则，以及上表的实际测试证据。README 和演示中的英语首发只描述网站；正式域、第三方支付和真实平台上传仍按 06 的独立门槛验收。

本文件及 JSON 是实施规格与种子配置，不是已经实现的 UI。可以静态校验资源和色彩对比度，但真实浏览器首屏、主题持久化、Waffo 和视频输出仍需在产品实现后验证。
