// Web-page observation for the already approved internal-evaluation capture workflow.
// Adapted from huashu-motion cli/lib/grab.js @ 52467f99 (MIT); no asset is cleared by observation.
export async function observeProduct(page){
 return page.evaluate(()=>{
  const visible=el=>{const box=el.getBoundingClientRect(),style=getComputedStyle(el);return box.width>1&&box.height>1&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0.05;};
  const url=value=>{if(!value)return null;try{const parsed=new URL(value,location.href);return ['https:','http:'].includes(parsed.protocol)&&parsed.href.length<=2048?parsed.href:null;}catch{return null;}};
  const images=[...document.images].filter(image=>image.width>180&&image.height>100).map(image=>({src:url(image.currentSrc||image.src),alt:(image.alt||'').slice(0,160),width:image.naturalWidth,height:image.naturalHeight,box:(()=>{const r=image.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()})).filter(image=>image.src).slice(0,40);
  for(const el of [...document.querySelectorAll('body *')].slice(0,6000)){
   if(images.length>=40)break;const box=el.getBoundingClientRect();if(box.width<240||box.height<120)continue;
   const match=/url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(el).backgroundImage),src=match&&url(match[1]);
   if(src&&!images.some(item=>item.src===src))images.push({src,alt:'background',width:Math.round(box.width),height:Math.round(box.height),box:{x:box.x,y:box.y,width:box.width,height:box.height}});
  }
  const logos=[];
  for(const link of document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"],meta[property="og:image"],meta[name="twitter:image"]')){
   const src=url(link.href||link.content);if(src)logos.push({src,kind:link.rel||link.getAttribute('property')||link.getAttribute('name')});
  }
  for(const image of document.images){
   const host=image.parentElement,identity=[image.id,image.getAttribute('class'),image.alt,image.getAttribute('aria-label'),image.getAttribute('src'),host?.id,host?.getAttribute('class')].join(' ');
   if(/logo|brand|wordmark|lockup/i.test(identity)){const src=url(image.currentSrc||image.src);if(src)logos.push({src,kind:'image'});}
  }
  for(const svg of document.querySelectorAll('svg')){
   if(svg.parentElement?.closest('svg'))continue;
   const host=svg.closest('a,header,nav,[class*=logo],[id*=logo]');
   if(visible(svg)&&host&&/logo|brand|wordmark|lockup/i.test([svg.id,svg.getAttribute('class'),svg.getAttribute('aria-label'),host.id,host.getAttribute('class')].join(' '))){
    const parts=[];let element=svg;
    while(element&&element!==document.documentElement&&parts.length<32){
     const name=element.localName;if(!/^[a-z][a-z0-9-]*$/i.test(name)||!element.parentElement){parts.length=0;break;}
     const siblings=[...element.parentElement.children].filter(child=>child.localName===name&&child.namespaceURI===element.namespaceURI);
     parts.unshift(`${name}:nth-of-type(${siblings.indexOf(element)+1})`);element=element.parentElement;
    }
    const selector=element===document.documentElement?['html',...parts].join(' > '):'';
    if(selector&&selector.length<=256&&document.querySelectorAll(selector).length===1&&document.querySelector(selector)===svg)logos.push({src:null,kind:'inline-svg',selector});
   }
  }
  const videos=[...document.querySelectorAll('video')].map(video=>({src:url(video.currentSrc||video.src||video.querySelector('source')?.src),poster:url(video.poster)})).filter(video=>video.src||video.poster).slice(0,40);
  const weights=new Map(),fonts=new Map(),add=(role,value,weight)=>{if(value&&!/transparent|rgba\(0, 0, 0, 0\)/.test(value))weights.set(role+'|'+value,(weights.get(role+'|'+value)||0)+weight);};
  for(const el of [...document.querySelectorAll('body,body *')].slice(0,6000)){
   if(!visible(el))continue;const style=getComputedStyle(el),box=el.getBoundingClientRect();
   add('ground',style.backgroundColor,Math.min(box.width*box.height,4e6));
   const chars=[...el.childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent.trim()).join('').length;
   if(chars){add('type',style.color,chars);const family=style.fontFamily.split(',')[0].replace(/["']/g,'').trim();if(family)fonts.set(family,(fonts.get(family)||0)+chars);}
   if(el.matches('button,a[class*=btn],a[class*=button],[role=button]'))add('accent',style.backgroundColor,400);
  }
  const colours=[...weights].map(([key,weight])=>{const [role,value]=key.split('|');return{role,value,weight};}).sort((a,b)=>b.weight-a.weight).slice(0,24);
  const pageText=document.body?.innerText||'';
  return{text:pageText.slice(0,7000),images,logos:logos.slice(0,40),videos,colours,fonts:[...fonts].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([family,chars])=>({family,chars})),pageHeight:document.documentElement.scrollHeight,
   cookieNoticeVisible:[...document.querySelectorAll('button,[role=button]')].some(el=>visible(el)&&/^(reject all|accept cookies|accept all)$/i.test(el.textContent.trim())&&/cookies/i.test(el.parentElement?.innerText||''))};
 });
}
