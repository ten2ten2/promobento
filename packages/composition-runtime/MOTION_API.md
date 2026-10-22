# 用现成画面组件，仍按绝对时间绘制

`canvas-media-v1` 的 `prepare(context)` 已提供 `motion`、`camera`、`path`、`paint`、`components`。不用 import，也没有浏览器全局；返回的仍是受限 JSON 绘图命令。时间、数值、文字、资源身份和每个逻辑区域由作品显式决定。

```js
prepare(context) {
  const {motion: M, paint: P, components: C} = context;
  return {
    draw({numerator, denominator}) {
      const t = numerator / denominator;
      return {commands: [
        P.rect(0, 0, context.width, context.height, '#f5f1e8'),
        ...C.chart({id: 'growth', x: 130, y: 350, width: 760, height: 480,
          title: 'Illustrative data', progress: M.at(t, 0.5, 1.2),
          data: [{label: 'A', value: 24}, {label: 'B', value: 48}]})
      ]};
    },
    dispose() {}
  };
}
```

声明、字体和资源仍须与 `declarations.json`、`resources.json` 相符。例中组件默认使用 `geist-sans-fixture` / 600，须同时声明它已登记的 `geist-mono-fixture` fallback。其他字体从可信目录选择，不使用系统 fallback。完整类型见 `contracts/composition-runtime.d.ts`。

## 选择画面语法，不套整片模板

所有组件返回命令数组，可组合、错开、放入相机。通用参数为 `{id,x,y,width,height,fontId,weight,progress}`；`id` 在同一帧必须唯一。文字过多时调整构图或换行，超出字体覆盖、安全区、文字框会阻断出片。

| 方法 | 内容参数 | 实际画面 |
| --- | --- | --- |
| `components.ui` | `title, navigation, cards:[{label,value}], resourceId?, crop?` | 屏幕框、导航、指标卡、折线或授权截图、指针 |
| `components.mechanism` | `nodes:[{label,x?,y?,color?}], edges:[[from,to]], formula?` | 节点、裁短的曲线连接、信号点、公式原文；坐标为组件内 0–1 |
| `components.chart` | `data:[{label,value,color?}], kind:'bar'|'line', title?` | 原始数值刻度、正负条形或折线、标签；进度只改变揭示 |
| `components.flatWorld` | `nodes:[label], color?, time` | 原创矢量星球、轨道、信息节点；不是作者形象 |
| `components.collage` | `cards:[{title,text?,resourceId?}]` | 撕边纸、胶带、图钉、证据连线和授权图片网点化 |
| `components.whiteboard` | `points:[{x,y}], title?, annotation?` | 按弧长显露的手绘线，笔尖随绝对进度移动 |
| `components.kineticType` | `words:[text], fontSize?, highlight?, color?` | 整词错峰升起、关键词底色；稳定文字 ID 保留每个完整词 |

这些组件针对有界 2D 命令改写，不包含上游整片、人物、未审核照片、DOM 或离屏反馈循环。组件可选，不会替代事实确认，也不自动证明图表数据真实。

## 时间、路径和相机

- `motion.at(t,start,duration)` / `seg(t,start,end)`：0–1 绝对进度；`lagged(index,count,p,ratio)` 错峰。
- 缓动：`smooth`、`sineInOut`、`cubicIn/Out/InOut`、`expoIn/Out/InOut`、`backOut`、`elasticOut`、`bezier`；保留上游其他解析缓动和 `spring` / `springHz` / `settle` / `float`。
- `motion.count(t,start,duration,a,b)`、`formatNumber(value,decimals)`：数字动画，不依赖 locale；`beat` / `onBeat` 对齐时间。
- `path.cubic`、`arc`、`densify`（Catmull–Rom）、`resample`（等弧长）、`morph`、`pointAt`、`partial`、`hand`、`ribbon`、`line`：返回点列或有界路径。形变两端须同拓扑。
- `camera.at([{t,x,y,z,r,ease?}],t)`：平移和旋转插值，缩放用对数插值；还提供 `anchor`、`pushTo`、`parallax`、`drift`、`coverZoom`。
- `camera.apply(commands,pose)` 与 `camera.region(region,pose)` 配套使用；后者把同一相机作用后的包围盒限制在画布内，供点选。`toScreen` / `toWorld` 做正反坐标换算。

