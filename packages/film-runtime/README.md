# FilmSpec 到可信逐帧页面

源码支持九个核心积木、device-3d、object-studio 和四个新增镜头、四画幅和cut／crossfade／fade-through／push／whip。`fade-through` 在画面背景上先淡出上一镜头、再淡入下一镜头，不改变既有crossfade。页面由可信生成器组装，绘制按镜头时间确定；实际部署、验收和未实现能力见[实施状态](../../docs/implementation-status.md)。积木／自写API以 [film-runtime.d.ts](../../contracts/film-runtime.d.ts) 为准，不包含上游作者形象。

## 构建和调用

```sh
mise run build:film-runtime
```

Node调用 `generateFilmPage(rawJson,options)`（[src/page.ts](src/page.ts)），经共享严格解析、完整Ajv／FilmSpec语义和实际能力准入后输出HTML、CSP和PagePlan。options由可信宿主提供画幅／seed／确认事实／清权素材／精确字体／期限，不信客户自报权利。输出在忽略的dist，控制器提供固定runtime、`/r/<resourceId>`、`/frames/<resourceId>/<index>.webp` 和 `/f/<fontId>/<weight>-<style>.woff2`；视频PTS索引／缓存有界，缺帧失败。

PagePlan.manifestHash是规范FilmSpec握手摘要；filmSourceHash另固定规范film.json与原始模块字节，并与seed／资源／字体／环境绑定。产品Composition身份和真实冻结另按 [14](../../docs/prd/14-production-contracts.md)，不能以页面摘要代替完整身份。

CDP先在任何脚本前注入shim，再导航；ready后依 [RenderProtocol](../../contracts/render-protocol.d.ts) 串行init／seek／sample／inspect／dispose。当前只接受trusted_render、standard单采样。私有真实时钟只交引擎一次，作品使用虚拟时间、每次seek重置的random-seq-v1；镜头timeline以局部秒数、事件以局部帧表示。

## 当前积木行为

九项为hook-title、ui-showcase、cta-endcard、feature-grid、curriculum、ui-journey、metric、captions、talking-head。字幕／口播消费已清权且确认的内容，数字／CTA绑定事实；精确参数和实现版本见[积木目录](../../contracts/block.schema.json)。

