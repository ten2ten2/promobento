# FilmSpec 到可信逐帧页面

源码支持九个核心积木、device-3d 和四个新增镜头、四画幅和cut／crossfade／fade-through／push／whip。`fade-through` 在画面背景上先淡出上一镜头、再淡入下一镜头，不改变既有crossfade。页面由可信生成器组装，绘制按镜头时间确定；实际部署、验收和未实现能力见[实施状态](../../docs/implementation-status.md)。积木／自写API以 [film-runtime.d.ts](../../contracts/film-runtime.d.ts) 为准，不包含上游作者形象。

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
- `continuous-focus` 保持一段已清权图像或视频连续，按时间纯函数平滑取景，不生成鼠标或操作。`sourceStartFrame` 是叠加资源起点的 30 fps 源帧偏移；`focusTrack` 与可选 `aspectTracks` 用镜头局部帧和源画面归一化中心 `x/y`、`zoom` 定位，首帧须为 0、后续严格递增并在镜头内。未指定取景为画面中心。视频必须由调用方提供已清权 PTS 帧图；该镜头不负责上传、抽帧或自动追踪鼠标，导演工作流目前也不传递视频帧。
- `component-relay` 在第一张清权静态图中按 `focus:roi:n` 取出一个真实区域的副本，从原坐标抬起，作为视觉锚点移到后续页面旁边，避免遮住页面。原页面仍保留原组件，不伪装成真实操作；支持 2–4 张图、可选文字和按拍的落点／阅读间隔。区域必须完整落在图内，向外取整到源图像素后使用固定 Canvas CPU 取样，避免图片缩放缓存随 seek 历史改变；影片还需正常审片。不支持录屏、自动识别或精确抠出不规则轮廓。导演使用该镜头时只接受绑定素材观察中的原坐标，观察本身仍须按实际画面复核。
- `kinetic-title` 和 `drawn-steps` 分别移植花叔的弹簧字卡和白板逐步绘制语法，文字仍走事实绑定槽位，不带原作角色、字体或示例素材。[来源和许可](../blocks/NOTICE.md)。
- device-3d用Three.js0.186.1将清权静态图贴原创设备几何，不接视频纹理；仅3D页加载bundle。姿态是时间纯函数，无自主循环；ready等纹理／首帧，dispose释放资源和context。BlockInstance.ready/dispose可选，旧积木不需新增前置。[许可](../blocks/NOTICE.md)。

全局纹理、布局覆盖、客户本地值覆盖预览、自写WebGL尚未开放，不能因Schema保留字段就执行。页面不播音轨；可信阅读／动作采样不是完整动态Q1/Q2或负责人视听。

## 自写镜头：源码与规格分开

custom使用 `module:scenes/<id>/index.js` 和brief；当前单模块 `PB.scene(id,ctx=>({timeline}))`，支持DOM、SVG图形、Canvas2D、暂停GSAP／OM.clock，不允许任意依赖／导入。只在独立uid的容器Chromium沙箱求值，页面生成器／Worker／控制器不执行它。

params声明textSlots、assetKeys、局部整数帧events、readingHolds，可用hardest指定优先。导演方法1.6可用 `assetChecks` 声明需要验证的DOM图片和帧，检查范围与限制见[导演说明](../../apps/cloud/README.md#导演选择结构d-实现自写镜头)；旧源码和Canvas用法不增加该前置。ctx.text／ctx.asset必须字面量；createElement／createElementNS／getContext的tag／namespace／context也须字面量，helper可以接已建元素或已解析handle。ctx.style.palette直接含bg／ink／accent，不是FilmSpec的roles包装。全部可见文字经text mount，当前Canvas/SVG文字绘制禁止。

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
