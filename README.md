# PromoBento

**Turn your product or course into a promo video.**

现行规格：**PRD v3.1 / 协议 3.0.0**。

PromoBento 帮软件和课程团队把真实素材做成 15 或 30 秒的宣传片。AI 负责导演和制作，用户可以预览、批注、改稿，再按平台预设购买和导出。

影片使用固定版本的完整 huashu-motion HTML/JS 引擎；参考分析、Brief/Treatment、素材选择和改稿方法借鉴 Hypit。每种画幅有独立的原生工程。

## 项目文档

- [产品规格](docs/prd/README.md)：产品、界面、架构、交易、导演、测试和交付要求。
- [当前实施状态](docs/implementation-status.md)：已完成的代码、验证结果、待办和部署状况。
- [协作与提交规则](AGENTS.md)：环境、开发和检查方式。
- [云端控制面](apps/cloud/README.md)、[渲染容器](apps/render-container/README.md)、[原生适配器](packages/native-motion/README.md)：现有服务的接口与运行方式。
- [内部评测](research/evals/README.md)、[素材来源](packages/methods/NOTICE.md)：评测工具和上游资料。
- [品牌资源](public/brand/README.md)、[政策草稿](content/pages/README.md)：网站素材与待发布内容。

目前完成了 S0 和四阶段云端重构；S1 的真实云端、作品质量与性能验收尚未通过，客户 Studio、登录和收款也未上线。以[实施状态](docs/implementation-status.md)为准。