- 文字槽可用maxFontSize保持层级，但不低于角色下限，不拆词／截原文冒充适配。字体登记带cmap，静态缺字和CDP实际回退分别检查。
- hook-title、纯文字feature-grid／curriculum按实际文字高度成组居中，去掉空图片外框；带图卡的下方文案区分标题／间隔／副标题，避免盒子重叠。
- cta-endcard将CTA／URL与可选Logo成组居中，保留点选。ui-showcase的focus仅高亮ROI，不放大／裁剪；密集界面可省textSlot扩大真实图，必要文案仍走可读槽位。
- ui-showcase／ui-journey用固定Canvas的CPU逆透视取样，保留DOM文字／点选。showcase端点纹理预合成、只融合差异像素；停稳图片／ROI复用像素，回跳运动重新采样，视频仍逐帧。避免CSS3D图片栅格受seek历史影响。
- feature-grid可选beatFrames（6–60源帧），首项局部15帧停稳、末项在镜头内；音效跟随落点。可选清权logoKey按项移动，此时只配文字项，不混重复截图。不传新参数保留原行为。
- ui-journey可选beatFrames：首落点一拍，后每三拍交接，一拍移动／两拍阅读，过程中只显示一个真实状态、标题先退后进，阅读缓慢推近；横屏交替左右，其他上文下图，无装饰ROI。末落点后至少一拍，不传仍用原连续横移。声音事件product-step-1…3／末次product-land，观测覆盖各阅读点，动作另取交接中点／落点。
- `continuous-focus` 保持一段已清权图像或视频连续，按时间纯函数平滑取景，不生成鼠标或操作。`sourceStartFrame` 是叠加资源起点的 30 fps 源帧偏移；`focusTrack` 与可选 `aspectTracks` 用镜头局部帧和源画面归一化中心 `x/y`、`zoom` 定位，首帧须为 0、后续严格递增并在镜头内。未指定取景为画面中心。视频必须由调用方提供已清权 PTS 帧图；该镜头不负责上传、抽帧或自动追踪鼠标；源码中的内部导演方法 1.29 可传递已批准的本地／网页视频帧包，真实 staging 使用尚待验收。
- `component-relay` 在第一张清权静态图中按 `focus:roi:n` 抬起真实区域的副本。`componentBehavior:return-to-source` 让只属于当前页面的细节回到原处后再接入不同页面；`carry` 将有明确关联的细节带到后续页面旁。省略该字段保留旧片的 `carry` 行为。回归原页的模式还在后续图片阅读时缓慢推进，不改动截图内容。原页面仍保留原组件，不伪装成真实操作；支持 2–4 张图、可选文字和按拍的落点／阅读间隔。区域必须完整落在图内，向外取整到源图像素后使用固定 Canvas CPU 取样，避免图片缩放缓存随 seek 历史改变；影片还需正常审片。不支持录屏、自动识别或精确抠出不规则轮廓。导演使用该镜头时只接受绑定素材观察中的原坐标，观察本身仍须按实际画面复核。
- `kinetic-title` 和 `drawn-steps` 分别移植花叔的弹簧字卡和白板逐步绘制语法，文字仍走事实绑定槽位，不带原作角色、字体或示例素材。[来源和许可](../blocks/NOTICE.md)。
- device-3d用Three.js0.186.1将清权静态图贴原创设备几何，不接视频纹理；仅3D页加载bundle。姿态是时间纯函数，无自主循环；ready等纹理／首帧，dispose释放资源和context。BlockInstance.ready/dispose可选，旧积木不需新增前置。[许可](../blocks/NOTICE.md)。
- `object-studio@1` 将一张已清权静态图贴到原版圆角设备，使用移植的柔光环境、弧形背景和连续相机，画面为全幅舞台；可选 `textSlot` 作为简短的事实绑定 DOM 文字覆盖，主体仍占据主要画面。首帧等待原始图片解码并核对尺寸，渲染结束释放几何、纹理与 WebGL context。它是产品主体展示，不模拟产品操作；不接视频纹理或原版 GLB／SVG／HDR 加载器。[许可](../blocks/NOTICE.md)。

全局纹理、布局覆盖、客户本地值覆盖预览、任意自写 WebGL 尚未开放，不能因Schema保留字段就执行。页面不播音轨；可信阅读／动作采样不是完整动态Q1/Q2或负责人视听。

## 自写镜头：源码与规格分开

custom使用 `module:scenes/<id>/index.js` 和brief；当前单模块 `PB.scene(id,ctx=>({timeline}))`，支持DOM、SVG图形、Canvas2D、暂停GSAP／OM.clock，不允许任意依赖／导入。只在独立uid的容器Chromium沙箱求值，页面生成器／Worker／控制器不执行它。

`OM.camera` 和 `OM.space` 的字符串选择器先查当前镜头，再沿用文档范围回退；多个镜头复用原版模板的同名 ID 时，各自镜头优先。显式元素引用不变。连续 `OM.space.to` 只替换该镜头的相机驱动 tween，不终止作者时间线或保留重复驱动。

当 Canvas 绘制依赖同一 GSAP 时间线中其他 tween 的值时，用 `ctx.OM.clockAfter(timeline, draw, duration)`。它沿用原版 `OM3.film` 的顺序：先完成该时点的全部 tween，再同步调用 `draw`，之后才捕获帧；同一次 seek 的重复更新只绘制最后时点，异常会使帧失败。`draw` 不支持异步任务；受限 3D 舞台可在此回调中绘制。仅依赖时间参数的既有 `ctx.OM.clock` 不变。

