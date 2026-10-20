# PromoBento 品牌素材

品牌图形由项目所有者提供，供 PromoBento 使用。资源路径在 [brand.json](../../config/brand.json) 登记，英文文案在 [en.json](../../locales/en.json) 维护。

## 文案分工

| 场景 | 使用内容 |
| --- | --- |
| 首页 H1、首次介绍产品 | `marketing.headline`：Turn your product or course into a promo video. |
| 首页辅助说明 | `marketing.description`：说明素材、创作与导出 |
| 页脚、About、品牌资料、分享图 | `marketing.tagline`：Promo videos, packed like a bento. |
| 首页 title / OG title | 品牌名 + `category`，例如 PromoBento — AI Promo Video Maker |
| 首页 description / OG description | 产品主标题与辅助说明，不只放口号 |

首屏只设一个主标题；口号可作小字或放在页脚。用途页按自己的主题写标题和描述。品牌配置与英文消息使用相同的 `headline` / `tagline`，以后译文沿用这些键。

## 文件与来源

路径相对 `public/`。修改矢量源后，重新导出对应 PNG/ICO。

| 文件 | 用途 / 尺寸 | 矢量来源 |
| --- | --- | --- |
| `icon.svg`、`favicon.ico` | 浏览器图标；ICO 含 16/32/48px | `brand/mark.svg`，兔子头像 |
| `apple-touch-icon.png` | 180×180，不透明主屏幕图标 | `brand/app-icon.svg`，带打板的兔子 |
| `icon-192.png`、`icon-512.png` | 192×192 / 512×512，安装图标 | `brand/app-icon.svg` |
| `icon-maskable-512.png` | 512×512，自适应裁切图标 | `brand/icon-maskable.svg` |
| `og-image.png` | 1200×630，默认分享图 | `brand/og-image.svg` |
| `brand/mark-dark.svg`、`brand/mark-white.svg` | 透明底单色标志 | 各自为矢量源 |
| `manifest.webmanifest` | 名称、启动路径、颜色及安装图标 | 引用上述安装图标 |

`icon.svg` 与 `brand/mark.svg` 保持一致。Maskable 图标保留安全区，不用普通安装图标替代。

分享图的字标和口号分别采用 Schibsted Grotesk Bold、Geist Sans Regular，已转为 SVG 路径，无需下载字体。两种字体采用 SIL OFL 1.1；后续引入字体文件时保留包内版权与许可文件。网站字体配置见 [UI tokens](../../config/ui-tokens.json)，当前仓库不含字体文件。

## 网站接入

生产构建把 `public/` 运行资源映射到站点根路径，排除本说明文件。使用 `brand.assets` 中的路径，不复制第二套源图。当前生产网站尚未接入以下标签：

```html
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">
<link rel="manifest" href="/manifest.webmanifest">
```

| 分享元数据 | 来源 |
| --- | --- |
| `og:type` / `og:site_name` | `website` / `brand.brandName` |
| `og:title` / `og:description` | 当前公开页面标题与说明 |
| `og:url` | 当前页面 canonical URL |
| `og:image` / `twitter:image` | `new URL(brand.assets.socialImage.path, brand.appUrl).href` |
| `og:image:width` / `og:image:height` | `brand.assets.socialImage.width` / `.height` |
| `og:image:alt` / `twitter:image:alt` | `brand.assets.socialImage.altMessageKey` 对应消息 |
| `twitter:card` / `twitter:title` / `twitter:description` | `summary_large_image` / 页面标题 / 页面描述 |

环境 URL 取可信部署配置。私有项目、审阅 token 和账号信息不进入公开分享卡片。上线时检查资源响应与抓取权限；固定文件名允许缓存重新验证，需要长期不可变缓存时使用内容哈希文件名。Manifest 仅提供安装元数据，当前没有 Service Worker 或离线创作。

格式依据：[Open Graph](https://ogp.me/)、[Web App Manifest 图标安全区](https://www.w3.org/TR/appmanifest/#icon-masks)。

## 界面中的使用

网站从品牌的橙、奶油、可可色派生配色，实际颜色只取[主题 tokens](../../config/theme-tokens.json)，不从 SVG 或 manifest 抽取。字体、橙色用量、控件圆角和 Studio 中性背景见 [UI 规范](../../docs/prd/02-ux-and-ui.md#2-视觉系统与基础组件)。

兔子可用于导航、登录、空态、加载、导出完成、404、邮件和分享图；不装饰价格/退款说明或错误提示，也不放入客户作品。品牌预览水印单独按 [preview.json](../../config/preview.json) 处理，付费导出不添加 PromoBento 品牌水印。

标志旁已有 PromoBento 文字时用空 `alt`；单独作为首页链接时，给链接明确的可访问名称。浅底用深色标志，深底用白色标志。离线 Studio 从同一组 SVG 生成内嵌 data URL，不向外请求资源。
