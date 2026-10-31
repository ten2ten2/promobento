// Captured before authored scenes execute. DOM text in a custom scene is
// admitted only when it is inside the exact span created for a declared slot.
export function createTextIntegrity(){
 const text=Object.getOwnPropertyDescriptor(Node.prototype,'textContent')?.get;
 const value=Object.getOwnPropertyDescriptor(Node.prototype,'nodeValue')?.get;
 const parent=Object.getOwnPropertyDescriptor(Node.prototype,'parentNode')?.get;
 const apply=Reflect.apply,contains=Node.prototype.contains,walk=document.createTreeWalker.bind(document),next=TreeWalker.prototype.nextNode;
 const get=WeakMap.prototype.get,set=WeakMap.prototype.set,push=Array.prototype.push,trim=String.prototype.trim;
 if(!text||!value||!parent)throw Error('TEXT_INTEGRITY_UNAVAILABLE');
 const owners=new WeakMap<Node,{root:Element;expected:string}>(),byRoot=new WeakMap<Element,Node[]>();
 return{
  register(root:Element,element:Element,expected:string){
   apply(set,owners,[element,{root,expected}]);const slots=apply(get,byRoot,[root]) as Node[]|undefined;
   if(slots)apply(push,slots,[element]);else apply(set,byRoot,[root,[element]]);
  },
  verify(root:Element){
   const slots=(apply(get,byRoot,[root])??[]) as Node[];
   for(let i=0;i<slots.length;i++){const element=slots[i]!,owner=apply(get,owners,[element]) as {root:Element;expected:string};
    if(apply(contains,root,[element])&&apply(text,element,[])!==owner.expected)throw Error('CUSTOM_TEXT_MISMATCH');
   }
   const walker=walk(root,4);let node:Node|null;
   while((node=apply(next,walker,[]) as Node|null)){
    const content=apply(value,node,[]) as string|null;if(!content||!apply(trim,content,[]))continue;
    let current:Node|null=node,owner:{root:Element;expected:string}|undefined;
    while(current&&current!==root){owner=apply(get,owners,[current]) as typeof owner;if(owner)break;current=apply(parent,current,[]) as Node|null;}
    if(!owner||owner.root!==root)throw Error('CUSTOM_TEXT_UNBOUND');
   }
  }
 };
}
