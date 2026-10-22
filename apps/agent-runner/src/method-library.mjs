import {digest} from '../../../packages/contracts/index.mjs';
import {METHOD_SOURCE,methodCatalog,excludedUpstream} from '../methods/catalog.mjs';
export const METHOD_LIBRARY_IDENTITY={...METHOD_SOURCE,contentHash:digest({methodCatalog,excludedUpstream})};
const required=['director','colour','rhythm','verification','provenance'];
const words=text=>String(text??'').toLowerCase().split(/[^\p{L}\p{N}:-]+/u).filter(Boolean);
const aliases=[[/软件|操作|界面|演示/u,'software ui workflow'],[/课程|教学|学习|解释/u,'course tutorial mechanism'],[/配色|颜色|品牌/u,'colour palette brand'],[/节奏|快|慢|停顿/u,'rhythm timing'],[/相机|运镜|拉近|推近/u,'camera'],[/改稿|修改|批注/u,'patch'],[/数据|图表|数字/u,'data chart evidence'],[/音乐|配乐|音效/u,'music sound'],[/文字|字体|中文|字幕/u,'typography text captions'],[/材质|艺术|绘画/u,'art']];
export function methodTopics(...inputs) {
  let text=inputs.filter(Boolean).join(' ');for(const [pattern,extra]of aliases)if(pattern.test(text))text+=' '+extra;
  return [...new Set(words(text))];
}
/** Only reviewed cards enter generation; capability gates are not prompt hints. */
export function selectMethods({task='',audience='',stage='create',capabilities=[],methodIds=[]}={}) {
  if(!Array.isArray(methodIds)||methodIds.length>16||new Set(methodIds).size!==methodIds.length)throw Error('LOCAL_AGENT_METHOD_SELECTION_INVALID');
  const available=new Set(capabilities),topics=methodTopics(task,audience,stage),eligible=card=>card.requires.every(value=>available.has(value));
  for(const id of methodIds) {
    const card=methodCatalog.find(card=>card.id===id);
    if(!card||!eligible(card))throw Error('LOCAL_AGENT_METHOD_UNAVAILABLE');
  }
  const score=card=>card.topics.reduce((n,tag)=>n+(topics.includes(tag)?1:0),0);
  const ranked=methodCatalog.filter(eligible).toSorted((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id));
  const ids=new Set([...required,...methodIds]);
  for(const category of ['method','format','language','experience']) {
    const limit={method:3,format:2,language:3,experience:4}[category];
    ranked.filter(card=>card.category===category&&score(card)>0&&!ids.has(card.id)).slice(0,limit).forEach(card=>ids.add(card.id));
  }
  return {identity:METHOD_LIBRARY_IDENTITY,stage,topics,selected:methodCatalog.filter(card=>ids.has(card.id)),
    index:methodCatalog.map(({id,category,title,requires})=>({id,category,title,available:requires.every(value=>available.has(value)),requires})),
    precedence:'current request and confirmed facts > enabled project preferences > verified local evidence > reviewed public methods > upstream inspiration'};
}
export function listMethods({topics=[],ids=[]}={}) {
  if(!Array.isArray(topics)||!Array.isArray(ids))throw Error('LOCAL_AGENT_METHOD_SELECTION_INVALID');
  if(ids.some(id=>!methodCatalog.some(card=>card.id===id)))throw Error('LOCAL_AGENT_METHOD_UNAVAILABLE');
  const terms=methodTopics(...topics);
  return {identity:METHOD_LIBRARY_IDENTITY,cards:methodCatalog.filter(card=>(!ids.length||ids.includes(card.id))&&(!terms.length||terms.some(term=>card.topics.includes(term)||card.title.includes(term)))),excludedUpstream};
}
