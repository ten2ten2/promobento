# clip helper 来源

固定参考：[huashu-motion@42360539c10d35397b352461347c073a2966031b](https://github.com/alchaincyf/huashu-motion/tree/42360539c10d35397b352461347c073a2966031b)，`scripts/engine/lib/`。Copyright (c) 2026 Huashu，完整 MIT 条款见 [LICENSE](LICENSE)。

采用 `motion`、`camera`、`paint`、`kit`、`diagram`、`typo`、`chart`、`ui`、`collage` 的绘制和几何帮助函数，适配为独立环境工厂，可信模板的尺寸和缓存不与自写镜头共享。`util` 只保留纯计算部分，移除旧字体网络加载；`toon` 仅保留通用形状、flat/glow，不含作者人物、形象或演示素材。`cues.js` 另自 huashu-motion `52467f99c602b76ba86d511d37acdfe93fa1e16e` 移入原版词级时间锚定，修正 UTF-16 下标与补充字符错位；只处理调用方提供的时间数据。

同一固定版本的七个非人物 clip 语法已移入 `grammars/`，由每镜头独立工厂创建；`stage.js` 适配其时间、画布和区域计算。`t2_keynote_ui` 的无文字截图卡和同源区域强调路径通过 `keynote-clip` 接入；`y2_vox` 的无文字静态图路径通过 `vox-clip` 接入；`y1_kurzgesagt` 的星球／节点图形通过 `planet-clip` 使用可信 DOM 文字槽（尚未验证）；`y3_whiteboard` 的单图笔绘由 `whiteboard-clip` 执行并以独立 DOM 槽显示标题；`y5_kinetic_type` 的标题和数字分别通过 `canvas-title`、`canvas-sequence`、`canvas-number`、`canvas-subtitle` 和 `canvas-subtitle-sequence` 使用已授权字体及受限可信文字绘制。其余语法仍是内部构件，原版变量和素材尚须绑定，普通自写镜头仍不能直接绘制 Canvas 文字。[实际能力和检查](../../README.md#当前积木行为)。作者人物的 `y4_storytime` 及原版演示素材不在内。

可信积木源码中的 Canvas 文字分发器已抽成多槽接口：调用方必须为每次文字绘制指定声明槽位，并完成每个槽的原文匹配；仍沿用现有的两行和文字布局限制，仅供可信积木使用。该重构尚未验证，不等于任意 Canvas／自写镜头文字已经开放。

`whiteboard-notes` 源码使用原版 y3 的笔、相机与图标，将标题、要点和图注替换为独立可信 DOM 事实槽；它不允许与自写镜头混用，尚未验证。

`finance-bars` 源码使用原版 t3 的零基柱状图和动画，将标题、单位、来源、分类及数值替换为可信 DOM 事实槽；其他图型、标注与混合自写镜头尚未接入，该路径尚未验证。

`math-notes` 源码使用原版 t1 的讲解舞台和要点动作，将标题、公式和要点替换为可信 DOM 事实槽；任意公式形变、曲线及混合自写镜头尚未接入，该路径尚未验证。

`planet-depth` 源码使用原版 y1 的外层／内层穿入路径，以绑定节点和关系事实的 DOM 槽替代 Canvas 字；尚未验证。

`vox-story` 源码使用原版 y2 桌面、红线和相机，并将标题、图片标签及索引卡文字绑定到 DOM 槽；尚未验证。

相邻 `om.js` 从同一固定参考适配暂停时间轴、相机、spring 和空间辅助函数；由每个镜头的实际 target 和独立 region 集合初始化。`compat.js` 为既有自写镜头保留 window 级助手接口；可信积木使用私有实例。GSAP 由镜像提供并禁用自动 ticker。字体、采样和 GSAP 分别受各自许可约束。
