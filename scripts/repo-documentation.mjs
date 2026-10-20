// Static repository checks. This does not render policies or establish publication readiness.
import {readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {isUtf8} from 'node:buffer';
import {dirname,extname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {canonical,parseCanonicalJson} from '../packages/contracts/src/canonical.mjs';

export function repositoryFiles(root) {
  return readdirSync(root,{withFileTypes:true}).flatMap(entry => {
    if (entry.isSymbolicLink() || ['.git','node_modules'].includes(entry.name)) return [];
    const path=join(root,entry.name);
    return entry.isDirectory() ? repositoryFiles(path) : [path];
  });
}

export function conflictErrors(root,files) {
  const errors=[];
  for (const path of files) {
    const bytes=readFileSync(path);
    if (bytes.includes(0) || !isUtf8(bytes)) continue;
    const lines=bytes.toString('utf8').split('\n');
    for (let i=0;i<lines.length;i++) {
      if (/^(?:<{7,}(?:\s.*)?|={7,}\s*|>{7,}(?:\s.*)?|\|{7,}(?:\s.*)?)$/.test(lines[i]))
        errors.push('Unresolved conflict marker: '+relative(root,path)+':'+(i+1));
    }
  }
  return errors;
}

function withoutFences(source) {
  let fence=null;
  return source.split('\n').map(line => {
    const block=line.replace(/^(?: {0,3}>[ \t]?)+/,'');
    const match=block.match(/^ {0,3}(\x60{3,}|~{3,})(.*)$/);
    if (fence) {
      if (match && match[1][0]===fence[0] && match[1].length>=fence.length && !match[2].trim()) fence=null;
      return '';
    }
    if (match && !(match[1][0]==='\x60' && match[2].includes('\x60'))) {
      fence=match[1]; return '';
    }
    return /^(?: {4}|\t)/.test(line) ? '' : line;
  }).join('\n').replace(/<!--[\s\S]*?-->/g,'');
}

function codeSpans(source,replace) {
  let output='',cursor=0;
  const runs=[...source.matchAll(/\x60+/g)];
  for (let i=0;i<runs.length;i++) {
    const start=runs[i];
    if (start.index<cursor) continue;
    if ((source.slice(0,start.index).match(/\\+$/)?.[0].length??0)%2) continue;
    let endIndex=i+1;
    while (endIndex<runs.length && runs[endIndex][0].length!==start[0].length) endIndex++;
    if (endIndex===runs.length) continue;
    const end=runs[endIndex];
    output+=source.slice(cursor,start.index)+replace(source.slice(start.index+start[0].length,end.index));
    cursor=end.index+end[0].length; i=endIndex;
  }
  return output+source.slice(cursor);
}

function visibleHeading(source) {
  const literals=[],literal=text=>'\ue000'+(literals.push(text)-1)+'\ue001';
  return codeSpans(source,text=>literal(text.replace(/\n/g,' ')))
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_\x60{|}~])/g,(_,character)=>literal(character))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1')
    .replace(/<[^>]*>/g,'')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity) => {
      if (entity[0]==='#') {
        const point=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
        return point>0&&point<=0x10ffff?String.fromCodePoint(point):'';
      }
      return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'}[entity.toLowerCase()];
    })
    .replace(/[*~]/g,'')
    .replace(/(^|[^\p{L}\p{N}])_{1,3}(?=\S)|(?<=\S)_{1,3}(?=$|[^\p{L}\p{N}])/gu,'$1')
    .replace(/\ue000(\d+)\ue001/g,(_,index)=>literals[Number(index)])
    .trim();
}

// GFM heading text: retain letters, combining marks, numbers, "_" and "-";
// remove punctuation/symbols, replace spaces, and disambiguate against every prior ID.
function headingId(text,used) {
  const base=text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\- ]/gu,'').replace(/ /g,'-');
  let id=base,suffix=0;
  while (used.has(id)) id=base+'-'+(++suffix);
  used.add(id); return id;
}

