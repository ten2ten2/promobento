# 导演方法来源

当前方法仅支持 **2.0.1**：原生 huashu-motion `index.html`、JS/CSS、素材及单一时间线在隔离浏览器中运行，不转写 PromoBento 镜头 DSL，也不兼容 1.x、2.0.0 或退役的 triage 阶段。历史方法和调用回执保留在原始证据中，不由新导演恢复。

[固定 huashu 源码](huashu-motion/source.mjs)保留 `52467f99c602b76ba86d511d37acdfe93fa1e16e` 的原始 SKILL、40 篇参考和 11 个模板 HTML。`directing.ts` 按创作阶段召回相关原文；选中语言的原始模板直接作为原生工程起点。运行容器固定同一上游提交，提供原版 vendor、字体、检查、取帧、声音与整片渲染工具。已有上游声明仍保存在 [huashu-motion](huashu-motion/)。

[固定 Hypit 原文](hypit-source.mjs)来自 `0762c6be56c0af43fff3cdbdb285e21414dd249b`：

- `creation/brief.md`：用户目标与事实放入 Brief；导演的故事和视听设计放入 Treatment；在对应的文件里修改变化的内容。
- `creation/script-and-time.md`：素材先按语义选择；用实际音频对齐证据定位说话事件；纯动画保留作者明确写出的时间，不制造词时间戳。
- `creation/reference-video.md`：整片关系、具体时刻和原始视觉证据一起分析；参考片秒数不直接冒充目标影片时间。

PromoBento 保持 15/30 秒、30 fps 和既定平台尺寸；每个画幅独立编排、取帧审片和整片导出。源文件补丁绑定父版本，实际素材绑定字节摘要，模型调用继续使用既有额度与原始回执。没有引入 Hypit 的 DSL、编译器、任务队列或第二套执行 runtime。

原生接入的部署、真实影片与费用验证范围见[实施状态](../../docs/implementation-status.md)。离线流程 fixture 不构成视觉质量、实际音频对齐或云端隔离验收。
