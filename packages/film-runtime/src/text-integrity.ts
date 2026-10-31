// Captured before authored scenes execute. DOM text in a custom scene is
// admitted only when it is inside the exact span created for a declared slot.
export function createTextIntegrity(){
 const text=Object.getOwnPropertyDescriptor(Node.prototype,'textContent')?.get;
 const value=Object.getOwnPropertyDescriptor(Node.prototype,'nodeValue')?.get;
 const parent=Object.getOwnPropertyDescriptor(Node.prototype,'parentNode')?.get;
 const apply=Reflect.apply,contains=Node.prototype.contains,walk=document.createTreeWalker.bind(document),next=TreeWalker.prototype.nextNode;
 const get=WeakMap.prototype.get,set=WeakMap.prototype.set,push=Array.prototype.push,trim=String.prototype.trim;
 const addRoot=WeakSet.prototype.add,hasRoot=WeakSet.prototype.has,getStyle=window.getComputedStyle.bind(window),getProperty=CSSStyleDeclaration.prototype.getPropertyValue;
 if(!text||!value||!parent)throw Error('TEXT_INTEGRITY_UNAVAILABLE');
 const owners=new WeakMap<Node,{root:Element;expected:string}>(),byRoot=new WeakMap<Element,Node[]>(),roots=new WeakSet<Node>();
 return{
  registerRoot(root:Element){apply(addRoot,roots,[root]);},
  register(root:Element,element:Element,expected:string){
   apply(set,owners,[element,{root,expected}]);const slots=apply(get,byRoot,[root]) as Node[]|undefined;
   if(slots)apply(push,slots,[element]);else apply(set,byRoot,[root,[element]]);
  },
  verify(root:Element,override?:{element:Node;expected:string}){
   if(override&&!apply(contains,root,[override.element]))throw Error('CUSTOM_TEXT_MISMATCH');
   const slots=(apply(get,byRoot,[root])??[]) as Node[];
   for(let i=0;i<slots.length;i++){const element=slots[i]!,owner=apply(get,owners,[element]) as {root:Element;expected:string};
    if(apply(contains,root,[element])&&apply(text,element,[])!==(override?.element===element?override.expected:owner.expected))throw Error('CUSTOM_TEXT_MISMATCH');
   }
   const walker=walk(root,4);let node:Node|null;
   while((node=apply(next,walker,[]) as Node|null)){
    const content=apply(value,node,[]) as string|null;if(!content||!apply(trim,content,[]))continue;
    let current:Node|null=node,owner:{root:Element;expected:string}|undefined;
    while(current&&current!==root){owner=apply(get,owners,[current]) as typeof owner;if(owner)break;current=apply(parent,current,[]) as Node|null;}
    if(!owner||owner.root!==root)throw Error('CUSTOM_TEXT_UNBOUND');
   }
  },
  // A custom scene can reach ancestors through DOM aliases. Check the whole
  // body so escaped or cross-scene text cannot evade its real registered slot.
  verifyBody(body:HTMLElement,stage:Element,planElement:Element){
   const walker=walk(body,4);let node:Node|null;
   while((node=apply(next,walker,[]) as Node|null)){
    const content=apply(value,node,[]) as string|null;if(!content||!apply(trim,content,[]))continue;
    let current:Node|null=node,sceneRoot:Node|undefined,owner:{root:Element;expected:string}|undefined,insideStage=false,insidePlan=false;
    while(current&&current!==body){
     if(!owner)owner=apply(get,owners,[current]) as typeof owner;
     if(!sceneRoot&&apply(hasRoot,roots,[current]))sceneRoot=current;
     if(current===stage)insideStage=true;if(current===planElement)insidePlan=true;
     current=apply(parent,current,[]) as Node|null;
    }
    if(insidePlan&&apply(getProperty,getStyle(planElement),['display'])==='none')continue;
    if(!insideStage||!sceneRoot||!owner||owner.root!==sceneRoot)throw Error('CUSTOM_TEXT_UNBOUND');
   }
  }
 };
}