function yamlScalar(value) {
  const text=value.trim();
  if (text.startsWith('"')) return JSON.parse(text);
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1,-1).replace(/''/g,"'");
  return text.replace(/\s+#.*$/,'');
}

function document(source) {
  const errors=[],anchors=new Map(),nativeIds=new Set(),headings=[];
  const front=source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const body=front?source.slice(front[0].length):source;
  if (front) {
    let inAnchors=false,seen=false;
    for (const line of front[1].split('\n')) {
      if (/^anchors:/.test(line)) {
        if (seen) errors.push('Duplicate frontmatter anchors mapping');
        seen=true; inAnchors=true;
        if (!/^anchors:\s*(?:#.*)?$/.test(line)) errors.push('anchors must be an ID-to-H2 mapping');
      } else if (inAnchors && /^\S/.test(line)) inAnchors=false;
      else if (inAnchors && line.trim() && !/^\s*#/.test(line)) {
        const item=line.match(/^  ([a-z][a-z0-9-]*):\s+(.+?)\s*$/);
        if (!item) { errors.push('Invalid frontmatter anchor entry'); continue; }
        if (anchors.has(item[1])) errors.push('Duplicate frontmatter anchor: '+item[1]);
        try {
          const title=yamlScalar(item[2]);
          if (typeof title!=='string' || !title) throw Error();
          anchors.set(item[1],title);
        } catch { errors.push('Invalid H2 text for anchor: '+item[1]); }
      }
    }
  }
  const blocks=withoutFences(body).split('\n');
  for (let i=0;i<blocks.length;i++) {
    const atx=blocks[i].match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/);
    const setext=i+1<blocks.length && blocks[i].trim() && blocks[i+1].match(/^ {0,3}(=+|-+)\s*$/);
    if (!atx&&!setext) continue;
    const level=atx?atx[1].length:setext[1][0]==='='?1:2;
    const raw=atx?(atx[2]??'').replace(/[ \t]+#+[ \t]*$/,''):blocks[i].trim();
    const title=visibleHeading(raw),id=headingId(title,nativeIds);
    headings.push({level,title,id});
    if (!atx) i++;
  }
  const registeredHeadings=new Set();
  for (const [id,title] of anchors) {
    const matches=headings.filter(h=>h.level===2&&h.title===title);
    if (matches.length!==1)
      errors.push('Anchor '+id+' must identify exactly one H2: '+title);
    if (registeredHeadings.has(title)) errors.push('Multiple anchor IDs registered for H2: '+title);
    if (nativeIds.has(id)&&matches[0]?.id!==id) errors.push('Registered anchor collides with another heading: '+id);
    registeredHeadings.add(title);
  }
  return {source,body,headings,nativeIds,anchors,errors};
}

function linkTargets(source) {
  const plain=codeSpans(withoutFences(source),()=>''),references=new Map(),targets=[];
  const labelKey=label=>label.trim().replace(/\s+/g,' ').toLowerCase();
  const body=plain.replace(/^ {0,3}\[([^\]\n]+)\]:[ \t]*(<[^>\n]*>|[^\s]+)(?:[ \t]+.*)?$/gm,(_,label,target) => {
    references.set(labelKey(label),target.replace(/^<|>$/g,'')); return '';
  });
  for (let i=0;i<body.length;i++) {
    if (body[i]!=='[' || (body.slice(0,i).match(/\\+$/)?.[0].length??0)%2) continue;
    let end=i+1,depth=1;
    for (;end<body.length&&depth;end++) {
      if (body[end]==='\\') end++;
      else if (body[end]==='[') depth++;
      else if (body[end]===']') depth--;
    }
    if (depth) continue;
    const label=body.slice(i+1,end-1);
    if (body[end]==='(') {
      let start=end+1;
      while (/[ \t\n]/.test(body[start]??'')&&start<body.length) start++;
      let cursor=start,nested=0;
      if (body[start]==='<') {
        cursor=body.indexOf('>',start+1);
        if (cursor<0) continue;
        targets.push(body.slice(start+1,cursor)); i=cursor; continue;
      }
      for (;cursor<body.length;cursor++) {
        if (body[cursor]==='\\') { cursor++; continue; }
        if (body.slice(cursor,cursor+2)==='{{') {
          const close=body.indexOf('}}',cursor+2);
          if (close>=0) { cursor=close+1; continue; }
        }
        if (body[cursor]==='(') nested++;
        else if (body[cursor]===')') { if (!nested) break; nested--; }
        else if (/\s/.test(body[cursor])&&!nested) break;
      }
      if (cursor>start) targets.push(body.slice(start,cursor).replace(/\\([\\() ])/g,'$1'));
      i=cursor;
    } else {
      const reference=body[end]==='['?body.slice(end+1,body.indexOf(']',end+1)):label;
      const target=references.get(labelKey(reference||label));
      if (target) targets.push(target);
      i=end-1;
    }
  }
  return targets;
}

function contextFields(value,prefix='',out=new Map()) {
  for (const [key,item] of Object.entries(value)) {
    if (!prefix&&key==='_meta') continue;
    const path=prefix?prefix+'.'+key:key;
    if (item!==null&&typeof item==='object'&&!Array.isArray(item)) contextFields(item,path,out);
    else if (item===null||['string','number','boolean'].includes(typeof item)) out.set(path,item);
  }
  return out;
}

export function checkDocumentation(root,files,{publicContext={},routes=[]}={}) {
  const errors=[],documents=new Map(),routeDocuments=new Map(),fields=contextFields(publicContext);
  const pageRoutes=new Set(routes.filter(r=>r.method==='GET'&&r.kind==='page').map(r=>r.path));
  for (const file of files.filter(path=>extname(path).toLowerCase()==='.md')) {
    const parsed=document(readFileSync(file,'utf8')),name=relative(root,file).split(sep).join('/');
    documents.set(file,parsed);
    errors.push(...parsed.errors.map(error=>name+': '+error));
    if (name.startsWith('content/pages/')) {
      for (const variable of parsed.source.matchAll(/\{\{([^{}]*)\}\}/g))
        if (!fields.has(variable[1].trim())) errors.push(name+': Unknown template variable '+variable[0]);
      const page=name.match(/^content\/pages\/([^/]+)\/([^/]+)\.md$/);
      if (page&&page[2]!=='README') routeDocuments.set((page[1]==='en'?'':'/'+page[1])+'/'+page[2],parsed);
    }
  }
  for (const [name,value] of fields) {
    if (!name.startsWith('links.') || value===null) continue;
    if (typeof value!=='string' || !pageRoutes.has(value.split(/[?#]/)[0]))
      errors.push('Unregistered public-context route: '+name+' = '+String(value));
  }
  let count=0;
  for (const [file,parsed] of documents) for (const original of linkTargets(parsed.body)) {
    count++;
    let unresolved=false;
    const target=original.replace(/\{\{([^{}]*)\}\}/g,(_,key) => {
      const name=key.trim();
      if (!fields.has(name)) errors.push(relative(root,file)+': Unknown link variable '+name);
      const value=fields.get(name);
      if (value===undefined||value===null) { unresolved=true; return ''; }
      return String(value);
    });
    if (unresolved) continue; // Null is an allowed draft value, not permission to publish.
    const label=relative(root,file)+' -> '+original;
    if (/^(sandbox|file):/i.test(target)) errors.push('Non-portable link: '+label);
    if (/^[a-z][\w+.-]*:/i.test(target)||target.startsWith('//')) continue;
    const hash=target.indexOf('#'),pathAndQuery=hash<0?target:target.slice(0,hash);
    let path,fragment;
    try {
      path=decodeURIComponent(pathAndQuery.split('?')[0]);
      fragment=hash<0?'':decodeURIComponent(target.slice(hash+1));
    } catch { errors.push('Invalid link encoding: '+label); continue; }
    if (path.startsWith('/')&&pageRoutes.has(path)) {
      const page=routeDocuments.get(path);
      if (fragment&&page&&!page.anchors.has(fragment)&&!page.nativeIds.has(fragment))
        errors.push('Missing page anchor: '+label);
      continue;
    }
    const destination=path?resolve(path.startsWith('/')?root:dirname(file),path.replace(/^\/+/,'')):file;
    const rel=relative(root,destination);
    if (isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)) { errors.push('Link escapes repository: '+label); continue; }
    if (!existsSync(destination)) { errors.push('Missing link: '+label); continue; }
    if (fragment&&extname(destination).toLowerCase()==='.md'&&statSync(destination).isFile()) {
      const destinationDoc=documents.get(destination)??document(readFileSync(destination,'utf8'));
      // Frontmatter aliases are for the future page renderer, never native .md anchors.
      if (!destinationDoc.nativeIds.has(fragment)) errors.push('Missing Markdown anchor: '+label);
    }
  }
  return {errors,documents:documents.size,links:count};
}

const executionFields=['productLimits','encodingProfiles','aspectLayouts','presets','renderProfiles','defaultRenderProfile'];
export function platformExecutionProjection(config) {
  const projection={};
  for (const key of executionFields) if (Object.hasOwn(config,key)) projection[key]=config[key];
  if (Array.isArray(config.presets)) projection.presets=config.presets.map(preset => {
    const result={};
    for (const key of ['id','version','defaultAspect','optionalAspects','encodingProfile'])
      if (Object.hasOwn(preset,key)) result[key]=preset[key];
    return result;
  }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return projection;
}

export function platformRuleErrors(previous,current) {
  if (typeof current.rulesVersion!=='string'||!current.rulesVersion.trim()) return ['Missing platform rulesVersion'];
  if (current.rulesVersion!==previous.rulesVersion) return [];
  const before=platformExecutionProjection(previous),after=platformExecutionProjection(current);
  const changed=executionFields.filter(key=>canonical(Object.hasOwn(before,key)?{value:before[key]}:{})!==canonical(Object.hasOwn(after,key)?{value:after[key]}:{}));
  return changed.length?['Platform execution rules changed without a rulesVersion bump ('+current.rulesVersion+'): '+changed.join(', ')]:[];
}

export function platformBaseline(root,env=process.env) {
  const git=args=>spawnSync('git',args,{cwd:root,encoding:'utf8'});
  const explicit=env.PROMOBENTO_BASE_REF?.trim();
  if (explicit&&/^0{40,64}$/.test(explicit)) return {reference:explicit,config:null,reason:'initial push'};
  const ci=env.CI==='true'||env.CI==='1'||env.GITHUB_ACTIONS==='true';
  if (ci&&!explicit) throw Error('CI requires PROMOBENTO_BASE_REF (PR base SHA or push before SHA)');
  let reference=explicit;
  if (!reference) {
    const status=git(['status','--porcelain','--untracked-files=normal']);
    if (status.status!==0) throw Error('Cannot read Git status for platform rules baseline');
    reference=status.stdout.trim()?'HEAD':'HEAD^';
  }
  const revision=git(['rev-parse','--verify','--end-of-options',reference+'^{commit}']);
  if (revision.status!==0) {
    const history=!explicit&&!ci&&reference==='HEAD^'?git(['rev-list','--max-count=2','HEAD']):null;
    if (history?.status===0&&history.stdout.trim().split('\n').length===1)
      return {reference,config:null,reason:'initial local commit'};
    throw Error('Cannot read Git baseline '+reference+'; fetch the base commit before checking platform rules');
  }
  const commit=revision.stdout.trim(),source=git(['show',commit+':config/platform-presets.json']);
  if (source.status!==0) throw Error('Cannot read config/platform-presets.json at Git baseline '+reference);
  return {reference,commit,config:parseCanonicalJson(source.stdout)};
}
