// Original, fictional engineering fixture. It does not contain third-party product material.
export function filmFixture() {
  return {
    schemaVersion:'3.0.0',specVersion:'film-v1',audience:'software',durationSeconds:15,fps:30,totalFrames:450,
    style:{palette:{roles:{bg:'#101712',ink:'#f4f8ee',accent:'#d9fa73'},sources:{bg:'fixture',ink:'fixture',accent:'fixture'}},
      type:{display:{fontId:'geist-sans',weight:600},text:{fontId:'geist-sans',weight:600},scale:'regular'},
      motion:{language:'continuous-take',energy:3,easing:'expo-out',transitions:'tight'}},
    audio:{music:{kind:'none'},sfx:[],captions:'off',mute:true},
    texts:{headline:{text:'Give your next launch\nsome momentum.',role:'headline',factIds:[]},
      intro:{text:'Real product. Clear story. One good video.',role:'body',factIds:[]},
      product:{text:'Keep the product\nin the picture.',role:'headline',factIds:[]},
      cta:{text:'Go from a spark\nto a launch.',role:'cta',factIds:['fixture-cta']},
      url:{text:'orbit.example',role:'label',factIds:[]}},
    assets:{dashboard:{resourceId:'res_fixture_dashboard',roi:[{x:0.56,y:0.2,width:0.34,height:0.3}]}},
    scenes:[{id:'hook',start:0,end:126,kind:'block',block:'hook-title@1',params:{textSlot:'headline',subtitleSlot:'intro'},purpose:'Introduce the story.'},
      {id:'product',start:120,end:336,kind:'block',block:'ui-showcase@1',params:{assetKey:'dashboard',textSlot:'product',focus:'roi:0'},transitionIn:{type:'push',frames:6},purpose:'Show the original fictional product screen.'},
      {id:'cta',start:330,end:450,kind:'block',block:'cta-endcard@1',params:{textSlot:'cta',subtitleSlot:'url'},transitionIn:{type:'crossfade',frames:6},purpose:'Hold a readable call to action.'}],
    treatment:{message:'A fictional product launch.',hook:'A typographic opening.',energyCurve:[{frame:0,level:3},{frame:449,level:1}],continuity:'Type to product to action.'}
  };
}
export function pageOptions(aspect, layout) {
  return {target:{aspect,...layout,fps:30,totalFrames:450},seed:'film-fixture-1',
    fonts:[{fontId:'geist-sans',weight:600,style:'normal',licenseRef:'fixture-geist-ofl',rightsCleared:true}],
    resources:[{resourceId:'res_fixture_dashboard',kind:'image',width:1440,height:960,licenseRef:'fixture-original-screen',rightsCleared:true}],
    confirmedFactIds:['fixture-cta'],initTimeoutMs:30000,frameTimeoutMs:5000};
}
