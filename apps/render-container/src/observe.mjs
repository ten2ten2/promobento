/** Trusted CDP snapshot and platform-font inspection; no page-supplied QA booleans. */
export async function observe(cdp, plan, renderId, frame) {
  const names = ['font-size', 'color', 'background-color', 'visibility', 'display', 'opacity', 'overflow', 'font-weight',
    ...(plan.observeAssets ? ['mask-image', 'filter', 'pointer-events', 'background-image', 'box-shadow', 'outline-style',
      'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style', 'border-image-source', 'backdrop-filter'] : [])];
  const snapshot = await cdp.send('DOMSnapshot.captureSnapshot', {computedStyles: names, includePaintOrder: true});
  const strings = snapshot.strings, {nodes, layout} = snapshot.documents[0];
  const rowFor = new Map(layout.nodeIndex.map((node, row) => [node, row]));
  const attributes = node => new Map(Array.from({length: (nodes.attributes[node]?.length ?? 0) / 2}, (_, i) =>
    [strings[nodes.attributes[node][i * 2]], strings[nodes.attributes[node][i * 2 + 1]]]));
  const style = (node, key) => { const row = rowFor.get(node); return row === undefined ? null : strings[layout.styles[row][names.indexOf(key)]]; };
  const parent = node => nodes.parentIndex[node];
  const ancestor = (node, candidate) => { for (let current = node; current >= 0; current = parent(current)) if (current === candidate) return true; return false; };
  const color = text => {
    const rgb = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(text ?? '');
    return rgb ? {rgb: rgb.slice(1, 4).map(Number), alpha: rgb[4] === undefined ? 1 : Number(rgb[4])} : null;
  };
  const luminance = rgb => rgb.map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; })
    .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const texts = [], regions = [], findings = [];
  const customIds=new Set(plan.spec.scenes.filter(scene=>scene.kind==='custom'&&scene.start<=frame&&frame<scene.end).map(scene=>scene.id));
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable'); await cdp.send('DOM.getDocument');
  for (const [node, row] of rowFor) {
    const slotId = attributes(node).get('data-pb-slot'); if (!slotId) continue;
    let visible = true,sceneId;
    for (let current = node; current >= 0; current = parent(current)) {
      if (style(current, 'visibility') === 'hidden' || style(current, 'display') === 'none' || style(current, 'opacity') === '0') visible = false;
      const candidate=attributes(current).get('data-scene');if(customIds.has(candidate))sceneId=candidate;
    }
    if (!visible) continue;
    const graphemeScene=sceneId&&plan.spec.scenes.some(scene=>scene.id===sceneId&&scene.kind==='custom'&&scene.runtimeText==='grapheme-v1');
    const [x, y, width, height] = layout.bounds[row], box = {x, y, width, height};
    if (!width || !height) continue;
    const slot = plan.spec.texts[slotId]; if (!slot) throw Error('OBSERVATION_SLOT_UNKNOWN');
    const ref = plan.spec.style.type[['headline', 'cta', 'number'].includes(slot.role) ? 'display' : 'text'];
    const face = plan.fonts.find(face => face.fontId === ref.fontId && face.weight === ref.weight && face.style === (ref.style ?? 'normal'));
    if (!face?.codePoints) throw Error('FONT_CMAP_UNAVAILABLE');
    const coverage = new Set(face.codePoints);
    const textNodes=nodes.nodeValue.flatMap((value,index)=>nodes.nodeType[index]===3&&ancestor(index,node)?[{index,text:strings[value]??''}]:[]);
    const descendants=textNodes.map(item=>item.text).join('');
    const missingGlyphs = [...descendants].filter(character => !/[\s\u200d\ufe0e\ufe0f]/u.test(character) && !coverage.has(character.codePointAt(0))).length;
    const nestedParents=[...new Set(textNodes.filter(piece=>piece.text.trim()&&parent(piece.index)!==node).map(piece=>parent(piece.index)))];
    const {nodeIds} = await cdp.send('DOM.pushNodesByBackendIdsToFrontend', {backendNodeIds: [node,...nestedParents].map(index=>nodes.backendNodeId[index])});
    if(nodeIds.length!==nestedParents.length+1||nodeIds.some(id=>!id))throw Error('FONT_OBSERVATION_UNAVAILABLE');
    const fontResults=await Promise.all(nodeIds.map(nodeId=>cdp.send('CSS.getPlatformFontsForNode',{nodeId})));
    const fonts=[...fontResults[0].fonts],originalFonts=new Set(fonts.map(font=>font.familyName+'\0'+font.isCustomFont));
    const extras=new Map();for(const result of fontResults.slice(1))for(const font of result.fonts){
      const key=font.familyName+'\0'+font.isCustomFont;if(originalFonts.has(key))continue;
      const previous=extras.get(key);if(previous)previous.glyphCount+=font.glyphCount;else extras.set(key,{...font});
    }
    fonts.push(...extras.values());if(fonts.length>8)throw Error('FONT_OBSERVATION_LIMIT');
    const fallbackUsed = fonts.some(font => !font.isCustomFont) || Boolean(descendants.trim() && !fonts.length)
      ||fontResults.slice(1).some(result=>!result.fonts.length);
    let background;
    for (let current = node; current >= 0; current = parent(current)) { const candidate = color(style(current, 'background-color'));
      if (candidate?.alpha === 1) { background = candidate.rgb; break; } }
    const foreground = color(style(node, 'color'));
    if (!background || !foreground) throw Error('CONTRAST_OBSERVATION_UNAVAILABLE');
    let ratio = contrast(foreground.rgb, background);const safe = plan.target.safeInsets;
    let insideSafeArea = x >= plan.target.width * safe.left - 2 && y >= plan.target.height * safe.top - 2
      && x + width <= plan.target.width * (1 - safe.right) + 2 && y + height <= plan.target.height * (1 - safe.bottom) + 2;
    let clipped = false,clipDetail;
    const markClipped=detail=>{clipped=true;clipDetail??=detail;};
    const rect=value=>value.map(number=>Math.round(number*100)/100).join(',');
    if(x < 0 || y < 0 || x + width > plan.target.width + 1 || y + height > plan.target.height + 1)markClipped('Slot bounds extend outside the frame.');
    for (let current = parent(node); current >= 0; current = parent(current)) {
      const parentRow = rowFor.get(current); if (parentRow === undefined || !['hidden', 'clip'].includes(style(current, 'overflow'))) continue;
      const [a, b, w, h] = layout.bounds[parentRow];
      if (x < a - 1 || y < b - 1 || x + width > a + w + 1 || y + height > b + h + 1)markClipped(`Slot [${rect([x,y,width,height])}] exceeds clipping ancestor [${rect([a,b,w,h])}].`);
    }
    // A slot can contain individually animated spans. The slot's bounding box
    // and concatenated DOM text alone do not prove that every part is painted:
    // a child may be transparent, clipped or translated outside the viewport.
    for(const piece of textNodes){
      if(parent(piece.index)===node||!piece.text.trim())continue;
      const pieceRow=rowFor.get(piece.index),bounds=pieceRow===undefined?null:layout.bounds[pieceRow];
      if(!bounds||bounds[2]<=0||bounds[3]<=0){markClipped('Nested text has no visible layout bounds.');continue;}
      const [px,py,pw,ph]=bounds;
      const nestedForeground=color(style(parent(piece.index),'color'));let nestedBackground;
      for(let current=parent(piece.index);current>=0;current=parent(current)){const candidate=color(style(current,'background-color'));if(candidate?.alpha===1){nestedBackground=candidate.rgb;break;}}
      if(!nestedForeground||!nestedBackground)markClipped('Nested text foreground or background is unavailable.');
      else{
        if(graphemeScene&&nestedForeground.alpha!==1)markClipped('A grapheme has a translucent text color.');
        const rgb=nestedForeground.rgb.map((value,index)=>value*nestedForeground.alpha+nestedBackground[index]*(1-nestedForeground.alpha));
        ratio=Math.min(ratio,contrast(rgb,nestedBackground));
      }
      if(px<0||py<0||px+pw>plan.target.width+1||py+ph>plan.target.height+1)markClipped(`Nested text [${rect(bounds)}] extends outside the frame.`);
      if(px<plan.target.width*safe.left-2||py<plan.target.height*safe.top-2
        ||px+pw>plan.target.width*(1-safe.right)+2||py+ph>plan.target.height*(1-safe.bottom)+2)insideSafeArea=false;
      for(let current=parent(piece.index);current>=0;current=parent(current)){
        const opacity=Number(style(current,'opacity')??1);
        if(style(current,'visibility')==='hidden'||style(current,'display')==='none'||opacity===0||graphemeScene&&opacity<1)markClipped('A nested text ancestor is hidden or translucent.');
        const pieceColor=color(style(current,'color'));if(current!==node&&pieceColor?.alpha===0)markClipped('A nested text ancestor has transparent color.');
        const parentRow=rowFor.get(current);
        if(parentRow!==undefined&&['hidden','clip'].includes(style(current,'overflow'))){
          const [a,b,w,h]=layout.bounds[parentRow];if(px<a-1||py<b-1||px+pw>a+w+1||py+ph>b+h+1)markClipped(`Nested text [${rect(bounds)}] exceeds clipping ancestor [${rect([a,b,w,h])}].`);
        }
        if(current===node)break;
      }
    }
    // Hit-test the visible intersection, never an off-viewport center. Fully clipped text is
    // already a BLOCK above; absence of a hit inside the viewport is conservative occlusion review.
    const left = Math.max(0, x), top = Math.max(0, y), right = Math.min(plan.target.width, x + width), bottom = Math.min(plan.target.height, y + height);
    let covered = false;
    if (right > left && bottom > top) {
      try {
        const hit = await cdp.send('DOM.getNodeForLocation', {x: Math.min(plan.target.width - 1, Math.floor((left + right) / 2)),
          y: Math.min(plan.target.height - 1, Math.floor((top + bottom) / 2)), ignorePointerEventsNone: true});
        const hitNode = nodes.backendNodeId.indexOf(hit.backendNodeId);
        covered = hitNode < 0 || !ancestor(hitNode, node) && !ancestor(node, hitNode);
      } catch (error) {
        if (!String(error.message).includes('No node found at given location')) throw error;
        covered = true;
      }
    }
    // WCAG 1.4.3: 18pt regular / 14pt bold. Use actual CDP font metrics, not the text role or author flags.
    const size=Number.parseFloat(style(node,'font-size')),weight=Number.parseFloat(style(node,'font-weight'));
    const largeText=size>=24||size>=14*4/3&&weight>=700;
    texts.push({slotId, ...(sceneId?{sceneId}:{}), text: descendants, box, fonts: fonts.map(font => ({family: font.familyName, glyphCount: font.glyphCount})),
      fallbackUsed, missingGlyphs, contrastRatio: Math.max(1, Math.min(21, ratio)), largeText,
      insideSafeArea, clipped, covered});
    regions.push({regionId: slotId, box});
    for (const [condition, code] of [[fallbackUsed, 'FONT_FALLBACK_USED'], [missingGlyphs > 0, 'FONT_GLYPH_MISSING'],
      [!insideSafeArea, 'outside-safe-area'], [clipped, 'text-clipped'], [covered, 'text-covered'], [ratio < (largeText?3:4.5), 'low-contrast']])
      if (condition) findings.push({code, severity: code === 'text-covered' ? 'REVIEW' : 'BLOCK', slotId,...(code==='text-clipped'&&clipDetail?{detail:clipDetail}:{})});
  }
  if(customIds.size)for(const [node,row]of rowFor){
    if(nodes.nodeType[node]!==3||!strings[nodes.nodeValue[node]]?.trim())continue;
    let active=true,custom=false,slot;
    for(let current=parent(node);current>=0;current=parent(current)){
      if(style(current,'visibility')==='hidden'||style(current,'display')==='none'||style(current,'opacity')==='0')active=false;
      const attrs=attributes(current);if(customIds.has(attrs.get('data-scene')))custom=true;
      slot??=attrs.get('data-pb-slot');
    }
    if(active&&custom&&!slot)throw Error('CUSTOM_TEXT_UNBOUND');
  }
  for(const text of texts)if(customIds.size&&text.text!==plan.spec.texts[text.slotId].text)throw Error('CUSTOM_TEXT_MISMATCH');
  let assets;
  if(plan.observeAssets){
    assets=[];
    const definitelyHidden=node=>{
      for(let current=node;current>=0;current=parent(current)){
        if(['hidden','collapse'].includes(style(current,'visibility'))||style(current,'display')==='none'||style(current,'opacity')==='0')return true;
      }
      return false;
    };
    // A transparent DIV can receive an ignorePointerEventsNone hit without painting pixels.
    // Only treat it as paintless when every relevant decoration is explicitly absent; its
    // children and pseudo-elements are checked independently as possible overlays.
    const paintlessContainer=node=>{
      if(strings[nodes.nodeName?.[node]]!=='DIV'||nodes.nodeType[node]!==1||nodes.pseudoType?.index?.includes(node))return false;
      const background=color(style(node,'background-color'));
      return background?.alpha===0&&['background-image','box-shadow','border-image-source','filter','backdrop-filter'].every(key=>style(node,key)==='none')
        &&['outline-style','border-top-style','border-right-style','border-bottom-style','border-left-style'].every(key=>style(node,key)==='none');
    };
    // Normal hit testing ignores pointer-events:none layers even when they paint over the image.
    // Fall through only a hidden or provably paintless hit when no later painted layer can cover
    // the point. Missing styles or paint order remain unverified.
    const possiblePointerOverlay=(target,x,y)=>{
      const targetRow=rowFor.get(target),order=layout.paintOrders?.[targetRow];
      if(!Number.isInteger(order))return true;
      for(const [candidate,row]of rowFor){
        if(candidate===target||ancestor(candidate,target)||ancestor(target,candidate)||style(candidate,'pointer-events')!=='none'||definitelyHidden(candidate)||paintlessContainer(candidate))continue;
        const otherOrder=layout.paintOrders?.[row],box=layout.bounds[row];
        if(!Number.isInteger(otherOrder)||!box)return true;
        if(otherOrder>=order&&x>=box[0]&&x<box[0]+box[2]&&y>=box[1]&&y<box[1]+box[3])return true;
      }
      return false;
    };
    // Chromium hit testing can return an opacity-zero sibling even though it paints nothing.
    // Only fall through that hit if the point lies in the actual transformed image and each
    // clipping ancestor, and no later, potentially painted node overlaps it. Bounds alone are
    // not proof for rotated images; unknown quads or paint order stay unverified.
    const visibleBelowHiddenHit=async(target,x,y)=>{
      const pointInQuad=(q)=>{
        if(!Array.isArray(q)||q.length!==8||q.some(v=>!Number.isFinite(v)))return false;
        let sign=0;
        for(let i=0;i<4;i++){
          const j=(i+1)%4,cross=(q[2*j]-q[2*i])*(y-q[2*i+1])-(q[2*j+1]-q[2*i+1])*(x-q[2*i]);
          if(Math.abs(cross)<1e-6)continue;
          const next=Math.sign(cross);if(sign&&next!==sign)return false;sign=next;
        }
        return sign!==0;
      };
      const inContent=async node=>{
        try{const result=await cdp.send('DOM.getContentQuads',{backendNodeId:nodes.backendNodeId[node]});return result.quads?.some(pointInQuad)===true;}
        catch{return false;}
      };
      if(!await inContent(target))return false;
      for(let current=parent(target);current>=0;current=parent(current))
        if(['hidden','clip','scroll','auto'].includes(style(current,'overflow'))&&!await inContent(current))return false;
      const order=layout.paintOrders?.[rowFor.get(target)];if(!Number.isInteger(order))return false;
      for(const[candidate,row]of rowFor){
        if(candidate===target||ancestor(candidate,target)||ancestor(target,candidate)||definitelyHidden(candidate)||paintlessContainer(candidate))continue;
        const otherOrder=layout.paintOrders?.[row],box=layout.bounds[row];
        if(!Number.isInteger(otherOrder)||!box)return false;
        if(otherOrder>=order&&x>=box[0]&&x<box[0]+box[2]&&y>=box[1]&&y<box[1]+box[3])return false;
      }
      return true;
    };
    const expected=new Map();
    for(const scene of plan.spec.scenes){
      if(!customIds.has(scene.id)||!Array.isArray(scene.params?.assetChecks))continue;
      const ids=new Set();
      for(const check of scene.params.assetChecks)if(check?.frame===frame-scene.start&&Array.isArray(check.assetKeys))
        for(const key of check.assetKeys)if(plan.assets?.[key])ids.add(plan.assets[key].resourceId);
      if(ids.size)expected.set(scene.id,ids);
    }
    for(let node=0;node<nodes.parentIndex.length;node++){
      if(strings[nodes.nodeName?.[node]]!=='IMG')continue;
      const src=attributes(node).get('src');let url;
      try{url=new URL(src,'http://film.internal');}catch{continue;}
      if(url.origin!=='http://film.internal'||url.search||url.hash)continue;
      const match=/^\/r\/(res_[A-Za-z0-9_-]{4,64})$/.exec(url.pathname);
      if(!match)continue;
      let sceneId,visible=true,opacity=1,masked=false;
      const row=rowFor.get(node),bounds=row===undefined?null:layout.bounds[row];
      let left=bounds?Math.max(0,bounds[0]):0,top=bounds?Math.max(0,bounds[1]):0,
        right=bounds?Math.min(plan.target.width,bounds[0]+bounds[2]):0,bottom=bounds?Math.min(plan.target.height,bounds[1]+bounds[3]):0;
      for(let current=node;current>=0;current=parent(current)){
        const candidate=attributes(current).get('data-scene');if(customIds.has(candidate))sceneId=candidate;
        const visibility=style(current,'visibility'),display=style(current,'display'),alpha=style(current,'opacity');
        if(visibility==='hidden'||visibility==='collapse'||display==='none')visible=false;
        if(alpha!=null){const value=Number(alpha);if(Number.isFinite(value))opacity*=value;else masked=true;}
        if((style(current,'mask-image')??'none')!=='none'||(style(current,'filter')??'none')!=='none')masked=true;
        const parentRow=rowFor.get(current);
        if(current!==node&&parentRow!==undefined&&['hidden','clip','scroll','auto'].includes(style(current,'overflow'))){
          const [x,y,w,h]=layout.bounds[parentRow];left=Math.max(left,x);top=Math.max(top,y);right=Math.min(right,x+w);bottom=Math.min(bottom,y+h);
        }
      }
      if(!sceneId||!expected.get(sceneId)?.has(match[1]))continue;
      let state='hidden';
      if(visible&&opacity>0&&right-left>=1&&bottom-top>=1){
        state='unverified';
        if(opacity>=0.1&&!masked){
          // Transparent, pointer-active layers may sit over the centre of an image. Include
          // perimeter points without treating an obscured centre as proof of visibility.
          for(const [fx,fy] of [[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75],
            [.005,.005],[.995,.005],[.005,.995],[.995,.995]]){
            const x=Math.min(plan.target.width-1,Math.floor(left+(right-left)*fx)),y=Math.min(plan.target.height-1,Math.floor(top+(bottom-top)*fy));
            try{
              const all=await cdp.send('DOM.getNodeForLocation',{x,y,ignorePointerEventsNone:true}),hitNode=nodes.backendNodeId.indexOf(all.backendNodeId);
              if(hitNode>=0&&ancestor(hitNode,node))state='visible';
              else if(hitNode>=0&&(definitelyHidden(hitNode)||paintlessContainer(hitNode))){
                const normal=await cdp.send('DOM.getNodeForLocation',{x,y,ignorePointerEventsNone:false}),normalNode=nodes.backendNodeId.indexOf(normal.backendNodeId);
                if(normalNode>=0&&ancestor(normalNode,node)&&!possiblePointerOverlay(node,x,y))state='visible';
                else if(normalNode>=0&&definitelyHidden(normalNode)&&await visibleBelowHiddenHit(node,x,y))state='visible';
              }
            }catch(error){if(!String(error.message).includes('No node found at given location'))throw error;}
            if(state==='visible')break;
          }
        }
      }
      assets.push({sceneId,resourceId:match[1],visibility:state});
      if(assets.length>200)throw Error('ASSET_OBSERVATION_LIMIT');
    }
  }
  return {schemaVersion: '3.0.0', kind: 'frame_observation', renderId, aspectId: plan.target.aspect, frame, texts, regions, findings,...(assets?{assets}:{})};
}
