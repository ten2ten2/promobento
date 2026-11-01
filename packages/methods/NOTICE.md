# 导演方法来源

方法 1.58 沿用 1.17 的上游导演资料及模板源码原文，并按阶段作为导演参考；可为改写原版模板的自写镜头选择镜头内 GSAP 和 OM 选择器、将可信文字槽拆为文字簇供逐字动画使用，使用移入的原版绝对时间相机轨道、首帧准备、配乐节拍和旁白词级 cue 时间解析，支持在同一时间线的全部 tween 更新后绘制 Canvas 帧，并可声明采样精度的原版音效落点。`keynote-clip` 执行原版 t2 的无文字截图卡交接和同源区域强调；`vox-clip` 执行原版 Vox 的无文字静态图与同源区域圈画，`vox-story` 增加绑定事实的文字卡（尚未验证）；`planet-clip` 使用原版 y1 星球与节点图形并以可信 DOM 槽承载文字，`planet-depth` 增加原版层级穿入及事实关系（尚未验证）；`ui-space-clip` 将原版空间相机和分层手法适配到真实截图和同源观察区域（尚未验证）；`blank-clip` 以事实槽适配原版标题、计数与片尾三幕（尚未验证）；方向卡可选择输入中已准入的镜像字体并用于预览（尚未验证）；`whiteboard-clip` 用原版 y3 图片笔绘和独立可信 DOM 标题；`whiteboard-notes` 接入原版笔、图标和相机并以独立事实槽承载文字（尚未验证）；`finance-bars` 接入零基柱状图并以事实槽承载分类和值（尚未验证）；`math-notes` 接入 t1 讲解舞台并以事实槽承载公式和要点（尚未验证）；`drawn-steps` 提供适配的 y3 手绘图标；`canvas-title`、`canvas-sequence`、`canvas-number`、`canvas-subtitle` 和 `canvas-subtitle-sequence` 接入 y5 标题、换页、计数与标题辅句的受限可信路径；`object-studio` 适配原版 3D 产品舞台并可由导演选用，运行前验证固定镜像；自写镜头可以通过受限 OM3 产品舞台分别控制相机、静态产品设备及独立清权面板，1.45 可按同源观察区域裁切面板，1.48 可在该基础上按帧控制面板透明度，1.52 扩展到最多八个受纹理预算约束的独立面板（尚未验证）；完整原版 HTML、其他 Canvas 文字和任意自写 WebGL 未接入。具体作品仍遵守 PromoBento 的素材、事实与沙箱契约，不复制参考影片的图像、品牌、角色或产品主张。

- 固定基础参考：huashu-motion `4236053`。
- 负责人指定的固定样片与流程参考：huashu-motion [`52467f99c602b76ba86d511d37acdfe93fa1e16e`](https://github.com/alchaincyf/huashu-motion/tree/52467f99c602b76ba86d511d37acdfe93fa1e16e) 的 README、`skills/huashu-motion/SKILL.md`、`references/director.md`、`references/product-demo-continuity.md`。1.17 的 [固定源码](huashu-motion/source.mjs) 保留原始 SKILL、40 篇参考资料与 11 个模板的 HTML 原文：方向阶段提供视觉语言库，规格、镜头和审片阶段提供相关原文；选中相应视觉语言时，镜头阶段还收到对应原始模板源码。完整 HTML 只作模型参考，不作为可执行工程或现成素材；个别受限积木执行或适配的片段见上文，非对应语言不会加载模板原文。
- 方法 1.51 为扁平科普、系统讲解、模块卡片和口播方向补充对应原始模板作为镜头参考；源码路径尚未验证，不直接执行 HTML，也不获得示例素材授权。
- 已批准内部评测页面的多屏与图片、logo、内联 SVG／图标候选、视频来源、颜色、字体观察，以及本地候选清单与逐项批准的本地／网页静态 PNG／JPEG／静态 WebP 收集及本地／网页安全 SVG／ICO／ICNS／单帧 GIF／AVIF 的受控转换和已批准本地／网页视频及动态 GIF／APNG／WebP／AVIF 的源时间采帧（AVIF 源码路径尚未验证），参考 `cli/lib/grab.js`；沿用项目既有逐素材审核，不自动下载或把观察视为授权。
- Copyright (c) 2026 Huashu，MIT，完整条款及上游第三方说明保存在 [huashu-motion](huashu-motion/)；参考影片与第三方素材的许可不由此授予。负责人确认排除未授权的“豆子花叔”作者形象；上游 storytime 模板、示例图片、音频与 GSAP 文件也没有作为本次迁移素材收录。
- 已登记的上游字体各自适用 OFL 1.1，版权逐项见[字体清单](../fonts/huashu/LICENSES.md)；渲染镜像构建时保留许可正文和版权清单。内部评测可以选择已登记字体，不能据此使用未经批准的其他字体文件。
- Hypit [`e26d914`](https://github.com/hypit-ai/hypit/blob/e26d9142fd8a6f78bf4f3cdb800d6205f4ecca16/skills/hypit/references/production/component-design.md)：方法包参考协同对象、布局关系和动作审片，未引入其源码；独立的[内部评测入口](../../research/evals/README.md#用-hypit-逐帧审看片子)使用固定 npm 版本处理已获准媒体。其[自定义许可证](https://github.com/hypit-ai/hypit/blob/e26d9142fd8a6f78bf4f3cdb800d6205f4ecca16/LICENSE)对托管多租户服务另有条件，也不授予其示例素材许可。

适用范围与可执行能力由当前公开契约、沙箱和实现决定。项目私有素材/反馈不进入本通用方法包。
