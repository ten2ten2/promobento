# PromoBento 品牌素材

来自项目所有者提供的 `promobento-icons.zip`。保留原始图形、PNG/ICO 和已转曲的分享图，仅整理 SVG 的内部版本标题。素材路径由 [brand.json](../../config/brand.json) 登记，英文文案由 [en.json](../../locales/en.json) 提供。

## 文案分工

| 场景 | 使用内容 |
| --- | --- |
| 首页 H1、首次介绍产品 | `marketing.headline`：Turn your product or course into a promo video. |
| 首页辅助说明 | `marketing.description`，解释真实素材、创作和导出 |
| 页脚、About、品牌资料、分享图片 | `marketing.tagline`：Promo videos, packed like a bento. |
| 首页 title / OG title | 品牌名 + `category`，例如 PromoBento — AI Promo Video Maker |
| 首页 description / OG description | 产品主标题与辅助说明；不只放品牌口号 |

首屏以一个产品主标题为中心。口号可以在页脚或小字中出现，不与 H1 并排放成两个主标题。用途页的标题和描述按页面主题编写。两句文案的 `headline` / `tagline` 在品牌配置和英文消息中一一对应；未来译文沿用相同键。

## 文件与生成来源

路径相对 `public/`。PNG 与 SVG 源图一起维护，修改图形后重新导出对应尺寸。

| 文件 | 尺寸 / 用途 | 矢量来源 |
| --- | --- | --- |
| `icon.svg`、`favicon.ico` | 浏览器图标；ICO 含 16/32/48px | `brand/mark.svg`，兔子头像 |
| `apple-touch-icon.png` | 180×180，不透明，主屏幕图标 | `brand/app-icon.svg`，带打板的兔子 |
| `icon-192.png`、`icon-512.png` | 192×192 / 512×512，安装图标 | `brand/app-icon.svg` |
| `icon-maskable-512.png` | 512×512，自适应裁切图标 | `brand/icon-maskable.svg` |
| `og-image.png` | 1200×630，公开页面的默认分享图 | `brand/og-image.svg` |
| `brand/mark-dark.svg`、`brand/mark-white.svg` | 透明底单色标志，按背景选择 | 各自为矢量源 |
| `manifest.webmanifest` | 名称、启动 URL、颜色与安装图标元数据 | 图标路径指向同目录文件 |

保留 maskable 图案的安全区，不使用普通安装图标直接替换。`icon.svg` 与 `brand/mark.svg` 保持一致。分享图中的字标和口号已转路径，无需加载字体；来源包注明 Fredoka / SIL OFL，仓库未包含字体文件。

## 网站接入

生产 web 构建将仓库 `public/` 的运行资源映射到站点根路径，排除本说明文件；不要再复制一套品牌源图到其他目录。当前仅有素材与离线参考，生产网站尚未接入这些标签。

```html
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">
<link rel="manifest" href="/manifest.webmanifest">
```

实际页面从 `brand.assets` 读取路径。公开页面的分享元数据按下表生成；私有项目、审阅 token 和账户信息不放进公开分享卡片。

| 元数据 | 来源 |
| --- | --- |
| `og:type` / `og:site_name` | `website` / `brand.brandName` |
| `og:title` / `og:description` | 当前公开页面标题与功能说明 |
| `og:url` | 当前公开页面的 canonical URL |
| `og:image` / `twitter:image` | `new URL(brand.assets.socialImage.path, brand.appUrl).href` |
| `og:image:width` / `og:image:height` | `brand.assets.socialImage.width` / `.height` |
| `og:image:alt` / `twitter:image:alt` | `brand.assets.socialImage.altMessageKey` 对应的消息 |
| `twitter:card` / `twitter:title` / `twitter:description` | `summary_large_image` / 当前页面标题 / 当前页面描述 |

默认生产分享图 URL 为 `https://promobento.com/og-image.png`；环境 URL 使用可信部署配置。上线时验证静态资源响应与抓取权限。固定文件名使用可重新验证的缓存；需要长期不可变缓存时先采用内容哈希文件名。manifest 只提供安装元数据，未实现 Service Worker 或离线创作能力。

元数据结构参考 [Open Graph](https://ogp.me/)；maskable 安全区参考 [Web App Manifest](https://www.w3.org/TR/appmanifest/#icon-masks)。

## 界面与作品中的使用

素材的橙 `#F0A868`、奶油 `#FFF8EC`、可可 `#4A3B35` 属于品牌图形。网页背景、操作色、字体与主题继续按 [UI 规范](../../docs/prd/02-ux-and-ui.md)；manifest 的颜色不替换页面 tokens。

标志旁已有 PromoBento 文字时使用空 `alt`，避免重复播报；标志单独承担首页链接时，链接须有明确的可访问名称。浅底用深色标志、深底用白色标志。离线 Studio 从这些 SVG 生成内嵌 data URL，保持单文件预览和现有网络限制。

本组素材用于 PromoBento 品牌，不自动进入客户作品的素材库。预览品牌水印由可信宿主按 [preview.json](../../config/preview.json) 处理，付费导出不添加 PromoBento 品牌水印。