自写镜头可显式声明 `runtime3D: 'om3-studio-v1'`，并在构建时调用一次 `ctx.OM3.studio('assetKey')`。素材须为该镜头声明且已清权的静态图片；舞台在首帧前完成解码，按 3D 资源规格渲染并在销毁时释放。返回对象仅提供 `render({yaw, pitch, distanceScale, targetX, targetY})`：角度分别为 ±70°／±45°，距离比例为 0.8–3，目标坐标为 ±4；省略项使用默认值。通过 `ctx.OM.clockAfter` 在时间线更新后同步绘制，逆序 seek 仍由当前时间决定。导演方法 1.28 才选择此能力，实际使用时先探测固定镜像。该接口不暴露 Three.js、WebGL 上下文、任意模型或着色器，也不替代产品画面与文字的审片。

```js
const studio = ctx.OM3.studio('product');
const view = {yaw: -30}, timeline = gsap.timeline({paused: true});
timeline.to(view, {yaw: 20, duration: 2}, 0);
ctx.OM.clockAfter(timeline, () => studio.render({yaw: view.yaw}), 15);
return {timeline};
```

`ctx.CLIP.cues.prepare(spec, {pace, words, voiceEnd})` 提供原版 clip 的 cue 时间准备：无旁白词时间时缩放原始时间；提供已确认词时间时按文本、出现次数和起止边缘定位，并在找不到词时返回 `problems`。`ctx.CLIP.cues.findWord(words, text, nth, edge)` 可单独查找。输入的词时间必须来自已批准的旁白及转写；此工具不生成转写、不核验音频，也不开放 Canvas 文字绘制。

场景构建时可用 `ctx.OM.ready(promise)` 登记首帧前必须完成的异步准备；宿主等待已登记任务及其中登记的后续任务，失败或超时则停止初始化。准备结束后不接受新的登记。素材仍只能使用已授权的 `ctx.asset`，此接口不开放网络或任意依赖。

`ctx.OM.beat(n)` 在已冻结程序配乐明确设置 BPM 时返回 `n` 拍的秒数；也可用 `ctx.OM.beat(n, bpm)` 显式指定，未提供 BPM 时会报错。它计算长度，不自动把局部时点对齐全片节拍；全片节拍帧可读取 `ctx.beats`。

自写镜头的 `params.sourceSfx: true` 开启原版 `ctx.OM.sfx(id, seconds, {gain})` 用法：在构建时间线时调用一次，返回相同时点用于动作落点。宿主不执行源码，而是从固定源码静态读取声明并在渲染前冻结到 AudioPlan；沙箱检查声明是否确实执行且只执行一次。支持现有程序音效 ID、镜头局部秒数（音频按最接近的 48 kHz 采样定位）、数字运算及 BPM 已知的 `ctx.OM.beat`；`gain` 是 0.001–3.9810717055349722 的线性倍率，省略为 1。动态时间、其他音效选项和重复落点明确拒绝，影片静音时不生成声音。不要在 FilmSpec 音效列表中重复同一声音和时点。源码变化会重新绑定音频计划；无该选项的旧镜头保持原行为。冻结落点不证明画面动作确实与声音同步，音画仍须审片。

原版场景若使用 `gsap.set('#id', ...)` 或时间线中的选择器，在该自写镜头的 `params` 中设置 `gsapScope: 'scene'`，注册镜头时的 GSAP 字符串选择器和 OM 相机选择器就只查当前镜头；销毁镜头时释放对应 GSAP context。省略时保留上面的旧用法。该选项不改变源码、素材、文字或渲染隔离的准入要求，也不执行原版 HTML。

