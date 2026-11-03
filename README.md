# PromoBento

**Turn your product or course into a promo video.**

PromoBento 面向软件和课程团队，把真实素材做成 15 或 30 秒宣传片。AI 负责导演和制作；用户审片、改稿，按平台预设购买和导出。

影片由固定版本的 huashu-motion HTML/JS 引擎制作，结合 Hypit 的导演与素材方法。不同画幅分别构图。

## 项目文档

- [PRD v3.1（协议 3.0.0）](docs/prd/README.md)：产品与实现要求。
- [实施状态](docs/implementation-status.md)：代码完成度、验收缺口和下一步。
- [开发说明](AGENTS.md)：环境、验证和提交约定。
- [Web](apps/web/README.md)、[Core 控制面](apps/cloud/README.md)、[Preview](apps/preview/README.md)、[渲染容器](apps/render-container/README.md)、[原生适配器](packages/native-motion/README.md)：现有服务。
- [内部评测](research/evals/README.md)、[导演方法来源](packages/methods/NOTICE.md)、[品牌素材](docs/brand-assets.md)、[政策草稿](content/pages/README.md)。

当前提供内部原生制作和 SaaS 基础架构：公开 SSR 页面、隔离 API 网关、D1 断言批写和多 Worker 测试台。S1 的真实云端与作品验收尚未完成；客户 Studio、登录、收款和正式交付仍待实现。详见[实施状态](docs/implementation-status.md)。
