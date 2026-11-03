# PromoBento 品牌资源

品牌配置见 [brand.json](../config/brand.json)，英文营销文案见 [en.json](../locales/en.json)，色彩/字体/控件以 [theme](../config/theme-tokens.json) 和 [UI tokens](../config/ui-tokens.json) 为准。Web 已在正式构建中使用这些素材。

## 文案分工

| 位置 | 来源 |
| --- | --- |
| 首页唯一 H1 | `marketing.headline`：Turn your product or course into a promo video. |
| 首页产品说明 | `marketing.description` |
| 页脚、About、品牌资料、分享图的小字 | `marketing.tagline`：Promo videos, packed like a bento. |
| SEO/OG 标题与说明 | 页面主题 + 品牌名；描述用产品说明，不用单独口号 |

品牌配置的 `headline`、`tagline` 与英文消息保持相同。视觉与营销规则以 [02 UX](prd/02-ux-and-ui.md) 为准。

## 资源清单

路径相对 `public/`；修改矢量源时同步重新导出 PNG/ICO：

| 文件 | 用途 / 源 |
| --- | --- |
| `icon.svg`、`favicon.ico` | 网站图标，源自 `brand/mark.svg` |
| `apple-touch-icon.png`、`icon-192.png`、`icon-512.png` | 主屏/安装图标，源自 `brand/app-icon.svg` |
| `icon-maskable-512.png` | 安全区安装图标，源自 `brand/icon-maskable.svg` |
| `og-image.png` | 1200×630 分享卡，源自 `brand/og-image.svg` |
| `brand/mark-dark.svg`、`brand/mark-white.svg` | 深/浅背景的单色标志 |
| `manifest.webmanifest` | 网站名称、入口和安装图标 |

分享卡的 Schibsted Grotesk/Geist 字标已转为 SVG 路径，不需要在线字体。网站字体已自托管；影片字体来自固定 [huashu 原生环境](../apps/render-container/README.md)，与网站主题独立。

## 网站与产品接入

- 生产构建将 `public/` 静态资源映射至站点根目录，按 `brand.assets` 配置引用；不要复制另一套源图。配置 favicon、apple-touch-icon 和 manifest 的标准 `link`。
- 公开页面使用准确 canonical URL、`og:type=website`、`og:site_name`、`og:title`、`og:description`、1200×630 `og:image` 及对应 Twitter 卡片。图片 URL 从可信部署域名和 `brand.assets.socialImage.path` 生成。私人项目/审阅 token 不进入公开分享信息。
- 兔子是 PromoBento **网站品牌**，可用于导航、空态和分享图，不进入客户影片或作为价格/退款/错误提示装饰。它不是花叔本人形象。旁边已有品牌文字时图标用空 alt；独立链接须有明确可访问名称。
- Manifest 只定义安装元数据；当前没有 Service Worker 或离线制作。上线时验证图标、元数据、抓取及缓存行为。