params声明textSlots、assetKeys、局部整数帧events、readingHolds，可用hardest指定优先。导演方法1.6可用 `assetChecks` 声明需要验证的DOM图片和帧，检查范围与限制见[导演说明](../../apps/cloud/README.md#导演选择结构d-实现自写镜头)；旧源码和Canvas用法不增加该前置。ctx.text／ctx.asset必须字面量；createElement／createElementNS／getContext的tag／namespace／context也须字面量，helper可以接已建元素或已解析handle。ctx.style.palette直接含bg／ink／accent，不是FilmSpec的roles包装。全部可见文字经text mount，当前Canvas/SVG文字绘制禁止。

浏览器在源码运行前禁用 Canvas 和 OffscreenCanvas 的 `fillText`／`strokeText`，包括原版 CLIP 辅助函数间接调用；图形绘制和已有 DOM 文字槽不受影响。上游依赖 Canvas 文字的完整语法需先接入可核验的文字来源与帧观测，不能将这些函数直接开放给客户作品。

`ctx.OM.cameraRig` 提供原版按绝对时间采样的相机轨道和主体跟拍算法。轨道从零开始，各段连续，关键帧的 `at` 是该段内的秒数；相机位置、目标和视场由同一时间确定，适合顺序、逆序和冷取帧。它可驱动 `ctx.OM.space`，但不会自动识别产品操作或创建三维素材。

```js
const rig = ctx.OM.cameraRig.create([{id:'reveal', start:0, end:4, keys:[
  {at:0, position:[400,300,1800], target:[500,300,0], fov:35},
  {at:4, position:[600,300,1500], target:[500,300,0], fov:35, ease:'inOutCubic'}
]}]);
ctx.OM.clock(timeline, t => camera.set({...rig.sample(t)}), 4);
```

该算法来自 huashu-motion `52467f99c602b76ba86d511d37acdfe93fa1e16e` 的 `runtime/camera-rig.js`，MIT；改为模块导出、场景 API 和内部副本，并只接受目录中实际定义的缓动名称；不包含上游示例角色或素材。

可信宿主以PageOptions.customSources提供原始路径→字节；每份≤64KiB、合计≤512KiB，只接FilmSpec列明路径，每镜头声明的首尾／事件／阅读去重最多24帧。Acorn只静态解析；动态构造器在源码前封闭，宿主用直接CDP桥。源码／Q0／完整身份核对后才启动浏览器，源文件只在任务本地同源路径提供。

filmSourceHash、构建回执及分段身份包含全部模块原始字节；纯积木省略customSources保持原摘要。CDP拒绝未绑定／改写文字，阅读窗口按冻结方法核对实际sceneId／必显槽。运行时攻击／资源故障的实际证据范围见实施状态。

## 选择相关浏览器检查

`mise run test:browser` 是CI隔离容器内入口，本机直接调用明确失败。完整browser job构建browser-test，不推送／部署；含九积木帧集、桥接／字体／布局／seek、JPEG→H.264／接缝／混音／MP4和13种30秒样曲，产物film-runtime-browser。开发不默认运行；只对受影响风险选专项，未运行项记not_run。

| Actions选择 | 范围 |
| --- | --- |
| `suite=runtime` | 四画幅seek／布局／桥接，不重做媒体／配乐 |
| `suite=journey` | 旅程／透视面板四画幅final／review的顺逆冷seek |
| `suite=runtime -f runtime_case=review` | 改变的review取图路径 |
| `runtime_case=showcase` | 四画幅／双比例showcase运动／停稳／回跳／冷seek |
| `runtime_case=layout` | 普通72项与四画幅带Logo片尾 |
| `runtime_case=typography` | 开场和纯文字网格布局 |
| `runtime_case=relay` | feature-grid Logo按拍落点／布局／seek |
| `runtime_case=journey-beats` | ui-journey四画幅三状态阅读和连续后逆／冷seek |
| `runtime_case=component-relay` | 四画幅组件抽离、页面接力及逆／冷 seek |
| `runtime_case=focus-port` | 新镜头四画幅、PTS 源帧偏移及正向／逆向／冷 seek |
| `runtime_case=custom` | 原创自写镜头、真实帧／CDP和定点故障，不重做媒体／配乐／G1 |
| `runtime_case=custom-assets` | 自写图片实际可见／隐藏观察与CTA先退后进转场，不重做完整媒体／配乐 |

runtime_case均与suite=runtime一起使用。失败保留画幅／帧号／实际PNG和已完成项，容差仍最大通道差≤2且差异像素≤0.1%，不按测试结果放宽。

CI容器network none，启动器短暂root分离uid后丢capability，外层测试seccomp/AppArmor只放行嵌套namespace，断言renderer seccomp／NoNewPrivs／PID隔离；不能以本机无沙箱替代。[正式云隔离](../../docs/evidence/2026-10-24-s1-performance/README.md#正式镜像隔离通过)和完整S2攻击分别验收。