## 字体、中文和换行

现有两个 fixture 字体维持 Latin-only 合同。移植目录有 **27 个 family、42 个 WOFF 文件**：25 个 Latin/展示字族与 Noto Sans SC、LXGW WenKai。斜体独立 fontId，不触发合成斜体；Inter、Roboto Condensed 变量文件只开放经实际 `fvar` 核对的默认 400 实例。其他字重不能靠 CSS 假造。

```js
const title = context.paint.text('title', '从想法到画面\nMake it move.', 120, 240, 760, {
  fontId: 'hm-noto-sans-sc', weight: 700, fontSize: 58,
  wrap: 'word-cjk', padding: 8
});
const metrics = context.measureText('hm-noto-sans-sc', title.text, 58, 700, {
  width: 760, wrap: 'word-cjk', padding: 8
}); // width, ascent, descent, height, lineHeight, lineCount
```

`paint.text` 自动算高度并默认留少量墨迹边距。原始 `text` 命令无 `layout` 时仍是单行；有 `layout` 时支持显式换行、Latin 单词/CJK 字符换行、左右/居中对齐、行高和 padding。换行不丢字，不改变原文；浏览器文字轨迹保留一个完整文本与稳定 ID。所有字先查选定 face 的 cmap，逐字使用同一 WOFF advance，禁止系统补字；缺字报错。支持 Latin、CJK 标点/统一汉字/全角形式的已登记子集；不声明 RTL、复杂塑形、组合音标或 emoji 支持。自动换行不实现完整东亚避头尾规则，正式文案可用显式换行控制断点。

## 绘图与艺术处理

所有命令可有六数 `transform` 和局部矩形/圆角 `clip`。矩形、圆、多边形、`path` 可加 `stroke`、`gradient`，或 `fill:false`。路径只接受 move/line/quadratic/cubic/close 数据；不接受 SVG 字符串、JS、任意 Canvas API、URL 或滤镜表达式。图片/视频的 `crop:{x,y,width,height}` 是 0–1 源坐标。

- `paint.texture('paper'|'grain'|'halftone'|'mosaic'|'brush', x,y,w,h, options)`：固定 128² 种子纹理，可信端有界缓存；纸纹保留多层 Perlin 噪声算法。
- 图片可加 `effect:{style:'halftone'|'mosaic'|'brush',cell:4,seed:1}`：取授权图片颜色，在至多 256² 的处理层生成网点、马赛克或笔触。不是整片低分辨率化。
- `paint.tornPaper`、`lightSweep`、`transform`、`wipe`：纸边、光扫、2D 变换及裁剪揭示。`wipe` 用于几何/图片；文字部分裁剪会被拒绝，不以隐藏一半原文充当审核通过。

每帧仍限制 4,096 条命令、1 MiB JSON、16,384 个路径点/控制点及字形；纹理最多 16 条，总局部填充面积最多四倍画布。每命令状态 save/restore，每帧重置画布，实际变换后文字墨迹继续做安全区检查。全片冷启逆序比较仍适用。

## 可运行源包

`apps/renderer/test/admission-visual.cases.mjs` 的 `writeVisualCandidate(directory,{durationSeconds:15|30})` 生成七语法＋中文＋材质示例；`fontGalleryCandidate()` 覆盖全部 42 个 face。它们返回/写出源码字符串，不在宿主执行。交给现有 `render:admission` 容器入口出片。对应纯函数与边界单测是 `admission-visual.test.mjs`；真实容器与截图验收以 CI 报告为准。
