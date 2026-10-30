// Local/private playback for accepted candidates and explicitly unapproved review drafts.
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function reviewPage({title,movies,draft=false,coldReviewStatus}){
 const heading=draft?'待人工审片':'候选待视听';
 const message=draft?(coldReviewStatus==='blocked'
  ?'自动修改已停止；独立冷审仍有未解决的问题。以下保留最后实际渲染版本，供你判断下一步。'
  :'自动修改已到上限。以下保留最后实际渲染版本，最后一轮新建议未应用；独立冷审尚未通过。')
  :movies.length===1?(movies[0].aspect==='portrait'?'竖屏成片已交付，请按正常速度完整视听。':'横屏成片已交付，请按正常速度完整视听。'):'横竖成片已交付，请按正常速度完整视听。';
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · ${heading}</title><style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0b1524;color:#f5f1e8}body{max-width:1040px;margin:48px auto;padding:0 24px}h1{font-size:clamp(28px,5vw,44px);line-height:1.15}p{font-size:18px;line-height:1.6;color:#cad6e8}small{font-size:15px;color:#b5c6df}section{margin:32px 0}h2{font-size:23px}video{display:block;width:100%;max-height:76vh;background:#030a13;border-radius:12px}.controls{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin:16px 0}button{border:0;border-radius:8px;padding:13px 20px;background:#b6eaff;color:#102034;font:600 17px system-ui;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid white;outline-offset:4px}.state{font-size:16px;color:#cad6e8}a{color:#b6eaff}footer{margin-top:28px;font-size:16px;line-height:1.7}
</style><header><small>私有内部审片 · ${heading}</small><h1>${escape(title)}</h1><p>${message}</p></header>
${movies.map(movie=>`<section><h2>${movie.aspect==='portrait'?'竖屏':'横屏'} · ${movie.quality==='review'?'低清审片':'最终编码'}</h2><video controls playsinline preload="metadata" poster="${escape(movie.poster)}" src="${escape(movie.file)}" aria-label="${escape(movie.aspect)} 内部审片"></video><div class="controls"><button type="button">从头有声播放 · 1×</button><span class="state" role="status" aria-live="polite">点击按钮开始播放</span></div></section>`).join('')}
<footer>${draft?'自动质量审查未通过，不计入 S1 通过数。':'负责人视听结论仍待确认。'} 成片不对外发布。<br><a href="${draft?'review-draft':'candidate'}.json">${draft?'未验收草稿与审查结果':'候选与冷审'}</a> · <a href="report.json">费用与运行回执</a></footer>
<script>
for(const section of document.querySelectorAll('section')){
 const video=section.querySelector('video'),button=section.querySelector('button'),state=section.querySelector('.state');
 const playing=()=>state.textContent='正在播放 · '+(video.muted||video.volume===0?'已静音':'有声')+' · '+video.playbackRate+'×';
 button.addEventListener('click',async()=>{for(const other of document.querySelectorAll('video'))other.pause();video.currentTime=0;video.playbackRate=1;video.muted=false;video.volume=1;try{await video.play();}catch{state.textContent='播放未开始，请使用视频上的播放按钮。';}});
 video.addEventListener('playing',playing);video.addEventListener('pause',()=>{if(!video.ended)state.textContent='已暂停';});video.addEventListener('ended',()=>state.textContent='播放完毕 · 可从头重看');
 for(const event of ['ratechange','volumechange'])video.addEventListener(event,()=>{if(!video.paused)playing();});
 video.addEventListener('error',()=>state.textContent='无法加载视频，请保留本页与视频文件在同一目录。');
}
</script></html>`;
}
