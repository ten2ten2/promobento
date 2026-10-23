# S1 评测输入

题目与使用范围以 [`topics.json`](topics.json) 为准。三家产品已有按 2026-10-23 官方页面整理的事实卡与素材来源：

- [DeepSeek](fact-cards/deepseek.json)：网页对话、API 平台与文档入口；主画面优先官网和无私人内容的初始界面。
- [MiniMax](fact-cards/minimax.json)：以 MiniMax Code 为软件题目，展示 agent 工作流和 Coding/Work 模式；不引用价格、速度排名或成本节省比例。
- [Duolingo](fact-cards/duolingo.json)：短课、读写听说与个性化练习；官方入门文章含可定位的产品界面截图。

负责人已确认六张卡中的官网功能/课程内容陈述用于 **S1 首次内部评测**，确认范围与事实 ID 保存在卡片中；不含虚构业绩，也不授权公开成片。截图、Logo、录屏的本体尚未采集或上传；来源链接不等于可公开商用的许可。后续采集只使用已有的负责人内部评测决定，进入预发布 R2，不进 Git，不对外发布。每次真实评测前核对事实和权利记录，品牌页面发生变化时复核，不把旧价格或宣传数据沿用到新作品。

负责人于 2026-10-23 确认将三门虚构课程替换为真实公开课程，仅限内部评测：

- [IELTS Ready](fact-cards/ielts-ready.json)：British Council 的练习、短课与专家 webinar；不承诺提分，不把 Premium 条件省掉。
- [Marugoto](fact-cards/marugoto.json)：日本国际交流基金的日语沟通课程；不是 JLPT N2 冲刺班，不使用合格率。
- [Hugging Face LLM Course](fact-cards/hf-llm-course.json)：Transformer、微调、Datasets 与 Tokenizers；保留 Python 学习基础要求。课程材料复用按其 Apache-2.0 许可保留通知，商标与肖像单独处理。

旧虚构课程卡及其编造的价格、提分率和学员结果已退出评测集。事实确认不等于素材采集完成；真实运行前仍核对实际字节与权利。代码回归另用 [`filmFixture`](../../packages/film-runtime/test/fixture.mjs) 和原创无字界面。
