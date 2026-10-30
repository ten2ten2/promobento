# 导演方法来源

方法由 PromoBento 按自身契约重写；不复制参考影片的图像、品牌、角色、产品主张或固定剪辑表。

- 固定基础参考：huashu-motion `4236053`。
- 负责人指定的固定样片与流程参考：huashu-motion [`52467f99c602b76ba86d511d37acdfe93fa1e16e`](https://github.com/alchaincyf/huashu-motion/tree/52467f99c602b76ba86d511d37acdfe93fa1e16e) 的 README、`skills/huashu-motion/SKILL.md`、`references/director.md`、`references/product-demo-continuity.md`。这是方法吸收，不是运行时依赖升级。
- 已批准内部评测页面的多屏与图片、logo、颜色、字体观察，以及逐项批准的本地 PNG 收集，参考 `cli/lib/grab.js`；沿用项目既有逐素材审核，不自动下载或把观察视为授权。
- Copyright (c) 2026 Huashu，MIT，完整条款保存在 [LICENSE.huashu](../film-runtime/src/LICENSE.huashu)。参考影片与第三方素材的许可不由此授予。
- Hypit [`e26d914`](https://github.com/hypit-ai/hypit/blob/e26d9142fd8a6f78bf4f3cdb800d6205f4ecca16/skills/hypit/references/production/component-design.md)：方法包参考协同对象、布局关系和动作审片，未引入其源码；独立的[内部评测入口](../../research/evals/README.md#用-hypit-逐帧审看片子)使用固定 npm 版本处理已获准媒体。其[自定义许可证](https://github.com/hypit-ai/hypit/blob/e26d9142fd8a6f78bf4f3cdb800d6205f4ecca16/LICENSE)对托管多租户服务另有条件，也不授予其示例素材许可。

适用范围与可执行能力由当前公开契约、沙箱和实现决定。项目私有素材/反馈不进入本通用方法包。
