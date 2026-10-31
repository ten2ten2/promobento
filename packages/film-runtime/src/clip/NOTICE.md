# clip helper 来源

固定参考：[huashu-motion@42360539c10d35397b352461347c073a2966031b](https://github.com/alchaincyf/huashu-motion/tree/42360539c10d35397b352461347c073a2966031b)，`scripts/engine/lib/`。Copyright (c) 2026 Huashu，完整 MIT 条款见 [LICENSE](LICENSE)。

采用 `motion`、`camera`、`paint`、`kit`、`diagram`、`typo`、`chart`、`ui`、`collage` 的绘制和几何帮助函数。`util` 只保留纯计算部分，移除旧字体网络加载；`toon` 仅保留通用形状、flat/glow，不含作者人物、形象或演示素材。旧 bootstrap、语法模板、旁白和签名没有移入。`cues.js` 另自 huashu-motion `52467f99c602b76ba86d511d37acdfe93fa1e16e` 移入原版词级时间锚定，修正 UTF-16 下标与补充字符错位；只处理调用方提供的时间数据。

相邻 `om.js` 从同一固定参考适配暂停时间轴、相机、spring 和空间辅助函数；由每个镜头的实际 target 和独立 region 集合初始化。`compat.js` 负责只读导出，GSAP 由镜像提供并禁用自动 ticker。字体、采样和 GSAP 分别受各自许可约束。
