# 可检索的导演方法库

[目录](catalog.mjs)是 PromoBento 的改写版：11 份方法、18 类影片形式、20 种视觉语言、32 条适用经验。它进入实际导演上下文，而不是另一套系统提示或可执行上游 skill。CLI、项目选择及改稿用法见[本地导演入口](../README.md#按题目选用导演方法不整包灌提示)。

## 来源与许可

改写自 [huashu-motion@5f2608c2e12abcf518f74dde86093b19f7f88603](https://github.com/alchaincyf/huashu-motion/tree/5f2608c2e12abcf518f74dde86093b19f7f88603)，Copyright (c) 2026 Huashu，保留完整 [MIT 许可](LICENSE.huashu-motion)。每条卡片保存上游文件路径；`METHOD_LIBRARY_IDENTITY` 还固定 commit、方法版本和实际目录内容摘要，随本地操作保存。

采用文件是 `skills/huashu-motion/references/` 下 director、rhythm、colour、craft、visual-direction、product-demo-continuity、verification、provenance、sound、experience，及 `library/formats.md`、`product-fit.md`、`techniques.md` 和 20 份语言文件。经验的分类与召回设计另借鉴 `cli/lib/learn.js`；批注全帧加局部图的观看方式借鉴 `cli/lib/inbox.js`、`frames.js` 的 `om look`，代码使用本产品的保存版本、隔离取帧及预算边界重新实现。

## 改了什么

- 将导演、观看结构、运动语义、颜色角色和检查条件改写为短卡片；按当前任务检索，不让历史个案、账号传播数字或审美偏好冒充普遍效果证明。
- 所有片型重定为既有 15/30 秒、30 fps 和平台安全区；上游长片、7 秒标志段等只作为整片内的叙事结构，不改变交付规格。
- 删除可执行 GSAP、DOM、系统字体、浏览器 cookie、自动下载、历史工具绕行、浮动片长、强制音效及原样运动模糊处方。保留可用的墨迹、变换原点、阅读时间、绝对时刻和真实帧检查问题。
- 未准入的 3D、折射玻璃、角色和真人口播保留有条件的方法索引，不进入默认生成正文。不会复制作者形象、私有项目材料、演示成片或未核权利素材。
- 确认事实、用户当前要求、已启用项目偏好优先；公共方法不访问或吸收客户私有记录。

上游历史指标和视听效果没有在本项目逐一复核；采用的是方法与可检验的条件。模型真实创作收益仍通过 M0a 同题对照和独立审片判断。
