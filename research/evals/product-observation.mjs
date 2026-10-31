// Web-page observation for the already approved internal-evaluation capture workflow.
// Adapted from huashu-motion cli/lib/grab.js @ 52467f99 (MIT); no asset is cleared by observation.
export async function observeProduct(page){
 return page.evaluate(()=>{
  const visible=el=>{const box=el.getBoundingClientRect(),style=getComputedStyle(el);return box.width>1&&box.height>1&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0.05;};
  const url=value=>{if(!value)return null;try{const parsed=new URL(value,location.href);return ['https:','http:'].includes(parsed.protocol)&&parsed.href.length<=2048?parsed.href:null;}catch{return null;}};
  const images=[...document.images].filter(image=>image.width>180&&image.height>100).map(image=>({src:url(image.currentSrc||image.src),alt:(image.alt||'').slice(0,160),width:image.naturalWidth,height:image.naturalHeight,box:(()=>{const r=image.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()})).filter(image=>image.src);
  const imageUrls=new Set(images.map(image=>image.src));
  for(const el of [...document.querySelectorAll('body *')].slice(0,6000)){
   const box=el.getBoundingClientRect();if(box.width<240||box.height<120)continue;
   const match=/url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(el).backgroundImage),src=match&&url(match[1]);
   if(src&&!imageUrls.has(src)){imageUrls.add(src);images.push({src,alt:'background',width:Math.round(box.width),height:Math.round(box.height),box:{x:box.x,y:box.y,width:box.width,height:box.height}});}
  }
  const logos=[];
  for(const link of document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"],meta[property="og:image"],meta[name="twitter:image"]')){
   const src=url(link.href||link.content);if(src)logos.push({src,kind:link.rel||link.getAttribute('property')||link.getAttribute('name')});
  }
  for(const image of document.images){
   const host=image.parentElement,identity=[image.id,image.getAttribute('class'),image.alt,image.getAttribute('aria-label'),image.getAttribute('src'),host?.id,host?.getAttribute('class')].join(' ');
   if(/logo|brand|wordmark|lockup/i.test(identity)){const src=url(image.currentSrc||image.src);if(src)logos.push({src,kind:'image'});}
  }
  // Selectors identify candidates only. Extraction still requires separate approval and static-source verification.
  const vectors=[],icons=[];
  const selectorFor=target=>{const parts=[];let element=target;
   while(element&&element!==document.documentElement&&parts.length<32){
    const name=element.localName;if(!/^[a-z][a-z0-9-]*$/i.test(name)||!element.parentElement)return null;
    const siblings=[...element.parentElement.children].filter(child=>child.localName===name&&child.namespaceURI===element.namespaceURI);
    parts.unshift(`${name}:nth-of-type(${siblings.indexOf(element)+1})`);element=element.parentElement;
   }
   const selector=element===document.documentElement?['html',...parts].join(' > '):'';
   return selector&&selector.length<=256&&document.querySelectorAll(selector).length===1&&document.querySelector(selector)===target?selector:null;
  };
  for(const svg of document.querySelectorAll('svg')){
   if(svg.parentElement?.closest('svg')||!visible(svg))continue;
   const host=svg.closest('a,header,nav,[class*=logo],[id*=logo]'),isLogo=host&&/logo|brand|wordmark|lockup/i.test([svg.id,svg.getAttribute('class'),svg.getAttribute('aria-label'),host.id,host.getAttribute('class')].join(' '));
   if(vectors.length>200&&!isLogo)continue;
   const selector=selectorFor(svg);if(!selector)continue;
   if(vectors.length<=200){const box=svg.getBoundingClientRect(),label=(svg.getAttribute('aria-label')||svg.querySelector('title')?.textContent||'').trim().slice(0,160);
    vectors.push({selector,width:Math.round(box.width),height:Math.round(box.height),label});}
   if(isLogo)logos.push({src:null,kind:'inline-svg',selector});
  }
  for(const image of document.images){
   if(icons.length>200)break;
   const src=url(image.currentSrc||image.src),box=image.getBoundingClientRect();if(!src||!visible(image))continue;
   if(/\.svg(?:[?#]|$)/i.test(src)||box.width<=128&&box.height<=128)icons.push({src,alt:(image.alt||'').slice(0,160),width:Math.round(box.width),height:Math.round(box.height)});
  }
  const videos=[],videoKeys=new Set();
  for(const video of document.querySelectorAll('video')){
   const poster=url(video.poster),sources=[video.currentSrc,video.src,...[...video.querySelectorAll('source')].map(source=>source.src)].map(url).filter(Boolean);
   for(const src of sources.length?sources:[null]){const key=(src??'')+'|'+(poster??'');if((src||poster)&&!videoKeys.has(key)){videoKeys.add(key);videos.push({src,poster});}}
  }
  const weights=new Map(),fonts=new Map(),add=(role,value,weight)=>{if(value&&!/transparent|rgba\(0, 0, 0, 0\)/.test(value))weights.set(role+'|'+value,(weights.get(role+'|'+value)||0)+weight);};
  for(const el of [...document.querySelectorAll('body,body *')].slice(0,6000)){
   if(!visible(el))continue;const style=getComputedStyle(el),box=el.getBoundingClientRect();
   add('ground',style.backgroundColor,Math.min(box.width*box.height,4e6));
   const chars=[...el.childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent.trim()).join('').length;
   if(chars){add('type',style.color,chars);const family=style.fontFamily.split(',')[0].replace(/["']/g,'').trim();if(family)fonts.set(family,(fonts.get(family)||0)+chars);}
   if(el.matches('button,a[class*=btn],a[class*=button],[role=button]'))add('accent',style.backgroundColor,400);
  }
  const colours=[...weights].map(([key,weight])=>{const [role,value]=key.split('|');return{role,value,weight};}).sort((a,b)=>b.weight-a.weight).slice(0,24);
  const cssVariables=[],variableKeys=new Set();let cssVariablesTruncated=false,cssRulesUnavailable=false,visitedRules=0;
  const visit=(rules,conditions=[])=>{
   for(const rule of rules){
    if(++visitedRules>3000){cssVariablesTruncated=true;return;}
    if(rule.style)for(const name of rule.style){
     if(!name.startsWith('--'))continue;const value=rule.style.getPropertyValue(name).trim();
     if(value.length>120||!/^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklch)\()/i.test(value)||!CSS.supports('color',value))continue;
     const selector=(rule.selectorText||'').slice(0,256),key=JSON.stringify([conditions,selector,name,value]);if(variableKeys.has(key))continue;variableKeys.add(key);
     if(cssVariables.length<100)cssVariables.push({selector,name,value,conditions});else cssVariablesTruncated=true;
    }
    try{if(rule.cssRules)visit(rule.cssRules,[...conditions,String(rule.conditionText||rule.name||'group').slice(0,120)]);}catch{cssRulesUnavailable=true;}
   }
  };
  for(const sheet of document.styleSheets)try{visit(sheet.cssRules);}catch{cssRulesUnavailable=true;}
  const pageText=document.body?.innerText||'';
  return{text:pageText.slice(0,7000),images:images.slice(0,200),logos:logos.slice(0,200),videos:videos.slice(0,200),vectors:vectors.slice(0,200),icons:icons.slice(0,200),candidateCapExceeded:[images,logos,videos,vectors,icons].some(items=>items.length>200),colours,cssVariables,cssVariablesTruncated,cssRulesUnavailable,fonts:[...fonts].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([family,chars])=>({family,chars})),pageHeight:document.documentElement.scrollHeight,
   cookieNoticeVisible:[...document.querySelectorAll('button,[role=button]')].some(el=>visible(el)&&/^(reject all|accept cookies|accept all)$/i.test(el.textContent.trim())&&/cookies/i.test(el.parentElement?.innerText||''))};
 });
}

/** Combine observed, not downloaded, candidates from every visited viewport. */
export function mergeProductObservations(observations){
 const result={...observations[0],images:[],logos:[],videos:[],vectors:[],icons:[],cssVariables:[],candidateCapExceeded:observations.some(item=>item.candidateCapExceeded),cssVariablesTruncated:observations.some(item=>item.cssVariablesTruncated),cssRulesUnavailable:observations.some(item=>item.cssRulesUnavailable)};
 delete result.viewY;
 for(const name of ['images','logos','videos','vectors','icons']){
  const seen=new Set();for(const observation of observations)for(const item of observation[name]??[]){
   const key=name==='vectors'?'inline:'+item.selector:name==='logos'&&item.kind==='inline-svg'?'inline:'+item.selector:name==='videos'?(item.src??'')+'|'+(item.poster??''):item.src;
   if(!key||seen.has(key))continue;seen.add(key);
   if(result[name].length<200)result[name].push({...item,...(Number.isFinite(observation.viewY)?{observedAtY:observation.viewY}:{})});else result.candidateCapExceeded=true;
  }
 }
 const cssSeen=new Set();for(const observation of observations)for(const item of observation.cssVariables??[]){
  const key=JSON.stringify([item.conditions,item.selector,item.name,item.value]);if(cssSeen.has(key))continue;cssSeen.add(key);
  if(result.cssVariables.length<100)result.cssVariables.push(item);else result.cssVariablesTruncated=true;
 }
 result.pageHeight=Math.max(...observations.map(item=>item.pageHeight));result.cookieNoticeVisible=observations.some(item=>item.cookieNoticeVisible);
 return result;
}
