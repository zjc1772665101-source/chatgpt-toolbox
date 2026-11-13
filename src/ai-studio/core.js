// ==UserScript==
// @name         Google AI Studio 工具箱 · 阅读与液态玻璃
// @namespace    http://tampermonkey.net/
// @version      4.0.0
// @description  AI Studio 完整工具箱：可拖动和缩放的浮窗、独立设置入口、阅读排版、液态玻璃、GPU 海洋、提示词、附件队列与会话导出。
// @match        https://aistudio.google.com/*
// @match        https://ai.dev/*
// @noframes
// @grant        unsafeWindow
// @run-at       document-idle
// @license      GPL-3.0-or-later
// ==/UserScript==
/* SPDX-License-Identifier: GPL-3.0-or-later
 * Inspired by and incorporates components from the user-provided ChatGPT toolbox.
 * Liquid-glass attribution and the ASCII ocean provenance are retained below.
 */
(function aiStudioUnifiedToolbox(){
'use strict';

const VERSION='4.0.0';
if(window.self!==window.top)return;
const INSTANCE='__aiStudioUnifiedToolboxV3';
try{globalThis[INSTANCE]?.destroy?.();}catch(error){console.warn('[AI Studio toolbox] previous instance cleanup',error);}
const KEY=Object.freeze({settings:'ai-studio-toolbox-settings-v3',prompts:'ai-studio-toolbox-prompts-v3',queue:'ai-studio-toolbox-queue-v3',ui:'ai-studio-toolbox-ui-v3'});
const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const normalized=value=>String(value??'').replace(/\r\n?/g,'\n').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
const uid=()=>`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
function readJSON(key,fallback){try{const raw=localStorage.getItem(key);return raw===null?fallback:JSON.parse(raw);}catch(_){return fallback;}}
function writeJSON(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(error){console.warn('[AI Studio toolbox] storage',error);document.dispatchEvent(new CustomEvent('ast-storage-error',{detail:{key}}));return false;}}
function text(tag,content,className){const node=document.createElement(tag);if(content!==undefined)node.textContent=content;if(className)node.className=className;return node;}
function button(label,title,action){const node=text('button',label);node.type='button';if(title){node.title=title;node.setAttribute('aria-label',title);}if(action)node.addEventListener('click',action);return node;}
function cssFont(value,fallback){const v=String(value??'').trim();return v && !/[{};<>\n\r]/.test(v)?v:fallback;}
function color(value,fallback){return /^#[0-9a-f]{6}$/i.test(String(value))?String(value):fallback;}
function imageURL(value){try{const raw=String(value||'').trim();if(!raw)return '';if(/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(raw)&&raw.length<2800000)return raw;const url=new URL(raw);return /^https?:$/.test(url.protocol)?url.href:'';}catch(_){return '';}}

// Curated, actually effective preferences from the supplied GPT reference.
const SCHEMA={
 pageBackground:{type:'boolean',default:false,label:'自定义整页背景'},
 backgroundColor:{type:'color',default:'#11151b',label:'整页背景色'},
 backgroundImage:{type:'url',default:'',label:'背景图片 URL（https 或图片 data URL）'},
 backgroundShade:{type:'number',default:.2,min:0,max:.9,step:.05,label:'背景遮罩浓度'},
 panelBackground:{type:'boolean',default:false,label:'自定义原站面板背景'},
 panelColor:{type:'color',default:'#202833',label:'原站面板背景色'},
 panelOpacity:{type:'number',default:.7,min:0,max:1,step:.05,label:'原站面板背景浓度'},
 customAccent:{type:'boolean',default:false,label:'自定义主题强调色'},
 accentColor:{type:'color',default:'#a3c5ff',label:'主题强调色'},
 contentWidth:{type:'number',default:100,min:40,max:100,step:1,label:'对话内容宽度 %',override:true,overrideDefault:false},
 latinFont:{type:'text',default:'Lora',label:'英文字体',override:true},
 chineseFont:{type:'text',default:'FZNewShuSong-Z10S',label:'中文字体',override:true},
 boldLatinFont:{type:'text',default:'Lora',label:'英文加粗字体',override:true},
 boldChineseFont:{type:'text',default:'"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif',label:'中文加粗字体',override:true},
 fontSize:{type:'number',default:25,min:10,max:64,step:1,label:'正文字号 px',override:true},
 lineHeight:{type:'number',default:1.9,min:1,max:2.8,step:.05,label:'正文行高',override:true},
 codeFont:{type:'text',default:'"JetBrains Mono"',label:'代码字体',override:true},
 codeFontSize:{type:'number',default:18,min:10,max:40,step:1,label:'代码字号 px',override:true},
 codeLineHeight:{type:'number',default:1.8,min:1,max:2.8,step:.05,label:'代码行高',override:true},
 mathFont:{type:'text',default:'Latin Modern Math',label:'原生公式字体',override:true,overrideDefault:false},
 formulaFontSize:{type:'number',default:25,min:10,max:64,step:1,label:'公式字号 px',override:true},
 normalColor:{type:'color',default:'#ffffff',label:'正文颜色',override:true},
 boldColor:{type:'color',default:'#e8e2d8',label:'加粗文字颜色',override:true},
 boldWeight:{type:'number',default:750,min:400,max:1000,step:50,label:'加粗字重',override:true},
 nativeLightBodyColors:{type:'boolean',default:true,label:'浅色主题下默认文字颜色跟随网页'},
 fontSmoothing:{type:'boolean',default:true,label:'字体平滑与阅读优化'},
 wrapCode:{type:'boolean',default:true,label:'代码自动换行'},
 stopAutoScroll:{type:'boolean',default:true,label:'生成时保持当前阅读位置'},
 formulaCopy:{type:'boolean',default:true,label:'双击公式复制 LaTeX'},
 formulaDelimiters:{type:'boolean',default:true,label:'复制公式时保留定界符'},
 showNav:{type:'boolean',default:true,label:'显示问答与章节目录'},
 showTokenStats:{type:'boolean',default:false,label:'显示 Token 估算'},
 showMessageCopy:{type:'boolean',default:true,label:'回答显示复制 Markdown 按钮'},
 toolboxFont:{type:'text',default:'FZNewShuSong-Z10S',label:'工具箱字体'},
 toolboxFontSize:{type:'number',default:13,min:9,max:24,step:1,label:'工具箱字号 px'},
 toolboxWidth:{type:'number',default:300,min:200,max:560,step:10,label:'工具箱宽度 px'},
 composerGlass:{type:'boolean',default:true,label:'输入框玻璃'},
 toolboxGlass:{type:'boolean',default:true,label:'导航面板玻璃'},
 settingsGlass:{type:'boolean',default:true,label:'设置面板玻璃'},
 queueGlass:{type:'boolean',default:true,label:'队列面板玻璃'},
 sendGlass:{type:'boolean',default:true,label:'运行按钮玻璃'},
 messageGlass:{type:'boolean',default:true,label:'回答正文玻璃'},
 composerBlur:{type:'number',default:1,min:0,max:20,step:.5,label:'输入框模糊 px'},
 toolboxBlur:{type:'number',default:2,min:0,max:20,step:.5,label:'导航面板模糊 px'},
 settingsBlur:{type:'number',default:2,min:0,max:20,step:.5,label:'设置面板模糊 px'},
 queueBlur:{type:'number',default:1,min:0,max:20,step:.5,label:'队列面板模糊 px'},
 sendBlur:{type:'number',default:0,min:0,max:20,step:.5,label:'运行按钮模糊 px'},
 messageBlur:{type:'number',default:1,min:0,max:20,step:.5,label:'回答正文模糊 px'},
 glassOpacity:{type:'number',default:.12,min:0,max:.85,step:.01,label:'玻璃底色浓度'},
 glassStrength:{type:'number',default:36,min:0,max:60,step:1,label:'折射强度'},
 glassGlare:{type:'number',default:.45,min:0,max:1.6,step:.05,label:'玻璃边缘高光'},
 glassChroma:{type:'number',default:.04,min:0,max:.6,step:.01,label:'RGB 色散'},
 glassMode:{type:'select',default:'full',choices:['full','balanced','frosted'],label:'玻璃渲染模式'},
 ocean:{type:'boolean',default:true,label:'启用 ASCII 鲨鱼海洋'},
 oceanOpacity:{type:'number',default:.65,min:.15,max:.9,step:.05,label:'海洋不透明度'},
 oceanFps:{type:'number',default:12,min:3,max:30,step:1,label:'帧率上限'},
 oceanDensity:{type:'number',default:90,min:40,max:160,step:10,label:'鱼群数量'},
 oceanSpecies:{type:'select',default:'mixed',choices:['classic','mixed','hammerhead','tiger','zebra','greathammer','mako','thresher','nurse'],label:'鲨鱼种类'},
 oceanCoverage:{type:'select',default:'glass',choices:['glass','gutter','full','off'],label:'对话页动画范围'},
 oceanHome:{type:'select',default:'full',choices:['full','off'],label:'主页动画范围'},
 oceanQuality:{type:'select',default:'eco',choices:['eco','balanced','fine'],label:'画质与负载'},
 oceanRenderer:{type:'select',default:'compute',choices:['canvas','gpu','compute'],label:'绘制方式'},
 oceanMotion:{type:'select',default:'replay30',choices:['live','replay15','replay30'],label:'运动模式'},
 oceanPauseBusy:{type:'boolean',default:false,label:'生成回答时暂停动画'},
 oceanPointer:{type:'boolean',default:false,label:'鼠标扰动'},
};
// Each surface retains its own optical profile, as in the reference toolbox.
const GLASS_SURFACES=[
 {id:'composer',kind:'composer',label:'输入框',blur:1},
 {id:'toolbox',kind:'toolbox',label:'导航面板',blur:2},
 {id:'settings',kind:'settings',label:'设置面板',blur:2},
 {id:'queue',kind:'queue',label:'队列面板',blur:1},
 {id:'send',kind:'send',label:'运行按钮',blur:0},
 {id:'message',kind:'message',label:'回答正文',blur:1},
 {id:'scroll',kind:'scroll',label:'滚动按钮',blur:.5},
 {id:'token',kind:'stats',label:'Token 贴片',blur:1},
 {id:'toggle',kind:'toggle',label:'工具箱入口',blur:1},
];
for(const surface of GLASS_SURFACES){
 const {id,label,blur}=surface;
 SCHEMA[id+'Glass']??={type:'boolean',default:true,label:`启用${label}玻璃`};
 SCHEMA[id+'Blur']??={type:'number',default:blur,min:0,max:20,step:.5,label:'模糊 px'};
 SCHEMA[id+'Mode']={type:'select',default:'full',choices:['full','balanced','frosted'],label:'渲染模式'};
 for(const [suffix,def,min,max,step,caption] of [['Opacity',.12,0,.85,.01,'底色浓度'],['Strength',36,0,60,1,'折射强度'],['Thickness',14,4,48,1,'边缘厚度'],['Glare',.45,0,1.6,.05,'边缘高光'],['Chroma',.04,0,.6,.01,'RGB 色散'],['Curvature',.5,0,1,.05,'曲率'],['Bend',.5,0,1,.05,'弯折']])SCHEMA[id+suffix]={type:'number',default:suffix==='Opacity'?({settings:.72,toolbox:.5,queue:.5,token:.5,toggle:.5}[id]??def):def,min,max,step,label:caption};
}
for(const key of ['glassOpacity','glassStrength','glassGlare','glassChroma','glassMode'])delete SCHEMA[key];
const DEFAULTS={};
for(const [key,spec] of Object.entries(SCHEMA)){DEFAULTS[key]=spec.default;if(spec.override)DEFAULTS[key+'Enabled']=spec.overrideDefault!==false;}
function normalizeSettings(input){
 const result={...DEFAULTS};if(!input||typeof input!=='object'||Array.isArray(input))return result;
 for(const [key,spec] of Object.entries(SCHEMA)){
  if(own(input,key)){
   const value=input[key];
   if(spec.type==='boolean')result[key]=typeof value==='boolean'?value:spec.default;
   else if(spec.type==='number'){const n=Number(value);result[key]=Number.isFinite(n)?clamp(n,spec.min,spec.max):spec.default;}
   else if(spec.type==='select')result[key]=spec.choices.includes(value)?value:spec.default;
   else if(spec.type==='color')result[key]=color(value,spec.default);
   else if(spec.type==='url')result[key]=imageURL(value);
   else result[key]=cssFont(value,spec.default);
  }
  if(spec.override&&typeof input[key+'Enabled']==='boolean')result[key+'Enabled']=input[key+'Enabled'];
 }
 return result;
}
let settings=normalizeSettings(readJSON(KEY.settings,{}));
let saveTimer=0;
function saveSettings(){clearTimeout(saveTimer);saveTimer=0;const saved=writeJSON(KEY.settings,settings);document.dispatchEvent(new CustomEvent('ast-settings-saved',{detail:{saved}}));return saved;}
let applySettingsFrame=0;
function updateSettings(patch){settings=normalizeSettings({...settings,...patch});clearTimeout(saveTimer);saveTimer=setTimeout(saveSettings,180);if(!applySettingsFrame)applySettingsFrame=requestAnimationFrame(()=>{applySettingsFrame=0;applySettings();scheduleRefresh();});}

const dom={
 main(){return document.querySelector('ms-chunk-editor')||document.querySelector('[role="main"]')||document.querySelector('main');},
 editor(){return document.querySelector('ms-prompt-box textarea, footer textarea[aria-label], footer textarea, [contenteditable="true"][role="textbox"]');},
 shell(){const editor=this.editor();return editor?.closest('.prompt-box-container, ms-prompt-box, form')||editor?.parentElement||null;},
 runButton(){const shell=this.editor()?.closest('footer')||this.shell();return shell?.querySelector('ms-run-button button,button.run-button,button[aria-label*="Run"],button[aria-label*="Send"],button[aria-label*="运行"],button[aria-label*="发送"]')||null;},
 turns(){return [...document.querySelectorAll('ms-chat-turn')].filter(node=>!node.closest('#ast-toolbox-host'));},
 role(turn){
  const tagged=turn.matches('[data-turn-role]')?turn:turn.querySelector('[data-turn-role]');
  const label=String(tagged?.getAttribute('data-turn-role')||'').toLowerCase();
  if(label==='user'||label==='human')return 'user';
  if(label==='model'||label==='assistant')return 'assistant';
  if(turn.matches('.user')||turn.querySelector('.chat-turn-container.user,.user-prompt-container'))return 'user';
  if(turn.matches('.model')||turn.querySelector('.chat-turn-container.model,.model-prompt-container'))return 'assistant';
  return '';
 },
 contents(turn){
  let list=[...turn.querySelectorAll('ms-text-chunk ms-cmark-node, ms-text-chunk .very-large-text-container')].filter(n=>!n.closest('ms-thought-chunk'));
  if(!list.length)list=[...turn.querySelectorAll('ms-cmark-node,.very-large-text-container')].filter(n=>!n.closest('ms-thought-chunk'));
  if(!list.length){const root=turn.querySelector('.turn-content');if(root)list=[root];}
  return list.filter(n=>!list.some(other=>other!==n&&other.contains(n)));
 },
 isBusy(){
  const area=this.editor()?.closest('footer')||this.shell();if(!area)return false;
  return [...area.querySelectorAll('ms-run-button button, button[aria-label],button[title]')].some(b=>{
   const label=[b.getAttribute('aria-label'),b.getAttribute('title'),b.textContent].filter(Boolean).join(' ').trim();
   return /\b(stop|cancel generation|stop generating|stop response)\b|停止生成|停止回答|中止生成/i.test(label)&&b.getClientRects().length>0;
  });
 }
};
// One structural index; streaming text invalidates only its owning turn.
const pageIndex=(()=>{
 const rawTurns=dom.turns.bind(dom),rawContents=dom.contents.bind(dom),rawEditor=dom.editor.bind(dom),rawMain=dom.main.bind(dom);
 let turns=null,all=null,editor=null,main=null,revision=0;const content=new WeakMap(),sources=new WeakMap();
 const stats={turnScans:0,contentScans:0,textReads:0,layoutPasses:0,refreshes:0,mutationBatches:0};
 dom.turns=()=>{if(!turns){stats.turnScans++;turns=rawTurns();}return turns;};
 dom.contents=turn=>{if(!content.has(turn)){stats.contentScans++;content.set(turn,rawContents(turn));}return content.get(turn);};
 dom.editor=()=>editor?.isConnected?editor:(editor=rawEditor());
 dom.main=()=>main?.isConnected?main:(main=rawMain());
 function invalidate(turn,structure=false){revision++;all=null;if(turn){content.delete(turn);sources.delete(turn);}if(structure){turns=null;editor=main=null;}}
 function getMessages(){return all||(all=dom.turns().map((turn,index)=>({turn,index,role:dom.role(turn),roots:dom.contents(turn)})).filter(m=>m.role&&m.roots.length));}
 function source(message){if(!sources.has(message.turn)){stats.textReads++;sources.set(message.turn,normalized(message.roots.map(cleanReadingText).join('\n')));}return sources.get(message.turn);}
 return {invalidate,getMessages,source,stats,get revision(){return revision;}};
})();
function setEditorValue(value){
 const editor=dom.editor();if(!editor)return false;
 if(editor instanceof HTMLTextAreaElement||editor instanceof HTMLInputElement){
  const proto=editor instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(setter)setter.call(editor,value);else editor.value=value;
  editor.dispatchEvent(new Event('input',{bubbles:true,composed:true}));editor.dispatchEvent(new Event('change',{bubbles:true}));
 }else{editor.focus();editor.textContent=value;editor.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:value}));}
 editor.focus();return true;
}
function countTokens(value){
 const input=String(value||''),cjk=(input.match(/[\u2e80-\u9fff\uf900-\ufaff]/g)||[]).length;
 const rest=input.replace(/[\u2e80-\u9fff\uf900-\ufaff]/g,'');
 return Math.max(0,Math.ceil(cjk*1.25+(rest.match(/[A-Za-z0-9]+|[^\sA-Za-z0-9]/g)||[]).reduce((n,p)=>n+(p.length>4?Math.ceil(p.length/4):1),0)));
}
function escapeMarkdown(value){return String(value??'').replace(/([\\`*_{}\[\]<>])/g,'\\$1');}
function safeExportDestination(value,image=false){
 try{const raw=String(value||'').trim();if(!raw)return '';const url=new URL(raw,document.baseURI);const allowed=image?['https:','http:','blob:']:['https:','http:','mailto:','tel:'];if(image&&/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(raw))return raw;if(!allowed.includes(url.protocol))return '';return url.href.replace(/[()<>\s]/g,character=>encodeURIComponent(character));}catch(_){return '';}
}
function toMarkdown(node,depth=0){
 if(node.nodeType===Node.TEXT_NODE)return node.nodeValue||'';
 if(!(node instanceof Element)||node.matches('button,script,style,svg,[aria-hidden="true"],[role="button"],ms-thought-chunk,.ast-copy-button,[data-ast-owned]'))return '';
 const tag=node.tagName.toLowerCase(),children=()=>[...node.childNodes].map(n=>toMarkdown(n,depth)).join(''),body=()=>normalized(children());
 if(node.matches('.katex,math,[data-latex],mjx-container')){
  const latex=node.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()||node.getAttribute('data-latex')||node.getAttribute('data-math-source');
  if(latex){const block=node.matches('.katex-display,math[display="block"],mjx-container[display="true"],[data-display="true"]')||!!node.closest('.katex-display');return block?`\n$$\n${latex}\n$$\n\n`:`$${latex}$`;}
 }
 if(/^h[1-6]$/.test(tag))return `${'#'.repeat(Number(tag[1]))} ${body()}\n\n`;
 if(tag==='br')return '\n';if(tag==='hr')return '\n---\n\n';
 if(tag==='img'){const src=safeExportDestination(node.getAttribute('src'),true);return src?`![${escapeMarkdown(node.getAttribute('alt')||'图片')}](${src})`:'';}
 if(tag==='strong'||tag==='b')return `**${body()}**`;if(tag==='em'||tag==='i')return `*${body()}*`;
 if(tag==='pre'){
  const code=node.querySelector('code'),value=code?.textContent??node.textContent??'',lang=String(code?.className||'').match(/language-([\w+-]+)/)?.[1]||'';
  const runs=value.match(/`+/g)||[],fence='`'.repeat(Math.max(2,...runs.map(x=>x.length))+1);return `\n${fence}${lang}\n${value.replace(/\n+$/,'')}\n${fence}\n\n`;
 }
 if(tag==='code'){const value=node.textContent||'',runs=value.match(/`+/g)||[],fence='`'.repeat(Math.max(0,...runs.map(x=>x.length))+1),padding=/^`|`$|^\s|\s$/.test(value)&&!/^\s+$/.test(value)?' ':'';return `${fence}${padding}${value}${padding}${fence}`;}
 if(tag==='a'){const href=safeExportDestination(node.getAttribute('href'));return href?`[${body()||href}](${href})`:body();}
 if(tag==='blockquote')return children().trim().split('\n').map(x=>'> '+x).join('\n')+'\n\n';
 if(tag==='li'){
  const parent=node.parentElement,items=[...parent?.children||[]].filter(child=>child.tagName==='LI'),start=Number(parent?.getAttribute('start'))||1,index=items.indexOf(node),marker=parent?.tagName==='OL'?`${Number(node.getAttribute('value'))||start+index}.`:'-',continuation=' '.repeat(marker.length+1);
  const lines=children().trim().split('\n');return marker+' '+(lines.shift()||'')+lines.map(line=>'\n'+continuation+line).join('');
 }
 if(tag==='ul'||tag==='ol')return '\n'+[...node.children].filter(child=>child.tagName==='LI').map(child=>toMarkdown(child,0)).join('\n')+'\n\n';
 if(tag==='table'){
  const rows=[...node.querySelectorAll('tr')].map(r=>[...r.querySelectorAll(':scope > th,:scope > td')].map(c=>normalized(toMarkdown(c,depth)).replace(/\|/g,'\\|').replace(/\n+/g,'<br>'))).filter(r=>r.length);
  if(!rows.length)return '';const width=Math.max(...rows.map(r=>r.length)),line=r=>'| '+[...r,...Array(width-r.length).fill('')].join(' | ')+' |';
  return [line(rows[0]),line(Array(width).fill('---')),...rows.slice(1).map(line)].join('\n')+'\n\n';
 }
 const result=children();return /^(p|div|section|article)$/.test(tag)&&result.trim()?result.trim()+'\n\n':result;
}
function messages(){return pageIndex.getMessages();}
function messageMarkdown(message){return message.roots.map(node=>toMarkdown(node)).join('\n\n').replace(/\r\n?/g,'\n').trim();}
function conversationMarkdown(){return messages().map(m=>`## ${m.role==='user'?'用户':'Gemini'}\n\n${messageMarkdown(m)}`).filter(Boolean).join('\n\n---\n\n');}
async function copyText(value){try{await navigator.clipboard.writeText(value);return true;}catch(_){const area=document.createElement('textarea');area.value=value;area.style.cssText='position:fixed;left:-9999px;top:0';document.body.appendChild(area);area.select();let ok=false;try{ok=document.execCommand('copy');}catch(_){}area.remove();return ok;}}
function download(name,contents,type){const link=document.createElement('a'),url=URL.createObjectURL(new Blob([contents],{type}));link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}


// Trusted Types policy is restricted to the exact Blob URL just created by this script.
let workerPolicy=null,permittedWorkerURL='';
function trustedWorkerURL(url){
 const factory=globalThis.trustedTypes;if(!factory)return url;
 if(!workerPolicy)workerPolicy=factory.createPolicy('ai-studio-toolbox-worker-'+uid(),{createScriptURL:value=>{if(value!==permittedWorkerURL)throw new TypeError('Unexpected worker URL');return value;}});
 permittedWorkerURL=url;
 try{return workerPolicy.createScriptURL(url);}finally{permittedWorkerURL='';}
}
// Shared page scheduler used by the reference glass controller.
const runtime={pageWork:(()=>{
 let frame=0,sequence=0,rects=null,resize=null;const jobs=new Map(),sizes=new Map();
 function flush(time){frame=0;const batch=[...jobs];const writes=[];rects=new WeakMap();
  for(const [id,job] of batch){if(!jobs.delete(id))continue;try{const write=job.callback(time);if(job.layout&&typeof write==='function')writes.push(write);}catch(error){console.warn('[AI Studio layout]',error);}}
  rects=null;for(const write of writes)try{write();}catch(error){console.warn('[AI Studio layout]',error);}
 }
 function request(callback,layout){const id=++sequence;jobs.set(id,{callback,layout});if(!frame)frame=requestAnimationFrame(flush);return id;}
 return {
  requestFrame:callback=>request(callback,false),requestLayout:callback=>request(callback,true),
  cancelFrame(id){jobs.delete(id);if(!jobs.size&&frame){cancelAnimationFrame(frame);frame=0;}},
  rect(element){if(!rects)return element.getBoundingClientRect();if(!rects.has(element))rects.set(element,element.getBoundingClientRect());return rects.get(element);},
  observeSize(element,callback){if(typeof ResizeObserver!=='function')return{disconnect(){}};
   if(!resize)resize=new ResizeObserver(entries=>{for(const entry of entries)for(const cb of [...(sizes.get(entry.target)||[])])cb(entry);});
   if(!sizes.has(element)){sizes.set(element,new Set());resize.observe(element);}const clients=sizes.get(element);clients.add(callback);
   return {disconnect(){clients.delete(callback);if(!clients.size){resize?.unobserve(element);sizes.delete(element);}}};
  },
  destroy(){if(frame)cancelAnimationFrame(frame);frame=0;jobs.clear();resize?.disconnect();sizes.clear();}
 };
})()};


  // Native DOM backdrop refraction. Canvas generates only a small displacement
  // texture on resize/settings changes; it never snapshots the conversation.
  // Keep this controller on the existing composer discovery lifecycle, so there
  // is no extra document observer or permanent animation/render loop.
  /* Material layering and bezel optics adapted from:
   * https://github.com/sohumsuthar/liquid-glass (lib/glass-optics.mjs, core CSS)
   * MIT License — Copyright (c) 2026 Sohum Suthar
   * Layered backdrop/content approach also reviewed against:
   * https://github.com/nkzw-tech/liquid-glass (fork of rdev/liquid-glass-react).
   * No React runtime is injected into the host editor.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   * The above copyright notice and this permission notice shall be included in all
   * copies or substantial portions of the Software.
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   * SOFTWARE.
   */
  const GLASS_STYLE = `
    html {
      --cgfc-glass-tint: 245,248,252;
      --cgfc-glass-fill: var(--cgfc-glass-opacity, .12);
      --cgfc-glass-luminance: 1;
      --cgfc-glass-saturation: 1.12;
      --cgfc-glass-shadow: .12;
    }
    html[data-cgfc-glass-style="clear"] {
      --cgfc-glass-fill: var(--cgfc-glass-opacity, .12);
      --cgfc-glass-saturation: 1.08;
    }
    html.dark:not([data-cgfc-theme="light"]), html[data-cgfc-theme="dark"] {
      --cgfc-glass-tint: 16,18,22;
      --cgfc-glass-fill: var(--cgfc-glass-opacity, .12);
      --cgfc-glass-luminance: .96;
      --cgfc-glass-saturation: 1.12;
      --cgfc-glass-shadow: .26;
    }
    html.dark[data-cgfc-glass-style="clear"]:not([data-cgfc-theme="light"]),
    html[data-cgfc-theme="dark"][data-cgfc-glass-style="clear"] {
      --cgfc-glass-fill: var(--cgfc-glass-opacity, .12);
      --cgfc-glass-luminance: .98;
      --cgfc-glass-saturation: 1.08;
    }
    :is([data-cgfc-liquid-composer], [data-cgfc-liquid-surface]) {
      background: transparent !important;
      border-color: transparent !important;
      -webkit-backdrop-filter: none !important;
      backdrop-filter: none !important;
      box-shadow: 0 10px 26px -14px rgba(0,0,0,var(--cgfc-glass-shadow)) !important;
    }
    [data-cgfc-liquid-surface] { transition: box-shadow 260ms cubic-bezier(.32,.72,0,1) !important; }
    :is([data-cgfc-liquid-composer], [data-cgfc-liquid-surface]):focus-within {
      box-shadow: 0 10px 26px -14px rgba(0,0,0,var(--cgfc-glass-shadow)) !important;
    }
    [data-cgfc-liquid-composer] { z-index: 0; --composer-layout-surface-background: transparent !important; }
    [data-cgfc-liquid-composer] :is([data-composer-body], [class*="ComposerLayoutBody-"], [class*="ComposerLayoutFooter-"]) {
      --composer-layout-surface-background: transparent !important;
    }
    [data-cgfc-liquid-surface] {
      background: rgba(var(--cgfc-glass-tint), var(--cgfc-glass-fill)) !important;
      -webkit-backdrop-filter: blur(var(--cgfc-glass-blur-px, 6px)) saturate(var(--cgfc-glass-saturation)) brightness(var(--cgfc-glass-luminance)) var(--cgfc-glass-filter, blur(0px)) !important;
      backdrop-filter: blur(var(--cgfc-glass-blur-px, 6px)) saturate(var(--cgfc-glass-saturation)) brightness(var(--cgfc-glass-luminance)) var(--cgfc-glass-filter, blur(0px)) !important;
    }
    :is([data-cgfc-liquid-composer],[data-cgfc-liquid-surface])[data-cgfc-glass-finish="refined"] {
      box-shadow:inset 0 .75px 0 rgba(255,255,255,var(--cgfc-glass-edge-light,0)),inset .5px 0 0 rgba(255,255,255,calc(var(--cgfc-glass-edge-light,0)*.3)),inset 0 -.75px 0 rgba(0,0,0,var(--cgfc-glass-edge-shade,0)),0 8px 24px -16px rgba(0,0,0,.28)!important;
    }
    [data-cgfc-liquid-surface="send"] {
      background: radial-gradient(ellipse at 30% 12%, color-mix(in srgb, var(--cgfc-glass-send-color, rgb(32,36,40)) calc(var(--cgfc-glass-edge-light, 0) * var(--cgfc-glass-fill, .12) * 60%), transparent), transparent 72%),
        color-mix(in srgb, var(--cgfc-glass-send-color, rgb(32,36,40)) calc(var(--cgfc-glass-fill, .12) * 100%), transparent) !important;
      color: #f5f6f7 !important;
      box-shadow: 0 4px 12px -6px rgba(0,0,0,.2) !important;
    }
    [data-cgfc-liquid-surface="send"]:disabled,
    [data-cgfc-liquid-surface="send"][aria-disabled="true"] { opacity: .45; }
    html[data-cgfc-theme="light"] [data-cgfc-liquid-surface="send"] { color:#202631!important; }
    [data-cgfc-liquid-surface="scroll"] {
      box-shadow: none !important;
    }
    [data-cgfc-liquid-surface="stats"], [data-cgfc-liquid-surface="toggle"] {
      box-shadow: none !important;
    }
    [data-cgfc-liquid-mode="paused"],
    [data-cgfc-liquid-composer="paused"] > [data-cgfc-glass-effect] {
      -webkit-backdrop-filter: none !important; backdrop-filter: none !important;
    }
    #cgfc-panel[data-cgfc-liquid-surface="settings"] .cgfc-settings-group {
      background: rgba(var(--cgfc-glass-tint), .12) !important;
      border-color: transparent !important;
    }
    #cgfc-panel[data-cgfc-liquid-surface="settings"] > .cgfc-actions {
      background: rgba(var(--cgfc-glass-tint), .55) !important;
      border-top-color: transparent !important;
      backdrop-filter: blur(10px);
    }
    html[data-cgfc-liquid-glass] [data-cgfc-liquid-composer] :is([data-composer-body], [data-composer-input], [data-rich-text-layout]) {
      background-color: transparent !important;
    }
    [data-cgfc-glass-effect], [data-cgfc-glass-tint], [data-cgfc-glass-rim], [data-cgfc-glass-sheen] {
      position: absolute !important; inset: 0 !important; display: block !important;
      border-radius: inherit !important; pointer-events: none !important;
      user-select: none !important; box-sizing: border-box !important;
    }
    /* Do not add isolation, opacity, masking or paint containment to the shell:
       those can cut off the live backdrop sampled by this separate effect. */
    [data-cgfc-glass-effect] {
      z-index: -2 !important; overflow: hidden !important;
      -webkit-backdrop-filter: blur(var(--cgfc-glass-blur-px, 8px)) saturate(var(--cgfc-glass-saturation)) brightness(var(--cgfc-glass-luminance)) var(--cgfc-glass-filter, blur(0px)) !important;
      backdrop-filter: blur(var(--cgfc-glass-blur-px, 8px)) saturate(var(--cgfc-glass-saturation)) brightness(var(--cgfc-glass-luminance)) var(--cgfc-glass-filter, blur(0px)) !important;
      filter: none !important;
    }
    [data-cgfc-glass-tint] {
      z-index: -1 !important;
      background: rgba(var(--cgfc-glass-tint), var(--cgfc-glass-fill)) !important;
    }
    [data-cgfc-glass-rim], [data-cgfc-liquid-surface="tools"]::before {
      content: ""; position: absolute; inset: 0; pointer-events: none;
      border-radius: inherit; padding: 1px; box-sizing: border-box;
      background: conic-gradient(from -45deg,rgba(255,255,255,.95),rgba(255,255,255,.12) 16%,rgba(255,255,255,.02) 35%,rgba(255,255,255,.52) 51%,rgba(255,255,255,.02) 68%,rgba(255,255,255,.16) 85%,rgba(255,255,255,.95));
      -webkit-mask: linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor; mask-composite: exclude;
      opacity: var(--cgfc-glass-edge-light,0); z-index: 2;
    }
    [data-cgfc-glass-finish="classic"] > [data-cgfc-glass-rim] { display:none!important; }
    [data-cgfc-liquid-surface="tools"][data-cgfc-glass-finish="classic"]::before { display:none; }
    [data-cgfc-glass-sheen] {
      z-index: 2 !important;
      background: radial-gradient(ellipse 180px 95px at var(--cgfc-glass-light-x, 26%) var(--cgfc-glass-light-y, -20%),
        rgba(255,255,255,.07), rgba(255,255,255,.015) 38%, transparent 75%) !important;
      opacity: var(--cgfc-glass-sheen-opacity, 0);
      transition: opacity 300ms cubic-bezier(.32,.72,0,1);
    }
    [data-cgfc-liquid-composer][data-cgfc-glass-hover] > [data-cgfc-glass-sheen] { opacity: var(--cgfc-glass-hover-opacity, 0); }
    [data-cgfc-liquid-composer]:active > [data-cgfc-glass-sheen] { opacity: var(--cgfc-glass-press-opacity, 0); }
    @media (prefers-reduced-motion: reduce) {
      [data-cgfc-liquid-composer], [data-cgfc-glass-sheen] { transition: none !important; }
    }
    @media (forced-colors: active) {
      :is([data-cgfc-liquid-composer], [data-cgfc-liquid-surface]) {
        background: Canvas !important; border-color: CanvasText !important;
        -webkit-backdrop-filter: none !important; backdrop-filter: none !important;
        box-shadow: inset 0 0 0 1px CanvasText !important;
      }
      [data-cgfc-glass-effect], [data-cgfc-glass-tint], [data-cgfc-glass-rim], [data-cgfc-glass-sheen], [data-cgfc-liquid-surface="tools"]::before { display: none !important; }
    }
  `;

  const glassProfileCache = new Map();
  function composerGlassProfile(curvature, bend) {
    const key = `${curvature}:${bend}`;
    if (glassProfileCache.has(key)) return glassProfileCache.get(key);
    const samples = 256, table = new Float32Array(samples + 1);
    const exponent = 2 + curvature * 4, n = 1.5168;
    const surface = x => Math.pow(1 - Math.pow(1 - x, exponent), 1 / exponent);
    let peak = 0;
    for (let i = 0; i <= samples; i += 1) {
      const x = i / samples, a = Math.max(0, x - .0001), b = Math.min(1, x + .0001);
      const theta = Math.atan((surface(b) - surface(a)) / (b - a));
      const refracted = Math.asin(Math.sin(theta) / n);
      const ci = Math.cos(theta), ct = Math.cos(refracted);
      const rs = (ci - n * ct) / (ci + n * ct), rp = (n * ci - ct) / (n * ci + ct);
      const transmitted = 1 - .5 * (rs * rs + rp * rp);
      table[i] = (.2 + bend * .3 + surface(x)) * Math.tan(theta - refracted) * transmitted;
      peak = Math.max(peak, table[i]);
    }
    const profile = { table, peak };
    if (glassProfileCache.size >= 12) glassProfileCache.delete(glassProfileCache.keys().next().value);
    glassProfileCache.set(key, profile);
    return profile;
  }

  // Shared, bounded map cache. Geometry is reusable across cards and controllers.
  function glassMapPixels(width, height, radius, bezel, optics) {
    const profile = composerGlassProfile(optics.curvature, optics.bend);
    const full = optics.renderMode === 'full';
    const resolution = Math.min(optics.dpr || 1, full ? 1.5 : 1, (full ? 1400 : 1000) / width, (full ? 500 : 360) / height);
    const w = Math.max(2, Math.round(width * resolution)), h = Math.max(2, Math.round(height * resolution));
    const data = new Uint8ClampedArray(w * h * 4);
    const neutral = new Uint32Array(new Uint8Array([128, 128, 128, 255]).buffer)[0];
    new Uint32Array(data.buffer).fill(neutral);
    const halfWidth = width / 2, halfHeight = height / 2, innerRadius = Math.max(radius, bezel);
    // Iterate the optical border only, preserving the original pixel formula.
    const row = y => {
      const py = (y + .5) / h * height - height / 2;
      let x = 0;
      while (x < w) {
        const px = (x + .5) / w * width - width / 2;
        if ((Math.abs(px) <= halfWidth - innerRadius && Math.abs(py) <= halfHeight - bezel)
          || (Math.abs(py) <= halfHeight - innerRadius && Math.abs(px) <= halfWidth - bezel)) {
          const inner = Math.abs(py) <= halfHeight - innerRadius ? halfWidth - bezel : halfWidth - innerRadius;
          x = Math.max(x + 1, Math.floor((inner + halfWidth) / width * w - .5) + 1);
          continue;
        }
        const qx = Math.abs(px) - width / 2 + radius, qy = Math.abs(py) - height / 2 + radius;
        const ax = Math.max(qx, 0), ay = Math.max(qy, 0), length = Math.hypot(ax, ay);
        const depth = -(length + Math.min(Math.max(qx, qy), 0) - radius);
        const nx = length > 0 ? ax / length * Math.sign(px) : qx > qy ? Math.sign(px) : 0;
        const ny = length > 0 ? ay / length * Math.sign(py) : qy >= qx ? Math.sign(py) : 0;
        let mag = 0;
        if (depth > 0 && depth < bezel) {
          const t = depth / bezel * 256, i = Math.floor(t), f = t - i;
          mag = (profile.table[i] * (1 - f) + profile.table[Math.min(256, i + 1)] * f) / (profile.peak || 1);
        }
        const offset = (y * w + x) * 4;
        data[offset] = Math.round(127.5 - nx * mag * 127.5);
        data[offset + 1] = Math.round(127.5 - ny * mag * 127.5);
        x++;
      }
    };
    return { width: w, height: h, data, maxBend: profile.peak * bezel, row };
  }

  const glassMapService = (() => {
    const cache = new Map(), pending = new Map();
    let bytes = 0, worker = null, failed = false, sequence = 0, generation = 0;
    const requests = new Map();
    const stats = { hits: 0, builds: 0, workerBuilds: 0, fallbackBuilds: 0 };
    const stop = (cancel = false) => {
      if (cancel) generation++;
      worker?.terminate(); worker = null;
      for (const item of requests.values()) { clearTimeout(item.timer); item.reject(new Error('Glass worker unavailable')); }
      requests.clear();
    };
    function getWorker() {
      if (worker || failed) return worker;
      try {
        const source = `const glassProfileCache=new Map();${composerGlassProfile.toString()}\n${glassMapPixels.toString()}\nlet chain=Promise.resolve();onmessage=e=>{chain=chain.then(async()=>{const {id,args}=e.data;try{const m=glassMapPixels(...args);for(let y=0;y<m.height;y++)m.row(y);const c=new OffscreenCanvas(m.width,m.height);c.getContext('2d').putImageData(new ImageData(m.data,m.width,m.height),0,0);const blob=await c.convertToBlob({type:'image/png'});postMessage({id,result:{url:new FileReaderSync().readAsDataURL(blob),maxBend:m.maxBend}});}catch(error){postMessage({id,error:String(error)});}});};`;
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        try { worker = new Worker(trustedWorkerURL(url)); } finally { URL.revokeObjectURL(url); }
        worker.onmessage = ({ data }) => {
          const item = requests.get(data.id); if (!item) return;
          requests.delete(data.id); clearTimeout(item.timer);
          if (data.error) item.reject(new Error(data.error)); else item.resolve(data.result);
        };
        worker.onerror = event => { event.preventDefault(); failed = true; stop(); };
      } catch (_) { failed = true; stop(); }
      return worker;
    }
    async function generate(args) {
      const activeGeneration = generation;
      const active = getWorker();
      if (active) {
        try {
          const result = await new Promise((resolve, reject) => {
            const id = ++sequence;
            const timer = setTimeout(() => { failed = true; stop(); }, 6000);
            requests.set(id, { resolve, reject, timer });
            try { active.postMessage({ id, args }); } catch (error) { requests.delete(id); clearTimeout(timer); reject(error); }
          });
          stats.workerBuilds++; return result;
        } catch (_) { /* CSP/unsupported OffscreenCanvas: preserve the same map. */ }
      }
      // Page teardown cancels unfinished work instead of spawning fallback work.
      if (activeGeneration !== generation) throw new Error('Glass generation cancelled');
      stats.fallbackBuilds++;
      const map = glassMapPixels(...args);
      for (let start = 0; start < map.height; start += 16) {
        if (activeGeneration !== generation) throw new Error('Glass generation cancelled');
        for (let y = start; y < Math.min(start + 16, map.height); y++) map.row(y);
        if (start + 16 < map.height) await new Promise(resolve => setTimeout(resolve, 0));
      }
      const canvas = document.createElement('canvas'); canvas.width = map.width; canvas.height = map.height;
      canvas.getContext('2d').putImageData(new ImageData(map.data, map.width, map.height), 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Glass PNG encoding failed');
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
      });
      return { url, maxBend: map.maxBend };
    }
    return {
      has(width, height, radius, bezel, optics) {
        return cache.has(JSON.stringify([width, height, radius, bezel, optics.curvature, optics.bend, optics.renderMode, window.devicePixelRatio || 1]));
      },
      async get(width, height, radius, bezel, optics) {
        const args = [width, height, radius, bezel, { ...optics, dpr: window.devicePixelRatio || 1 }];
        const key = JSON.stringify([width, height, radius, bezel, optics.curvature, optics.bend, optics.renderMode, args[4].dpr]);
        if (cache.has(key)) { stats.hits++; const result = cache.get(key); cache.delete(key); cache.set(key, result); return result; }
        if (pending.has(key)) { stats.hits++; return pending.get(key); }
        const promise = generate(args).then(result => {
          stats.builds++;
          // UTF-16 strings: cap retained maps to 8 MiB and 24 geometries.
          const size = result.url.length * 2;
          if (size <= 8 * 1024 * 1024) {
            cache.set(key, result); bytes += size;
            while (bytes > 8 * 1024 * 1024 || cache.size > 24) { const oldest = cache.keys().next().value; bytes -= cache.get(oldest).url.length * 2; cache.delete(oldest); }
          }
          return result;
        }).finally(() => pending.delete(key));
        pending.set(key, promise); return promise;
      },
      getState: () => ({ ...stats, entries: cache.size, bytes, pending: pending.size, backend: worker ? 'worker' : failed ? 'fallback' : 'idle' }),
      stop: () => stop(true),
    };
  })();
  runtime.glassMapService = glassMapService;
  const onGlassPageHide=()=>glassMapService.stop();
  window.addEventListener('pagehide',onGlassPageHide);

  let glassOpticsFrameTime = -1;
  let glassOpticsFrameValue = null;
  class ComposerLiquidGlass {
    constructor(runtime, options = {}) {
      this.runtime = runtime;
      this.options = options;
      this.modeAttribute = options.kind ? 'data-cgfc-liquid-mode' : 'data-cgfc-liquid-composer';
      this.id = `cgpt-composer-glass-${Math.random().toString(36).slice(2, 10)}`;
      this.candidate = null; this.shell = null; this.raf = 0; this.lightRaf = 0;
      this.signature = ''; this.revision = 0; this.pointer = null;
      this.lastGlare = 0; this.lightEnabled = false; this.lightTarget = null;
      this.buildEpoch = 0; this.pendingBuildKey = ''; this.buildTimer = 0;
      this.mapGeometry = ''; this.pendingGeometry = ''; this.readyGeometry = ''; this.resizeTimer = 0;
      this.onSettings = () => { glassOpticsFrameValue = null; this.attach(this.candidate || (!this.options.kind ? this.runtime?.composerQueueDock?.neumorphicShell : null)); };
      this.onComposerPaste = event => {
        if (/[\r\n]/.test(event.clipboardData?.getData('text/plain') || '')) this.beginResize();
      };
      this.onComposerBeforeInput = event => {
        if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') this.beginResize();
      };
      this.onPointer = event => {
        if (!this.lightEnabled || this.reducedMotion?.matches || !this.shell || this.suspended || document.hidden) return;
        this.pointer = { x: event.clientX, y: event.clientY };
        if (!this.lightRaf) this.lightRaf = this.runtime.pageWork.requestLayout(() => { this.lightRaf = 0; return this.prepareLight(); }, 30);
      };
      this.onLeave = () => {
        this.pointer = null;
        if (this.lightRaf) this.runtime.pageWork.cancelFrame(this.lightRaf);
        this.lightRaf = 0;
        this.defaultLight();
      };
      this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      this.onMotionChange = () => this.syncLightBinding();
      this.reducedMotion?.addEventListener?.('change', this.onMotionChange);
      if (!options.managed) document.addEventListener('cgpt-unified-ui-settings-change', this.onSettings);
      if (!options.sharedStyle) {
        this.style = document.createElement('style');
        this.style.id = 'cgpt-unified-composer-liquid-glass-style'; this.style.textContent = GLASS_STYLE;
        (document.head || document.documentElement)?.appendChild(this.style);
      }
    }

    attach(candidate) {
      if (this.style && !this.style.isConnected) (document.head || document.documentElement)?.appendChild(this.style);
      this.candidate = candidate instanceof Element && candidate.isConnected
        && !candidate.matches('input, textarea, [contenteditable="true"]') && !candidate.isContentEditable ? candidate : null;
      const next = document.documentElement.hasAttribute(this.options.enabledAttribute || 'data-cgfc-liquid-glass') ? this.candidate : null;
      if (next !== this.shell) {
        this.releaseSurface(); this.shell = next;
        if (next) {
          if (getComputedStyle(next).position === 'static') {
            this.originalPosition = [next.style.getPropertyValue('position'), next.style.getPropertyPriority('position')];
            next.style.setProperty('position', 'relative');
          }
          this.originalRadius = [next.style.getPropertyValue('border-radius'), next.style.getPropertyPriority('border-radius')];
          next.setAttribute(this.modeAttribute, 'blur');
          if (this.options.kind) next.setAttribute('data-cgfc-liquid-surface', this.options.kind);
          if (typeof ResizeObserver === 'function') {
            this.resizeObserver = this.runtime.pageWork.observeSize(next, () => {
              if (!this.options.direct) this.beginResize();
              this.schedule();
            });
          }
          if (!this.options.direct) {
            next.addEventListener('paste', this.onComposerPaste, true);
            next.addEventListener('beforeinput', this.onComposerBeforeInput, true);
            this.surfaceObserver = new MutationObserver(records => {
              if (this.shell !== next || !next.isConnected) return;
              if (records.some(record => record.type === 'attributes')) this.beginResize();
              if (['effect', 'tint', 'rim', 'sheen'].some(key => this[key]?.parentElement !== next)) this.attach(next);
              else this.schedule();
            });
            this.surfaceObserver.observe(next, { childList: true, attributes: true, attributeFilter: ['data-composer-layout', 'data-composer-radius-variant', 'data-composer-surface-variant'] });
          }
          if (!this.options.visibilityManaged && typeof IntersectionObserver === 'function') {
            this.intersectionObserver = new IntersectionObserver(entries => {
              if (this.shell !== next) return;
              this.offscreen = !entries[0]?.isIntersecting;
              if (this.offscreen) this.pause(); else this.schedule();
            }, { rootMargin: '40px' });
            this.intersectionObserver.observe(next);
          }
        }
      }
      if (!this.shell) return;
      for (const key of this.options.direct ? [] : ['effect', 'tint', 'rim', 'sheen']) {
        const attr = `data-cgfc-glass-${key}`;
        for (const child of Array.from(this.shell.children)) if (child.hasAttribute(attr) && child !== this[key]) child.remove();
        if (!this[key] || this[key].parentElement !== this.shell) {
          this[key]?.remove(); this[key] = document.createElement('span');
          this[key].setAttribute(attr, ''); this[key].setAttribute('aria-hidden', 'true');
          this.shell.appendChild(this[key]);
        }
      }
      if (!this.pointer) this.defaultLight();
      this.schedule();
    }

    setSurfaceStyle(name, value) {
      if (this.shell && this.shell.style.getPropertyValue(name) !== value) this.shell.style.setProperty(name, value);
    }

    syncLightBinding() {
      const target = !this.options.direct && this.lastGlare > 0 && !this.reducedMotion?.matches && !this.suspended && !document.hidden && this.shell?.isConnected ? this.shell : null;
      if (target === this.lightTarget) return;
      this.lightTarget?.removeEventListener('pointermove', this.onPointer);
      this.lightTarget?.removeEventListener('pointerleave', this.onLeave);
      this.onLeave();
      this.lightTarget = target; this.lightEnabled = Boolean(target);
      target?.addEventListener('pointermove', this.onPointer, { passive: true });
      target?.addEventListener('pointerleave', this.onLeave, { passive: true });
    }

    defaultLight() {
      if (!this.shell) return;
      this.shell.removeAttribute('data-cgfc-glass-hover');
      this.shell.style.removeProperty('--cgfc-glass-light-x'); this.shell.style.removeProperty('--cgfc-glass-light-y');
    }

    paintLight() { this.prepareLight()?.(); }

    prepareLight() {
      if (!this.lightEnabled || !this.shell || !this.pointer) return;
      const shell = this.shell, rect = this.runtime.pageWork.rect(shell);
      if (rect.width < 2 || rect.height < 2) return;
      const x = Math.max(0, Math.min(1, (this.pointer.x - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (this.pointer.y - rect.top) / rect.height));
      return () => {
        if (!this.lightEnabled || this.shell !== shell || !this.pointer) return;
        if (!shell.hasAttribute('data-cgfc-glass-hover')) shell.setAttribute('data-cgfc-glass-hover', '');
        this.setSurfaceStyle('--cgfc-glass-light-x', `${(x * 100).toFixed(1)}%`);
        this.setSurfaceStyle('--cgfc-glass-light-y', `${(y * 100).toFixed(1)}%`);
      };
    }

    schedule() {
      if (this.raf || !this.shell) return;
      if (document.hidden || this.offscreen) { this.pause(); return; }
      this.raf = this.runtime.pageWork.requestFrame(frameTime => {
        this.raf = 0;
        try { this.render(frameTime); } catch (error) { this.fallback(); this.lastError = String(error?.message || error); }
      });
    }

    pause() {
      if (this.raf) this.runtime.pageWork.cancelFrame(this.raf); this.raf = 0;
      this.cancelMapBuild(); this.clearResizeBuild(); this.onLeave();
      if (!this.shell || this.suspended) return;
      this.suspended = true; this.syncLightBinding();
      this.shell.setAttribute(this.modeAttribute, 'paused');
      this.shell.style.removeProperty('--cgfc-glass-filter');
    }

    fallback() {
      this.cancelMapBuild(); this.clearResizeBuild(); this.mapGeometry = '';
      this.shell?.setAttribute(this.modeAttribute, 'blur');
      this.shell?.style.removeProperty('--cgfc-glass-filter');
      this.svg?.remove(); this.svg = null; this.filter = null; this.displacements = null;
      this.signature = ''; this.opticsSignature = '';
    }

    clearResizeBuild() {
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = 0; this.pendingGeometry = ''; this.readyGeometry = ''; this.resizeSettling = false;
    }

    beginResize() {
      if (!this.filter || !this.mapGeometry || !this.shell || this.suspended) return;
      this.cancelMapBuild();
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeSettling = true; this.readyGeometry = '';
      // Remove the RGB backdrop before the browser paints a larger native card.
      // Keep tint/rim/blur while dimensions animate, then build the final map.
      if (this.shell.getAttribute(this.modeAttribute) !== 'blur') this.shell.setAttribute(this.modeAttribute, 'blur');
      this.shell.style.removeProperty('--cgfc-glass-filter');
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = 0; this.resizeSettling = false;
        this.readyGeometry = this.pendingGeometry; this.pendingGeometry = '';
        this.schedule();
      }, 180);
    }

    deferResizeBuild(geometry) {
      if (this.resizeSettling) { this.pendingGeometry = geometry; return true; }
      if (!this.filter || !this.mapGeometry || geometry === this.mapGeometry) {
        this.clearResizeBuild(); return false;
      }
      // Keep the settled geometry approved while its async map is queued or
      // encoding. A second render must not cancel that build and debounce it
      // again, otherwise busy native layouts can remain frosted indefinitely.
      if (geometry === this.readyGeometry) return false;
      if (this.pendingBuildKey) this.cancelMapBuild();
      // Keep the blur/tint layers covering the whole native card while its
      // dimensions animate. Build one exact map after the layout settles,
      // rather than doing pixel generation + PNG encoding on every frame.
      if (this.pendingGeometry !== geometry) {
        if (this.resizeTimer) clearTimeout(this.resizeTimer);
        this.pendingGeometry = geometry;
        this.resizeTimer = setTimeout(() => {
          this.resizeTimer = 0; this.readyGeometry = this.pendingGeometry; this.pendingGeometry = '';
          this.schedule();
        }, 140);
      }
      this.shell.setAttribute(this.modeAttribute, 'blur');
      this.shell.style.removeProperty('--cgfc-glass-filter');
      return true;
    }

    readOptics(frameTime) {
      const message = this.options.kind === 'message', group = this.options.kind || 'composer';
      const frame = Number.isFinite(frameTime);
      if (frame && (glassOpticsFrameTime !== frameTime || !glassOpticsFrameValue)) {
        glassOpticsFrameTime = frameTime; glassOpticsFrameValue = {};
      }
      if (frame && glassOpticsFrameValue[group]) return { ...glassOpticsFrameValue[group] };
      const style = getComputedStyle(document.documentElement);
      const prefix = this.options.kind ? '--cgfc-' + this.options.kind + '-glass-' : '--cgfc-glass-';
      const number = (key, fallback, min, max) => {
        const value = parseFloat(style.getPropertyValue(prefix + key));
        return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
      };
      const optics = { strength: number('strength', 36, 0, 60), blur: number('blur', 6, 0, 20),
        thickness: number('thickness', 14, 4, 48), glare: number('glare', .45, 0, 1.6),
        curvature: number('curvature', .5, 0, 1), bend: number('bend', .5, 0, 1), chroma: number('chroma', .04, 0, .6),
        opacity: number('opacity', .12, 0, .85),
        finish: document.documentElement.getAttribute(this.options.kind ? 'data-cgfc-' + this.options.kind + '-glass-finish' : 'data-cgfc-glass-finish') || 'refined',
        soft: document.documentElement.getAttribute(this.options.kind ? 'data-cgfc-' + this.options.kind + '-glass-style' : 'data-cgfc-glass-style') !== 'clear',
        renderMode: document.documentElement.getAttribute(this.options.kind ? 'data-cgfc-' + this.options.kind + '-glass-render-mode' : 'data-cgfc-glass-render-mode') || 'balanced',
        radius:number('radius',18,0,48),saturation:number('saturation',1.08,.5,2),brightness:number('brightness',1,.5,1.5),
        tint:style.getPropertyValue(prefix+'tint').trim() };
      const customUI=group==='queue'&&settings.queueUseCustomColors?'queue':(['toolbox','settings'].includes(group)&&settings.toolboxUseCustomColors?'toolbox':null);
      if(customUI){optics.opacity=1-(1-optics.opacity)*(1-settings[customUI+'BackgroundOpacity']);if(!optics.tint)optics.tint=settings[customUI+'BackgroundColor'].match(/[a-f0-9]{2}/gi).map(value=>parseInt(value,16)).join(',');}
      if(group==='stats'&&settings.tokenCustomColors&&!optics.tint)optics.tint=settings.tokenBackgroundColor.match(/[a-f0-9]{2}/gi).map(value=>parseInt(value,16)).join(',');
      if (frame) glassOpticsFrameValue[group] = optics;
      return { ...optics };
    }

    render(frameTime) {
      const shell = this.shell;
      if (!shell?.isConnected) { this.attach(null); return; }
      if (document.hidden || this.offscreen) { this.pause(); return; }
      // Native composer re-layout can remove unmanaged children or SVG defs
      // without changing its final size. A geometry cache alone misses this.
      if (!this.options.direct && ['effect', 'tint', 'rim', 'sheen'].some(key => this[key]?.parentElement !== shell)) { this.attach(shell); return; }
      if (this.filter && (!this.svg?.isConnected || !this.filter.isConnected)) this.fallback();
      const rect = this.runtime.pageWork.rect(shell); if (rect.width < 2 || rect.height < 2) { this.pause(); return; }
      const nativeBody = !this.options.direct ? shell.querySelector('[data-composer-body]') : null;
      const nativeLayout = shell.getAttribute('data-composer-layout') || '';
      const nativeLayoutChanged = this.nativeBody !== nativeBody || this.nativeLayout !== nativeLayout;
      this.nativeBody = nativeBody; this.nativeLayout = nativeLayout;
      const resume = this.suspended || nativeLayoutChanged; this.suspended = false;
      const optics = this.readOptics(frameTime), width = Math.round(rect.width), height = Math.round(rect.height);
      let radiusText = getComputedStyle(shell).borderTopLeftRadius, radiusRect = rect;
      if (!this.options.direct && !(parseFloat(radiusText) > 0)) {
        const nativeBody = shell.querySelector('[data-composer-body]');
        if (nativeBody) { radiusText = getComputedStyle(nativeBody).borderTopLeftRadius; radiusRect = nativeBody.getBoundingClientRect(); }
      }
      const radii = radiusText.trim().split(/\s+/);
      const resolveRadius = (text, length) => text?.includes('%') ? parseFloat(text) * length / 100 : parseFloat(text) || 0;
      const parsedRadius = Math.min(resolveRadius(radii[0], radiusRect.width), resolveRadius(radii[1] || radii[0], radiusRect.height));
      const rawRadius = Number.isFinite(optics.radius) ? optics.radius : this.options.kind === 'message' ? parsedRadius : parsedRadius || 26;
      const radius = Math.min(width / 2, height / 2, rawRadius);
      this.setSurfaceStyle('border-radius',`${radius}px`);
      if (!this.options.direct) for (const key of ['effect', 'tint', 'rim', 'sheen']) {
        if (this[key]?.style.getPropertyValue('border-radius') !== radius + 'px') this[key]?.style.setProperty('border-radius', radius + 'px', 'important');
      }
      this.blurPx = optics.blur;
      if (shell.getAttribute('data-cgfc-glass-finish') !== optics.finish) shell.setAttribute('data-cgfc-glass-finish', optics.finish);
      const dark = document.documentElement.matches('html.dark:not([data-cgfc-theme="light"]),html[data-cgfc-theme="dark"]');
      this.setSurfaceStyle('--cgfc-glass-fill', String(optics.opacity));
      // Message cards already have their own explicit brightness/saturation
      // controls. Other surfaces derive these from their own clear/soft style.
      this.setSurfaceStyle('--cgfc-glass-saturation', String(optics.saturation));
      this.setSurfaceStyle('--cgfc-glass-luminance', String(optics.brightness));
      this.setSurfaceStyle('--cgfc-glass-tint',optics.tint || (dark?'16,18,22':'245,248,252'));
      this.lastGlare = optics.glare;
      this.syncLightBinding();
      this.setSurfaceStyle('--cgfc-glass-edge-light', String(Math.min(.65, optics.glare * .5)));
      this.setSurfaceStyle('--cgfc-glass-edge-shade', String(Math.min(.4, optics.glare * .35)));
      this.setSurfaceStyle('--cgfc-glass-blur-px', `${this.blurPx}px`);
      this.setSurfaceStyle('--cgfc-glass-sheen-opacity', '0');
      this.setSurfaceStyle('--cgfc-glass-hover-opacity', String(Math.min(.4, optics.glare * .55)));
      this.setSurfaceStyle('--cgfc-glass-press-opacity', String(Math.min(.55, optics.glare * .7)));
      const chromium = /\b(?:HeadlessChrome|Chrome|Chromium|Edg)\//.test(navigator.userAgent) && !/\b(?:CriOS|EdgiOS)\//.test(navigator.userAgent);
      if (!chromium || optics.strength === 0 || optics.renderMode === 'frosted') { this.fallback(); return; }
      // Constant-width optical bezel; never turn a long textbox into a fisheye.
      const bezel = Math.min(optics.thickness, height * .24, width * .2);
      const chromatic = optics.renderMode === 'full' && optics.chroma > 0;
      const pixelRatio = window.devicePixelRatio || 1;
      const geometry = [width, height, radius, pixelRatio].join(':');
      const signature = [width, height, radius, bezel, optics.curvature, optics.bend, optics.renderMode, chromatic, pixelRatio].join(':');
      if (this.deferResizeBuild(geometry)) return;
      if (signature !== this.signature) {
        this.queueMapBuild(width, height, radius, bezel, optics, signature, geometry);
        return;
      }
      this.applyOptics(optics);
      if ((resume || !shell.style.getPropertyValue('--cgfc-glass-filter')) && this.filter) this.rekey();
      if (shell.getAttribute(this.modeAttribute) !== 'refraction') shell.setAttribute(this.modeAttribute, 'refraction');
      this.lastError = '';
    }

    cancelMapBuild() {
      this.buildEpoch++; this.pendingBuildKey = '';
      clearTimeout(this.buildTimer); this.buildTimer = 0;
    }

    queueMapBuild(width, height, radius, bezel, optics, signature, geometry) {
      if (this.pendingBuildKey === signature) return;
      this.cancelMapBuild();
      const epoch = this.buildEpoch, shell = this.shell;
      this.pendingBuildKey = signature;
      shell.setAttribute(this.modeAttribute, 'blur');
      shell.style.removeProperty('--cgfc-glass-filter');
      // Coalesce initial mount/size changes before dispatching expensive work.
      this.buildTimer = setTimeout(async () => {
        this.buildTimer = 0;
        const started = performance.now();
        try {
          const map = await glassMapService.get(width, height, radius, bezel, optics);
          if (epoch !== this.buildEpoch || shell !== this.shell || !shell?.isConnected || this.suspended || this.offscreen || document.hidden) return;
          this.buildMap(width, height, optics, map);
          this.signature = signature; this.mapGeometry = geometry;
          this.pendingBuildKey = '';
          this.lastBuildMs = Math.round((performance.now() - started) * 10) / 10;
          this.schedule();
        } catch (error) {
          if (epoch !== this.buildEpoch) return;
          this.fallback(); this.lastError = String(error?.message || error);
        }
      }, glassMapService.has(width, height, radius, bezel, optics) ? 0 : 60);
    }

    buildMap(width, height, optics, map) {
      const url = map.url, ns = 'http://www.w3.org/2000/svg';
      const make = (tag, attrs = {}) => { const node = document.createElementNS(ns, tag); for (const [k,v] of Object.entries(attrs)) node.setAttribute(k, String(v)); return node; };
      const svg = make('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false', 'data-ast-owned':'' });
      svg.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;overflow:hidden';
      const filter = make('filter', { id: `${this.id}-${++this.revision}`, x: 0, y: 0, width, height, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
      filter.appendChild(make('feImage', { href: url, x: 0, y: 0, width, height, preserveAspectRatio: 'none', result: 'map' }));
      const matrices = ['1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0', '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0'];
      this.displacements = [];
      const chromatic = optics.renderMode === 'full' && optics.chroma > 0;
      for (let c = 0; c < (chromatic ? 3 : 1); c += 1) {
        this.displacements.push(filter.appendChild(make('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: 0, xChannelSelector: 'R', yChannelSelector: 'G', result: `bend${c}` })));
        if (chromatic) filter.appendChild(make('feColorMatrix', { in: `bend${c}`, type: 'matrix', values: matrices[c], result: `channel${c}` }));
      }
      if (chromatic) {
        filter.appendChild(make('feBlend', { in: 'channel0', in2: 'channel1', mode: 'screen', result: 'rg' }));
        filter.appendChild(make('feBlend', { in: 'rg', in2: 'channel2', mode: 'screen' }));
      }
      const tree = this.shell.getRootNode();
      svg.appendChild(filter); (tree instanceof ShadowRoot ? tree : document.body || document.documentElement).appendChild(svg);
      const previous = this.svg; this.svg = svg; this.filter = filter;
      if (!this.options.direct) {
        this.defsObserver?.disconnect();
        this.defsObserver = new MutationObserver(() => {
          if (this.svg && !this.svg.isConnected && this.shell?.isConnected && !this.suspended) { this.fallback(); this.schedule(); }
        });
        this.defsObserver.observe(svg.parentNode, { childList: true });
      }
      this.maxBend = map.maxBend; this.opticsSignature = ''; this.mapUrl = url;
      this.shell.setAttribute(this.modeAttribute, 'refraction'); previous?.remove();
      this.mapBuildCount = (this.mapBuildCount || 0) + 1;
      const probe = new Image(); probe.src = url;
      probe.decode?.().then(() => { if (this.svg === svg) this.rekey(); }).catch(() => {});
    }

    applyOptics(optics) {
      if (!this.filter || !this.shell) return;
      const signature = `${optics.strength}:${this.displacements.length === 3 ? optics.chroma : 0}:${optics.finish}`;
      if (signature === this.opticsSignature) return;
      const scale = this.maxBend * 2 * optics.strength / 36 * (optics.finish === 'classic' ? 1 : .85);
      const dispersion = optics.chroma * 150;
      const factors = this.displacements.length === 3 ? (optics.finish === 'classic' ? [1 - optics.chroma * .25, 1, 1 + optics.chroma * .5] : [1 + (1.5143 - 1.5168) / .5168 * dispersion, 1, 1 + (1.5224 - 1.5168) / .5168 * dispersion]) : [1];
      this.displacements.forEach((node, i) => node.setAttribute('scale', String(scale * factors[i])));
      this.opticsSignature = signature; this.rekey();
    }

    rekey() {
      if (!this.filter || !this.shell || this.suspended || this.pendingGeometry) return;
      this.filter.id = `${this.id}-${++this.revision}`;
      this.shell.style.setProperty('--cgfc-glass-filter', `url("#${this.filter.id}")`);
    }

    releaseSurface() {
      if (this.raf) this.runtime.pageWork.cancelFrame(this.raf); this.raf = 0; this.lastGlare = 0; this.syncLightBinding(); this.onLeave();
      this.cancelMapBuild(); this.clearResizeBuild(); this.mapGeometry = '';
      this.resizeObserver?.disconnect(); this.resizeObserver = null;
      this.surfaceObserver?.disconnect(); this.surfaceObserver = null;
      this.defsObserver?.disconnect(); this.defsObserver = null;
      this.intersectionObserver?.disconnect(); this.intersectionObserver = null;
      this.offscreen = false; this.suspended = false;
      this.shell?.removeEventListener('pointermove', this.onPointer); this.shell?.removeEventListener('pointerleave', this.onLeave);
      this.shell?.removeEventListener('paste', this.onComposerPaste, true);
      this.shell?.removeEventListener('beforeinput', this.onComposerBeforeInput, true);
      this.svg?.remove(); this.svg = null; this.filter = null; this.displacements = null;
      for (const key of ['effect', 'tint', 'rim', 'sheen']) { this[key]?.remove(); this[key] = null; }
      this.shell?.removeAttribute(this.modeAttribute);
      if (this.options.kind) this.shell?.removeAttribute('data-cgfc-liquid-surface');
      this.shell?.style.removeProperty('--cgfc-glass-send-color');
      if (this.originalPosition && this.shell) {
        const [value, priority] = this.originalPosition;
        if (value) this.shell.style.setProperty('position', value, priority); else this.shell.style.removeProperty('position');
      }
      this.originalPosition = null;
      if(this.originalRadius&&this.shell){const [value,priority]=this.originalRadius;if(value)this.shell.style.setProperty('border-radius',value,priority);else this.shell.style.removeProperty('border-radius');}
      this.originalRadius=null;this.shell?.style.removeProperty('--cgfc-glass-tint');
      this.shell?.removeAttribute('data-cgfc-glass-finish');
      for (const key of ['fill', 'saturation', 'luminance', 'edge-light', 'edge-shade', 'filter', 'blur-px', 'rim-opacity', 'sheen-opacity', 'hover-opacity', 'press-opacity']) this.shell?.style.removeProperty(`--cgfc-glass-${key}`);
      this.signature = ''; this.opticsSignature = ''; this.shell = null;
    }

    destroy() {
      this.releaseSurface(); this.candidate = null;
      document.removeEventListener('cgpt-unified-ui-settings-change', this.onSettings);
      this.reducedMotion?.removeEventListener?.('change', this.onMotionChange); this.style?.remove();
    }
  }



// ASCII ocean extracted from the user-provided GPT reference.
// Adapted from stackedlol/ascii-sharks by stackedlol.
// https://github.com/stackedlol/ascii-sharks/tree/c521e24a787e6d4cc460d4cf2b9815f25e4fe453
// The upstream snapshot has no LICENSE; its license is not inferred from this script.
  function oceanModelFactory() {
  // work/ocean65-src/math.ts
  var TAU = Math.PI * 2;
  var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  var rand = (lo, hi) => lo + Math.random() * (hi - lo);
  var randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
  function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function angleDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }
  function hash3(x, y, z) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041);
    h = Math.imul(h ^ h >>> 13, 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  var K1 = 1 / 260;
  var K2 = 1 / 310;
  var K3 = 1 / 190;
  var CURRENT_SCALE = 3400;
  function current(x, y, t, out) {
    const a = x * K1 + t * 0.07;
    const b = y * K2 - t * 0.05;
    const c = (x + y) * K3 + t * 0.11;
    out.x = (-K2 * Math.sin(a) * Math.sin(b) + 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
    out.y = (-K1 * Math.cos(a) * Math.cos(b) - 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
    return out;
  }

  // work/ocean65-src/species.ts
  var SPECIES = [
    {
      name: "sardine",
      cruise: 36,
      maxSpeed: 64,
      minSpeed: 18,
      weight: 3,
      schoolSize: [18, 28],
      spacing: [1.8, 1.1],
      align: 1.6,
      cohesion: 1.6,
      jitter: 40,
      mill: 70,
      verticalDrag: 0.5
    },
    {
      name: "anchovy",
      cruise: 46,
      maxSpeed: 78,
      minSpeed: 22,
      weight: 3,
      schoolSize: [20, 32],
      spacing: [1.5, 1],
      align: 3.2,
      cohesion: 0.45,
      jitter: 30,
      mill: 0,
      verticalDrag: 1.4
    },
    {
      name: "silverside",
      cruise: 40,
      maxSpeed: 70,
      minSpeed: 20,
      weight: 3,
      schoolSize: [12, 20],
      spacing: [2, 1.1],
      align: 2.4,
      cohesion: 1.1,
      jitter: 35,
      mill: 0,
      verticalDrag: 1.6
    },
    {
      name: "mackerel",
      cruise: 32,
      maxSpeed: 60,
      minSpeed: 16,
      weight: 2,
      schoolSize: [5, 9],
      spacing: [2.6, 1.3],
      align: 2,
      cohesion: 0.9,
      jitter: 25,
      mill: 0,
      verticalDrag: 2
    },
    {
      name: "goby",
      cruise: 26,
      maxSpeed: 56,
      minSpeed: 10,
      weight: 1,
      schoolSize: [8, 12],
      spacing: [1.4, 1.1],
      align: 0.35,
      cohesion: 1.4,
      jitter: 110,
      mill: 0,
      verticalDrag: 0.3
    }
  ];
  var TOTAL_WEIGHT = SPECIES.reduce((sum, s) => sum + s.weight, 0);
  function pickSpecies() {
    let r = Math.random() * TOTAL_WEIGHT;
    for (let i = 0; i < SPECIES.length; i++) {
      r -= SPECIES[i].weight;
      if (r <= 0) return i;
    }
    return 0;
  }

  // work/ocean65-src/world.ts
  var SHARK_NODES = 20;
  var DEFAULT_SHARKS = [
    { kind: "classic", size: 1 },
    { kind: "classic", size: 0.7 },
    { kind: "classic", size: 0.84 },
    { kind: "classic", size: 0.77 }
  ];
  var FISH_SEPARATION_K = 420;
  var FISH_ALIGN_K = 1.4;
  var FISH_COHESION_K = 1;
  var FISH_FLEE_K = 1100;
  var BLIND_COS = -0.6;
  var World = class {
    /** fishCount overrides the area-based population (the sidebar wants a single small school). */
    constructor(sharkSpecs = DEFAULT_SHARKS, fishCount) {
      this.sharkSpecs = sharkSpecs;
      this.fishCount = fishCount;
    }
    sharkSpecs;
    fishCount;
    width = 0;
    height = 0;
    time = 0;
    fish = [];
    sharks = [];
    events = [];
    pointer = { x: 0, y: 0, active: false };
    /** Fish neighbourhood radius; the spatial hash bucket size matches it. */
    perception = 60;
    /** Per-species personal space in px (x, y). */
    sepX = [];
    sepY = [];
    foreignSep = 40;
    bucketCols = 0;
    bucketRows = 0;
    bucketHead = new Int32Array(0);
    bucketCount = new Uint16Array(0);
    bucketNext = new Int32Array(0);
    lastSpawn = 0;
    tmp = { x: 0, y: 0 };
    predatorData = new Float64Array(0);
    resize(width, height, cellW, cellH) {
      const first = this.width === 0;
      this.width = width;
      this.height = height;
      this.sepX = SPECIES.map((sp) => sp.spacing[0] * cellW);
      this.sepY = SPECIES.map((sp) => sp.spacing[1] * cellH);
      this.perception = Math.max(cellH * 3, cellW * 5.5);
      this.foreignSep = cellW * 3;
      if (first || this.fish.length === 0) {
        this.seed();
        return;
      }
      for (const f of this.fish) {
        f.x = clamp(f.x, 0, width);
        f.y = clamp(f.y, 0, height);
      }
    }
    seed() {
      const { width: W, height: H } = this;
      const minSide = Math.min(W, H);
      const baseLength = clamp(minSide * 0.44, 170, 430);
      const sharkCount = this.sharkSpecs.length;
      this.sharks = [];
      for (let i = 0; i < sharkCount; i++) {
        const { kind, size } = this.sharkSpecs[i];
        const length = baseLength * size;
        const orbitRadius = minSide * rand(0.28, 0.4);
        const a = i / sharkCount * TAU + rand(-0.4, 0.4);
        const orbitDir = i % 2 === 0 ? 1 : -1;
        const x = W / 2 + Math.cos(a) * orbitRadius * (W / minSide) * 0.9;
        const y = H / 2 + Math.sin(a) * orbitRadius;
        const heading = a + orbitDir * Math.PI / 2;
        const nodes = new Float32Array(SHARK_NODES * 2);
        const seg = length / (SHARK_NODES - 1);
        for (let n = 0; n < SHARK_NODES; n++) {
          nodes[n * 2] = x - Math.cos(heading) * seg * n;
          nodes[n * 2 + 1] = y - Math.sin(heading) * seg * n;
        }
        this.sharks.push({
          id: i + 1,
          kind,
          length,
          nodes,
          heading,
          speed: 30,
          phase: rand(0, TAU),
          turn: 0,
          hunger: rand(0.25, 0.75),
          wander: 0,
          orbitDir,
          orbitRadius,
          target: null,
          retargetAt: 0,
          depth: size
        });
      }
      this.sharks.sort((a, b) => a.length - b.length);
      const total = this.fishCount ?? clamp(Math.round(W * H / 4400), 85, 340);
      this.fish = [];
      while (this.fish.length < total) {
        const species = pickSpecies();
        const sp = SPECIES[species];
        const size = Math.min(randInt(sp.schoolSize[0], sp.schoolSize[1]), total - this.fish.length);
        const millDir = Math.random() < 0.5 ? 1 : -1;
        const cx = rand(W * 0.06, W * 0.94);
        const cy = rand(H * 0.08, H * 0.92);
        const dir = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.5, 0.5);
        for (let k = 0; k < size; k++) {
          this.fish.push({
            x: cx + rand(-1, 1) * this.sepX[species] * Math.sqrt(size),
            y: cy + rand(-1, 1) * this.sepY[species] * Math.sqrt(size) * 0.6,
            vx: Math.cos(dir) * sp.cruise,
            vy: Math.sin(dir) * sp.cruise,
            species,
            alarm: 0,
            alive: true,
            respawnAt: 0,
            phase: rand(0, TAU),
            turn: 0,
            depth: rand(0.55, 1),
            millDir
          });
        }
      }
      this.bucketNext = new Int32Array(this.fish.length);
    }
    splash(x, y) {
      this.events.push({ kind: "splash", x, y });
      const r = 240;
      for (const f of this.fish) {
        if (!f.alive) continue;
        const dx = f.x - x;
        const dy = f.y - y;
        const d = Math.hypot(dx, dy);
        if (d > r || d < 1e-3) continue;
        const k = (1 - d / r) * 260;
        f.vx += dx / d * k;
        f.vy += dy / d * k;
        f.alarm = 1;
      }
    }
    step(dt) {
      this.time += dt;
      this.rebuildHash();
      this.stepFish(dt);
      this.stepSharks(dt);
      this.respawn();
    }
    rebuildHash() {
      const size = this.perception;
      const pad = 2;
      this.bucketCols = Math.ceil(this.width / size) + pad * 2;
      this.bucketRows = Math.ceil(this.height / size) + pad * 2;
      const n = this.bucketCols * this.bucketRows;
      if (this.bucketHead.length !== n) {
        this.bucketHead = new Int32Array(n);
        this.bucketCount = new Uint16Array(n);
      }
      this.bucketHead.fill(-1);
      this.bucketCount.fill(0);
      if (this.bucketNext.length !== this.fish.length) {
        this.bucketNext = new Int32Array(this.fish.length);
      }
      for (let i = 0; i < this.fish.length; i++) {
        const f = this.fish[i];
        if (!f.alive) continue;
        const b = this.bucketOf(f.x, f.y);
        this.bucketNext[i] = this.bucketHead[b];
        this.bucketHead[b] = i;
        this.bucketCount[b]++;
      }
    }
    bucketOf(x, y) {
      const size = this.perception;
      const c = clamp(Math.floor(x / size) + 2, 0, this.bucketCols - 1);
      const r = clamp(Math.floor(y / size) + 2, 0, this.bucketRows - 1);
      return r * this.bucketCols + c;
    }
    stepFish(dt) {
      const { fish, sharks, pointer, width: W, height: H, time } = this;
      const R = this.perception;
      const R2 = R * R;
      const foreignSep = this.foreignSep;
      const size = this.perception;
      const cols = this.bucketCols;
      const rows = this.bucketRows;
      const head = this.bucketHead;
      const next = this.bucketNext;
      const cur = this.tmp;
      const calmDecay = Math.exp(-dt * 0.7);
      const contagion = Math.min(1, dt * 6);
      if (this.predatorData.length !== sharks.length * 3) this.predatorData = new Float64Array(sharks.length * 3);
      const predatorData = this.predatorData;
      for (let k = 0; k < sharks.length; k++) {
        predatorData[k * 3] = Math.cos(sharks[k].heading);
        predatorData[k * 3 + 1] = Math.sin(sharks[k].heading);
        predatorData[k * 3 + 2] = sharks[k].length * 0.6 + 60;
      }
      for (let i = 0; i < fish.length; i++) {
        const f = fish[i];
        if (!f.alive) continue;
        const sp = SPECIES[f.species];
        const spread = 1 + 1.8 * f.alarm;
        const sepX = this.sepX[f.species] * spread;
        const sepY = this.sepY[f.species] * spread;
        const speed = Math.hypot(f.vx, f.vy) || 1;
        const hx = f.vx / speed;
        const hy = f.vy / speed;
        let ax = 0;
        let ay = 0;
        let sx = 0;
        let sy = 0;
        let avx = 0;
        let avy = 0;
        let cx = 0;
        let cy = 0;
        let n = 0;
        let neighbourAlarm = 0;
        const bc = clamp(Math.floor(f.x / size) + 2, 0, cols - 1);
        const br = clamp(Math.floor(f.y / size) + 2, 0, rows - 1);
        for (let r = Math.max(0, br - 1); r <= Math.min(rows - 1, br + 1); r++) {
          for (let c = Math.max(0, bc - 1); c <= Math.min(cols - 1, bc + 1); c++) {
            let j = head[r * cols + c];
            while (j !== -1) {
              if (j !== i) {
                const o = fish[j];
                const dx = o.x - f.x;
                const dy = o.y - f.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < R2 && d2 > 1e-6) {
                  const d = Math.sqrt(d2);
                  if ((dx * hx + dy * hy) / d > BLIND_COS) {
                    const qx = dx / sepX;
                    const qy = dy / sepY;
                    const q2 = qx * qx + qy * qy;
                    if (q2 < 1) {
                      const q = Math.sqrt(q2) || 1e-3;
                      const k = (1 - q) / q;
                      sx -= qx * k;
                      sy -= qy * k;
                    }
                    if (o.species === f.species) {
                      avx += o.vx;
                      avy += o.vy;
                      cx += dx;
                      cy += dy;
                      n++;
                    } else if (d < foreignSep) {
                      const k = (1 - d / foreignSep) / d * 0.6;
                      sx -= dx * k;
                      sy -= dy * k;
                    }
                    if (o.alarm > neighbourAlarm) neighbourAlarm = o.alarm;
                  }
                }
              }
              j = next[j];
            }
          }
        }
        ax += sx * FISH_SEPARATION_K;
        ay += sy * FISH_SEPARATION_K;
        if (n > 0) {
          const alignK = FISH_ALIGN_K * sp.align;
          const cohesionK = FISH_COHESION_K * sp.cohesion * (1 - 0.8 * f.alarm);
          ax += (avx / n - f.vx) * alignK + cx / n * cohesionK;
          ay += (avy / n - f.vy) * alignK + cy / n * cohesionK;
          if (sp.mill > 0) {
            const cl = Math.hypot(cx, cy) || 1;
            ax += -cy / cl * f.millDir * sp.mill * (1 - f.alarm);
            ay += cx / cl * f.millDir * sp.mill * (1 - f.alarm);
          }
        }
        let fear = 0;
        for (let sharkIndex = 0; sharkIndex < sharks.length; sharkIndex++) {
          const sh = sharks[sharkIndex];
          const fearR = predatorData[sharkIndex * 3 + 2];
          let best = Infinity;
          let bx = 0;
          let by = 0;
          for (let k = 0; k <= 12; k += 3) {
            const nx = sh.nodes[k * 2];
            const ny = sh.nodes[k * 2 + 1];
            const d2 = (f.x - nx) ** 2 + (f.y - ny) ** 2;
            if (d2 < best) {
              best = d2;
              bx = nx;
              by = ny;
            }
          }
          const d = Math.sqrt(best);
          if (d >= fearR || d < 1e-3) continue;
          let w = 1 - d / fearR;
          w *= w;
          const awayX = (f.x - bx) / d;
          const awayY = (f.y - by) / d;
          const shx = predatorData[sharkIndex * 3];
          const shy = predatorData[sharkIndex * 3 + 1];
          const side = shx * (f.y - sh.nodes[1]) - shy * (f.x - sh.nodes[0]) >= 0 ? 1 : -1;
          ax += (awayX * 0.7 - shy * side * 0.9) * FISH_FLEE_K * w;
          ay += (awayY * 0.7 + shx * side * 0.9) * FISH_FLEE_K * w;
          fear = Math.max(fear, Math.sqrt(w));
        }
        if (pointer.active) {
          const pr = 130;
          const dx = f.x - pointer.x;
          const dy = f.y - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < pr && d > 1e-3) {
            const w = (1 - d / pr) ** 2;
            ax += dx / d * FISH_FLEE_K * w;
            ay += dy / d * FISH_FLEE_K * w;
            fear = Math.max(fear, Math.sqrt(w) * 0.8);
          }
        }
        let alarm = Math.max(f.alarm * calmDecay, fear);
        const relayed = neighbourAlarm * 0.86;
        if (relayed > alarm) alarm += (relayed - alarm) * contagion;
        f.alarm = alarm;
        const m = 36;
        if (f.x < m) ax += (m - f.x) * 7;
        else if (f.x > W - m) ax -= (f.x - (W - m)) * 7;
        if (f.y < m) ay += (m - f.y) * 7;
        else if (f.y > H - m) ay -= (f.y - (H - m)) * 7;
        current(f.x, f.y, time, cur);
        ax += cur.x * 0.5 + (Math.random() - 0.5) * sp.jitter;
        ay += cur.y * 0.5 + (Math.random() - 0.5) * sp.jitter;
        ay -= f.vy * sp.verticalDrag * (1 - 0.7 * f.alarm);
        const preferred = sp.cruise * (1 + 1.3 * f.alarm);
        ax += (preferred - speed) * hx * 1.6;
        ay += (preferred - speed) * hy * 1.6;
        const before = Math.atan2(f.vy, f.vx);
        f.vx += ax * dt;
        f.vy += ay * dt;
        const maxSpeed = sp.maxSpeed * (1 + 1.8 * f.alarm);
        const s = Math.hypot(f.vx, f.vy);
        let finalSpeed = s;
        if (s > maxSpeed) {
          f.vx *= maxSpeed / s;
          f.vy *= maxSpeed / s;
          finalSpeed = Math.hypot(f.vx, f.vy);
        } else if (s < sp.minSpeed && s > 1e-3) {
          f.vx *= sp.minSpeed / s;
          f.vy *= sp.minSpeed / s;
          finalSpeed = Math.hypot(f.vx, f.vy);
        }
        f.turn += (angleDiff(before, Math.atan2(f.vy, f.vx)) / dt - f.turn) * Math.min(1, dt * 8);
        f.phase += dt * (7 + finalSpeed * 0.12);
        f.x = clamp(f.x + f.vx * dt, -60, W + 60);
        f.y = clamp(f.y + f.vy * dt, -60, H + 60);
      }
    }
    stepSharks(dt) {
      const { sharks, width: W, height: H, time } = this;
      const minSide = Math.min(W, H);
      const cxW = W / 2;
      const cyW = H / 2;
      for (const sh of sharks) {
        const L = sh.length;
        const nodes = sh.nodes;
        const hx = nodes[0];
        const hy = nodes[1];
        sh.hunger = Math.min(1, sh.hunger + dt * 0.03);
        let dx = Math.cos(sh.heading);
        let dy = Math.sin(sh.heading);
        sh.wander = clamp(sh.wander + (Math.random() - 0.5) * dt * 3.2, -1.1, 1.1);
        dx += Math.cos(sh.heading + sh.wander) * 0.45;
        dy += Math.sin(sh.heading + sh.wander) * 0.45;
        if (time >= sh.retargetAt) {
          sh.target = this.findPrey(sh);
          sh.retargetAt = time + 0.45;
        }
        const t = sh.target;
        let hunting = false;
        let closing = 0;
        if (t && t.alive && sh.hunger > 0.3) {
          const tx = t.x + t.vx * 0.35 - hx;
          const ty = t.y + t.vy * 0.35 - hy;
          const d = Math.hypot(tx, ty) || 1;
          const w = 1.4 + 2.6 * sh.hunger;
          dx += tx / d * w;
          dy += ty / d * w;
          hunting = true;
          closing = clamp(1 - d / (L * 0.9), 0, 1);
        } else {
          const rx = (hx - cxW) / (W / minSide);
          const ry = hy - cyW;
          const r = Math.hypot(rx, ry) || 1;
          const radius = sh.orbitRadius * (1 + 0.15 * Math.sin(time * 0.05 + sh.id));
          const radial = clamp((radius - r) / radius, -1, 1);
          dx += (-ry / r * sh.orbitDir + rx / r * radial * 0.9) * 0.55;
          dy += (rx / r * sh.orbitDir + ry / r * radial * 0.9) * 0.55;
        }
        for (const other of sharks) {
          if (other === sh) continue;
          for (let k = 0; k < SHARK_NODES; k += 4) {
            const ox = hx - other.nodes[k * 2];
            const oy = hy - other.nodes[k * 2 + 1];
            const d = Math.hypot(ox, oy);
            const range = (L + other.length) * 0.45;
            if (d < range && d > 1e-3) {
              const w = (1 - d / range) * 3;
              dx += ox / d * w;
              dy += oy / d * w;
            }
          }
        }
        const ex = (hx - cxW) / (W * 0.3);
        const ey = (hy - cyW) / (H * 0.16);
        const e2 = ex * ex + ey * ey;
        if (e2 < 1) {
          const e = Math.sqrt(e2) || 1e-3;
          const w = (1 - e) * (hunting ? 1 : 2.5);
          dx += ex / e * w;
          dy += ey / e * w;
        }
        const over = Math.max(-hx, hx - W, -hy, hy - H);
        if (over > -L * 0.05) {
          const w = clamp((over + L * 0.05) / (L * 0.35), 0, 1) * 3.5;
          const toX = cxW - hx;
          const toY = cyW - hy;
          const d = Math.hypot(toX, toY) || 1;
          dx += toX / d * w;
          dy += toY / d * w;
        }
        const desired = Math.atan2(dy, dx);
        const agility = Math.min(hunting ? 1.7 + closing : 0.8, sh.speed / (L * 0.22));
        const maxTurn = agility * dt;
        const turned = clamp(angleDiff(sh.heading, desired), -maxTurn, maxTurn);
        sh.heading += turned;
        sh.turn += (turned / dt - sh.turn) * Math.min(1, dt * 3);
        const cruise = 30 + L * 0.04;
        const targetSpeed = hunting ? cruise * (1.45 + closing * 1.5) : cruise;
        sh.speed += (targetSpeed - sh.speed) * Math.min(1, dt * 1.1);
        sh.phase += dt * (2 + sh.speed / 24);
        nodes[0] += Math.cos(sh.heading) * sh.speed * dt;
        nodes[1] += Math.sin(sh.heading) * sh.speed * dt;
        const seg = L / (SHARK_NODES - 1);
        const maxBend = 0.16;
        let prevAngle = sh.heading + Math.PI;
        for (let k = 1; k < SHARK_NODES; k++) {
          const px = nodes[(k - 1) * 2];
          const py = nodes[(k - 1) * 2 + 1];
          let angle = Math.atan2(nodes[k * 2 + 1] - py, nodes[k * 2] - px);
          angle = prevAngle + clamp(angleDiff(prevAngle, angle), -maxBend, maxBend);
          nodes[k * 2] = px + Math.cos(angle) * seg;
          nodes[k * 2 + 1] = py + Math.sin(angle) * seg;
          prevAngle = angle;
        }
        if (sh.hunger > 0.15) {
          const mouthR = L * 0.05 + 8;
          const mx = nodes[0];
          const my = nodes[1];
          for (const f of this.fish) {
            if (!f.alive) continue;
            if ((f.x - mx) ** 2 + (f.y - my) ** 2 < mouthR * mouthR) {
              f.alive = false;
              f.respawnAt = time + rand(3, 8);
              sh.hunger = Math.max(0, sh.hunger - 0.16);
              this.events.push({ kind: "eat", x: f.x, y: f.y });
            }
          }
        }
      }
    }
    /**
     * Pick prey in the shark's forward cone, preferring close fish in sparse
     * buckets (stragglers) over fish buried in a dense school.
     */
    findPrey(sh) {
      const range = sh.length * 0.9 + 160;
      const hx = sh.nodes[0];
      const hy = sh.nodes[1];
      const fx = Math.cos(sh.heading);
      const fy = Math.sin(sh.heading);
      let best = null;
      let bestScore = Infinity;
      let currentScore = Infinity;
      for (const f of this.fish) {
        if (!f.alive) continue;
        const dx = f.x - hx;
        const dy = f.y - hy;
        const d = Math.hypot(dx, dy);
        if (d > range || d < 1e-3) continue;
        const cos = (dx * fx + dy * fy) / d;
        if (cos < 0.2) continue;
        const crowd = this.bucketCount[this.bucketOf(f.x, f.y)];
        const score = d * (1 + (1 - cos) * 0.8) * (1 + crowd * 0.07);
        if (score < bestScore) {
          bestScore = score;
          best = f;
        }
        if (f === sh.target) currentScore = score;
      }
      if (sh.target && currentScore < bestScore * 1.3) return sh.target;
      return best;
    }
    respawn() {
      const { time, width: W, height: H } = this;
      const due = [];
      for (const f of this.fish) if (!f.alive && f.respawnAt <= time) due.push(f);
      if (due.length === 0) return;
      if (due.length < 6 && time - this.lastSpawn < 9) return;
      this.lastSpawn = time;
      const side = randInt(0, 3);
      const along = rand(0.15, 0.85);
      const x = side === 0 ? -20 : side === 1 ? W + 20 : along * W;
      const y = side === 2 ? -20 : side === 3 ? H + 20 : along * H;
      const inward = Math.atan2(H / 2 - y, W / 2 - x) + rand(-0.5, 0.5);
      const species = pickSpecies();
      const sp = SPECIES[species];
      const millDir = Math.random() < 0.5 ? 1 : -1;
      for (const f of due.slice(0, sp.schoolSize[1])) {
        f.alive = true;
        f.species = species;
        f.alarm = 0;
        f.turn = 0;
        f.millDir = millDir;
        f.x = x + rand(-1, 1) * this.perception;
        f.y = y + rand(-1, 1) * this.perception;
        f.vx = Math.cos(inward) * sp.cruise * 1.4;
        f.vy = Math.sin(inward) * sp.cruise * 1.4;
      }
    }
  };

  // work/ocean65-src/renderer.ts
  var ALPHA_LEVELS = 6;
  var FISH_ALPHAS = [0.28, 0.42, 0.58, 0.74, 0.9];
  var DOT_RGB = [
    [48, 52, 235],
    [52, 205, 60],
    [228, 50, 44],
    [190, 212, 255],
    [110, 230, 255]
  ];
  var DOT_BASE_ALPHA = [1, 1, 1, 1, 1];
  var WAKE = DOT_RGB.length - 1;
  var ACCENTS = ["#e0892c", "#e03a32", "#b44ae0", "#33c8cc", "#3cb54a", "#3150e8", "#d9c14a"];
  var SKIN_RAMP = ":;t%SX8#@";
  var FIN_GLYPHS = "%;tS:";
  var RIDGE_GLYPHS = "@8%";
  var EDGE_HEAVY = ":;";
  var EDGE_LIGHT = ".',`";
  var FLAG_BODY = 1;
  var FLAG_EDGE = 2;
  var FLAG_FIN = 3;
  var FLAG_RIDGE = 4;
  var FLAG_EYE = 5;
  var FLAG_MARK = 6;
  var MARK_GLYPHS = "#%@";
  var SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];
  function classicHalfWidth(s) {
    if (s < 0.13) return 0.09 * Math.pow(Math.sin(s / 0.13 * Math.PI / 2), 0.95);
    if (s < 0.3) return 0.09 + 0.016 * smoothstep(0.13, 0.3, s);
    if (s < 0.84) return 0.019 + 0.087 * Math.pow(1 - (s - 0.3) / 0.54, 1.25);
    const k = (s - 0.84) / 0.16;
    return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
  }
  var SHAPES = {
    classic: {
      halfWidth: classicHalfWidth,
      pectoral: [0.15, 0.43, 0.55, 0.26],
      falcate: true,
      pelvic: [0.57, 0.65, 0.69, 0.085],
      caudal: 0.085,
      dorsal: [0.33, 0.47],
      secondDorsal: [0.71, 0.76],
      eye: [0.1, 0.14],
      gills: [0.19, 0.29],
      tint: [0.92, 0.97, 1.05]
    },
    // Slim neck under a wide, swept-back cephalofoil (drawn in sampleShark),
    // tall first dorsal, long upper tail lobe. Bronze-olive grey.
    hammerhead: {
      halfWidth: (s) => {
        if (s < 0.06) return 0.045;
        if (s < 0.3) return 0.045 + 0.061 * smoothstep(0.06, 0.3, s);
        return classicHalfWidth(s) * 0.92;
      },
      head: { span: 0.17, sweep: 0.035, depth: 0.09, notch: 0 },
      pectoral: [0.17, 0.4, 0.5, 0.22],
      falcate: true,
      pelvic: [0.56, 0.63, 0.67, 0.075],
      caudal: 0.11,
      dorsal: [0.28, 0.44],
      secondDorsal: [0.7, 0.74],
      eye: null,
      gills: [0.16, 0.26],
      tint: [0.96, 0.98, 0.9]
    },
    // Blunt, square snout on a heavy body; barred back. Warm grey-brown.
    tiger: {
      halfWidth: (s) => {
        if (s < 0.13) return 0.1 * Math.pow(Math.sin(s / 0.13 * Math.PI / 2), 0.45);
        if (s < 0.3) return 0.1 + 0.014 * smoothstep(0.13, 0.3, s);
        if (s < 0.84) return 0.019 + 0.095 * Math.pow(1 - (s - 0.3) / 0.54, 1.2);
        const k = (s - 0.84) / 0.16;
        return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
      },
      pectoral: [0.15, 0.42, 0.53, 0.25],
      falcate: true,
      pelvic: [0.57, 0.65, 0.69, 0.085],
      caudal: 0.095,
      dorsal: [0.33, 0.46],
      secondDorsal: [0.71, 0.75],
      eye: [0.08, 0.12],
      gills: [0.19, 0.28],
      tint: [1.02, 0.95, 0.84]
    },
    // Short rounded head, body done by half-length, then a long ribbon of a
    // tail fin. Broad rounded pectorals, spotted sandy skin.
    zebra: {
      halfWidth: (s) => {
        if (s < 0.1) return 0.075 * Math.pow(Math.sin(s / 0.1 * Math.PI / 2), 0.7);
        if (s < 0.28) return 0.075 + 0.025 * smoothstep(0.1, 0.28, s);
        if (s < 0.55) return 0.022 + 0.078 * Math.pow(1 - (s - 0.28) / 0.27, 1.1);
        const k = (s - 0.55) / 0.45;
        return 0.022 * (1 - k * k) + 0.012 * Math.sin(k * Math.PI);
      },
      pectoral: [0.12, 0.3, 0.36, 0.19],
      falcate: false,
      pelvic: [0.42, 0.48, 0.51, 0.065],
      caudal: 0,
      dorsal: [0.36, 0.44],
      secondDorsal: [0.49, 0.53],
      eye: [0.06, 0.09],
      gills: [0.13, 0.2],
      tint: [1.08, 0.97, 0.74]
    },
    // Great hammerhead: a broader, nearly straight-edged cephalofoil with a notch at the centre,
    // a towering sickle first dorsal (drawn long and bright from above), and a cooler slate skin.
    greathammer: {
      halfWidth: (s) => {
        if (s < 0.05) return 0.04;
        if (s < 0.3) return 0.04 + 0.07 * smoothstep(0.05, 0.3, s);
        return classicHalfWidth(s) * 0.95;
      },
      head: { span: 0.21, sweep: 6e-3, depth: 0.085, notch: 0.014 },
      pectoral: [0.16, 0.38, 0.49, 0.24],
      falcate: true,
      pelvic: [0.55, 0.62, 0.67, 0.085],
      caudal: 0.13,
      dorsal: [0.24, 0.45],
      secondDorsal: [0.68, 0.74],
      eye: null,
      gills: [0.15, 0.25],
      tint: [0.86, 0.93, 1.02]
    },
    // Shortfin mako: a long conical snout, a torpedo body that narrows hard to the tail stalk,
    // and a tall crescent tail. Metallic indigo back.
    mako: {
      halfWidth: (s) => {
        if (s < 0.17) return 0.088 * Math.pow(Math.sin(s / 0.17 * Math.PI / 2), 1.5);
        if (s < 0.32) return 0.088 + 0.012 * smoothstep(0.17, 0.32, s);
        if (s < 0.86) return 0.014 + 0.086 * Math.pow(1 - (s - 0.32) / 0.54, 1.45);
        const k = (s - 0.86) / 0.14;
        return 0.014 * (1 - k) + 0.01 * Math.sin(k * Math.PI);
      },
      pectoral: [0.18, 0.4, 0.5, 0.21],
      falcate: true,
      pelvic: [0.58, 0.64, 0.68, 0.06],
      caudal: 0.13,
      dorsal: [0.34, 0.45],
      secondDorsal: [0.76, 0.79],
      eye: [0.11, 0.15],
      gills: [0.2, 0.3],
      tint: [0.78, 0.9, 1.2]
    },
    // Thresher: a compact body over the front half, then the upper tail lobe as a long whip
    // that's as long as the shark itself. Big eyes, long sickle pectorals, bronze-violet skin.
    thresher: {
      halfWidth: (s) => {
        if (s < 0.08) return 0.07 * Math.pow(Math.sin(s / 0.08 * Math.PI / 2), 0.75);
        if (s < 0.2) return 0.07 + 0.02 * smoothstep(0.08, 0.2, s);
        if (s < 0.48) return 0.012 + 0.078 * Math.pow(1 - (s - 0.2) / 0.28, 1.3);
        const k = (s - 0.48) / 0.52;
        return 0.012 * (1 - k) + 6e-3 * Math.sin(k * Math.PI * 0.9) + 2e-3;
      },
      pectoral: [0.12, 0.27, 0.36, 0.2],
      falcate: true,
      pelvic: [0.37, 0.41, 0.44, 0.045],
      caudal: 0,
      dorsal: [0.24, 0.32],
      secondDorsal: [0.45, 0.47],
      eye: [0.05, 0.1],
      gills: [0.11, 0.18],
      tint: [1, 0.9, 1.08]
    },
    // Nurse shark: a blunt, broad head, a heavy flattened body with both dorsals set far back,
    // rounded paddle pectorals, and a long low tail with no lower lobe. Tawny brown.
    nurse: {
      halfWidth: (s) => {
        if (s < 0.08) return 0.085 * Math.pow(Math.sin(s / 0.08 * Math.PI / 2), 0.4);
        if (s < 0.3) return 0.085 + 0.02 * smoothstep(0.08, 0.3, s);
        if (s < 0.72) return 0.022 + 0.083 * Math.pow(1 - (s - 0.3) / 0.42, 1.1);
        const k = (s - 0.72) / 0.28;
        return 0.022 * (1 - k * k) + 0.014 * Math.sin(k * Math.PI);
      },
      pectoral: [0.16, 0.34, 0.4, 0.17],
      falcate: false,
      pelvic: [0.45, 0.52, 0.55, 0.075],
      caudal: 0,
      dorsal: [0.5, 0.58],
      secondDorsal: [0.63, 0.69],
      eye: [0.05, 0.075],
      gills: [0.14, 0.22],
      tint: [1.1, 0.96, 0.76]
    }
  };
  var KINDS = Object.keys(SHAPES);
  function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }
  var AsciiRenderer = class {
    constructor(canvas, context = null) {
      this.canvas = canvas;
      const ctx = context || canvas.getContext("2d", { alpha: true });
      if (!ctx) throw new Error("2D canvas unavailable");
      this.ctx = ctx;
      for (let c = 0; c < DOT_RGB.length; c++) {
        const [r, g, b] = DOT_RGB[c];
        for (let l = 0; l < ALPHA_LEVELS; l++) {
          const a = DOT_BASE_ALPHA[c] * (l + 1) / ALPHA_LEVELS;
          this.dotStyles.push(`rgba(${r},${g},${b},${a.toFixed(3)})`);
        }
      }
    }
    canvas;
    ctx;
    occluded = new Uint8Array(0);
    occlusionKey = "";
    bodyTint = null;
    paletteAccents = null;
    edgeSamples = 4;
    setDetail(eco) {
      this.edgeSamples = eco ? 2 : 4;
    }
    setPalette(body, accent, fish, wake) {
      this.bodyTint = body?.map((v) => v / 160) || null;
      this.paletteAccents = body ? [accent, accent, "rgb(" + body.join(",") + ")"] : null;
      this.fishStyles = FISH_ALPHAS.map((a) => "rgba(" + fish.join(",") + "," + a + ")");
      for (let l = 0; l < ALPHA_LEVELS; l++) this.dotStyles[WAKE * ALPHA_LEVELS + l] = "rgba(" + wake.join(",") + "," + (l + 1) / ALPHA_LEVELS + ")";
    }
    setOcclusion(rects) {
      const key = this.cols + "," + this.rows + ":" + rects.map((r) => [r.x, r.y, r.w, r.h].join(",")).join(";");
      if (key === this.occlusionKey) return;
      this.occlusionKey = key;
      this.occluded = new Uint8Array(this.cols * this.rows);
      for (const rect of rects) {
        const c0 = Math.max(0, Math.ceil(rect.x / this.cw)), c1 = Math.min(this.cols, Math.floor((rect.x + rect.w) / this.cw));
        const r0 = Math.max(0, Math.ceil(rect.y / this.ch)), r1 = Math.min(this.rows, Math.floor((rect.y + rect.h) / this.ch));
        for (let r = r0; r < r1; r++) this.occluded.fill(1, r * this.cols + c0, r * this.cols + c1);
      }
    }
    getOccludedCells() {
      return this.occluded.reduce((a, b) => a + b, 0);
    }
    dpr = 1;
    width = 0;
    height = 0;
    cw = 12;
    ch = 18;
    cols = 0;
    rows = 0;
    fontFamily = "ui-monospace, Menlo, monospace";
    dotKind = new Uint8Array(0);
    // 0 none, 1 blue, 2 green, 3 red, 4 pale
    dotPhase = new Float32Array(0);
    dotFreq = new Float32Array(0);
    energy = new Float32Array(0);
    energyTmp = new Float32Array(0);
    heat = new Float32Array(0);
    bucketOf = new Uint8Array(0);
    bucketOrder = new Int32Array(0);
    bucketCounts = new Int32Array(DOT_RGB.length * ALPHA_LEVELS + 1);
    dotStyles = [];
    sharkFlag = new Uint8Array(0);
    sharkShade = new Float32Array(0);
    sharkKey = new Uint32Array(0);
    sharkDepth = new Float32Array(0);
    sharkKind = new Uint8Array(0);
    /** Cells darkened by a shark's shadow on the seabed. */
    sharkShadow = new Uint8Array(0);
    spine = new Float32Array(SHARK_NODES * 2);
    arc = new Float32Array(SHARK_NODES);
    arcTotal = 1;
    segmentData = new Float64Array((SHARK_NODES - 1) * 10);
    segmentGroups = new Float64Array(5 * 4);
    nearestSegment = 0;
    externalFieldClock = false;
    setExternalFieldClock(value) {
      this.externalFieldClock = value;
    }
    advanceFields(world, dt) {
      this.consumeEvents(world);
      this.depositWake(world, dt);
      this.diffuse(dt);
    }
    dotStarts = new Int32Array(DOT_RGB.length * ALPHA_LEVELS + 1);
    dotCursor = new Int32Array(DOT_RGB.length * ALPHA_LEVELS + 1);
    shape = SHAPES.classic;
    sharkId = 0;
    finTipLeft = 0;
    finTipRight = 0;
    // Scratch outputs of sampleShark(), to avoid allocating per sample.
    hitFlag = 0;
    hitShade = 0;
    hitS = 0;
    hitV = 0;
    hitDist = 0;
    /** Cells holding a fish this frame (frame stamp); dots skip them. */
    fishStamp = new Uint32Array(0);
    frameId = 0;
    /** Fish cells bucketed by brightness, so each bucket is one fillStyle. */
    fishBuckets = FISH_ALPHAS.map(() => []);
    fishStyles = FISH_ALPHAS.map((a) => `rgba(230,238,255,${a})`);
    get cellWidth() {
      return this.cw;
    }
    get cellHeight() {
      return this.ch;
    }
    setFontFamily(family) {
      if (family) this.fontFamily = family;
    }
    resize(width, height, dpr) {
      this.width = width;
      this.height = height;
      this.dpr = dpr;
      this.cw = clamp(Math.round(width / 124), 8, 13);
      this.ch = Math.round(this.cw * 1.45);
      this.cols = Math.ceil(width / this.cw);
      this.rows = Math.ceil(height / this.ch);
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.occlusionKey = "";
      this.occluded = new Uint8Array(this.cols * this.rows);
      const n = this.cols * this.rows;
      this.dotKind = new Uint8Array(n);
      this.dotPhase = new Float32Array(n);
      this.dotFreq = new Float32Array(n);
      this.energy = new Float32Array(n);
      this.energyTmp = new Float32Array(n);
      this.heat = new Float32Array(n);
      this.bucketOf = new Uint8Array(n);
      this.bucketOrder = new Int32Array(n);
      this.sharkFlag = new Uint8Array(n);
      this.sharkShade = new Float32Array(n);
      this.sharkKey = new Uint32Array(n);
      this.sharkDepth = new Float32Array(n);
      this.sharkKind = new Uint8Array(n);
      this.sharkShadow = new Uint8Array(n);
      this.fishStamp = new Uint32Array(n);
      for (let i = 0; i < n; i++) {
        const col = i % this.cols;
        const row = i / this.cols | 0;
        this.dotKind[i] = 0;
        this.dotPhase[i] = hash3(col, row, 23) * Math.PI * 2;
        this.dotFreq[i] = 0.3 + hash3(col, row, 37) * 1.1;
      }
    }
    render(world, dt) {
      const { ctx, dpr, cols, ch } = this;
      if (cols === 0) return;
      const t = world.time;
      this.rasterizeSharks(world.sharks, t);
      if (!this.externalFieldClock) this.advanceFields(world, dt);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.markFish(world);
      this.drawDots(t);
      ctx.font = `600 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      this.drawHeat();
      this.drawFish();
      this.drawSharks(t);
    }
    // ── simulation → field ──────────────────────────────────────────────
    cellIndex(x, y) {
      const c = Math.floor(x / this.cw);
      const r = Math.floor(y / this.ch);
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
      return r * this.cols + c;
    }
    stamp(field, x, y, radius, amount) {
      const c0 = Math.floor(x / this.cw);
      const r0 = Math.floor(y / this.ch);
      for (let r = r0 - radius; r <= r0 + radius; r++) {
        for (let c = c0 - radius; c <= c0 + radius; c++) {
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const d = Math.hypot(c - c0, (r - r0) * 1.4);
          if (d > radius + 0.5) continue;
          const i = r * this.cols + c;
          field[i] = Math.min(1.6, field[i] + amount * (1 - d / (radius + 1)));
        }
      }
    }
    consumeEvents(world) {
      for (const e of world.events) {
        if (e.kind === "eat") {
          this.stamp(this.heat, e.x, e.y, 2, 1);
          this.stamp(this.energy, e.x, e.y, 3, 0.9);
        } else {
          this.stamp(this.energy, e.x, e.y, 6, 1.4);
        }
      }
      world.events.length = 0;
    }
    depositWake(world, dt = 1 / 24) {
      const scale = dt * 24;
      const { energy } = this;
      for (const f of world.fish) {
        if (!f.alive) continue;
        const i = this.cellIndex(f.x, f.y);
        if (i >= 0) energy[i] = Math.min(1.6, energy[i] + (0.012 + f.alarm * 0.03) * scale);
      }
      for (const sh of world.sharks) {
        for (let k = SHARK_NODES - 6; k < SHARK_NODES; k++) {
          const i = this.cellIndex(sh.nodes[k * 2], sh.nodes[k * 2 + 1]);
          if (i >= 0) energy[i] = Math.min(1.6, energy[i] + (0.05 + sh.speed * 12e-4) * scale);
        }
      }
      if (world.pointer.active) {
        this.stamp(energy, world.pointer.x, world.pointer.y, 1, 0.08 * scale);
      }
    }
    /** Blur + decay so wakes spread out like ripples and fade. */
    diffuse(dt) {
      const { cols, rows, energy, energyTmp: tmp, heat } = this;
      const decay = Math.exp(-dt * 1.5), mix = .25 * (1 - Math.pow(.5, dt * 24));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const l = c > 0 ? energy[i - 1] : energy[i];
          const rt = c < cols - 1 ? energy[i + 1] : energy[i];
          const u = r > 0 ? energy[i - cols] : energy[i];
          const d = r < rows - 1 ? energy[i + cols] : energy[i];
          tmp[i] = (energy[i] * (1 - 4 * mix) + (l + rt + u + d) * mix) * decay;
        }
      }
      this.energy = tmp;
      this.energyTmp = energy;
      const heatDecay = Math.exp(-dt * 2.2);
      for (let i = 0; i < heat.length; i++) heat[i] *= heatDecay;
    }
    // ── sharks ──────────────────────────────────────────────────────────
    /**
     * Classify one point against the current shark (spine/arc already built).
     * Body coordinates: s along the spine (0 snout → 1 tail), v across it.
     * Writes hit* fields and returns whether the point is on the shark.
     */
    sampleShark(px, py, L) {
      const { arc, segmentData: data, segmentGroups: groups } = this;
      let bestK = this.nearestSegment, j = bestK * 10;
      let ax = data[j], ay = data[j + 1], sx = data[j + 2], sy = data[j + 3];
      let fraction = clamp(((px - ax) * sx + (py - ay) * sy) / data[j + 4], 0, 1);
      let qx = ax + sx * fraction, qy = ay + sy * fraction;
      let best = (px - qx) ** 2 + (py - qy) ** 2;
      let bestU = fraction;
      for (let group = 0; group < 5; group++) {
        const g = group * 4;
        const ex = px < groups[g] ? groups[g] - px : px > groups[g + 1] ? px - groups[g + 1] : 0;
        const ey = py < groups[g + 2] ? groups[g + 2] - py : py > groups[g + 3] ? py - groups[g + 3] : 0;
        if (ex * ex + ey * ey > best) continue;
        for (let k = group * 4; k < Math.min(SHARK_NODES - 1, group * 4 + 4); k++) {
          if (k === this.nearestSegment) continue;
          j = k * 10;
          ax = data[j];
          ay = data[j + 1];
          sx = data[j + 2];
          sy = data[j + 3];
          fraction = clamp(((px - ax) * sx + (py - ay) * sy) / data[j + 4], 0, 1);
          qx = ax + sx * fraction;
          qy = ay + sy * fraction;
          const d2 = (px - qx) ** 2 + (py - qy) ** 2;
          if (d2 < best || d2 === best && k < bestK) {
            best = d2;
            bestK = k;
            bestU = fraction;
          }
        }
      }
      this.nearestSegment = bestK;
      j = bestK * 10;
      ax = data[j];
      ay = data[j + 1];
      sx = data[j + 2];
      sy = data[j + 3];
      const len = data[j + 5];
      const bestS = (arc[bestK] + bestU * len) / this.arcTotal;
      const bestSign = sx * (py - ay) - sy * (px - ax) >= 0 ? 1 : -1;
      const bestNx = -sy / len * bestSign, bestNy = sx / len * bestSign;
      const a = Math.sqrt(best);
      const s = bestS;
      const u = s * L;
      const shape = this.shape;
      const w = shape.halfWidth(s) * L;
      this.hitDist = a;
      this.hitS = s;
      this.hitV = a * bestSign;
      const head = this.shape.head;
      if (head && u < L * (head.sweep + head.depth + head.notch)) {
        const span = L * head.span;
        const r = a / span;
        const front = L * head.sweep * r * r + L * head.notch * Math.max(0, 1 - r / 0.14);
        const depth = L * head.depth * (1 - 0.2 * r * r * r * r);
        if (r <= 1 && u >= front && u <= front + depth) {
          this.hitFlag = r > 0.84 ? FLAG_EYE : FLAG_BODY;
          this.hitShade = r > 0.84 ? 0 : 0.62 - 0.2 * r + (u < front + L * 0.012 ? 0.1 : 0);
          return true;
        }
      }
      if (a <= w) {
        const across = a / (w || 1);
        const facing = (bestNx * -0.6 + bestNy * -0.8) * across;
        let shade = 0.58 - across * across * 0.42 + facing * 0.26;
        let flag = FLAG_BODY;
        if (s > shape.dorsal[0] && s < shape.dorsal[1] && across < 0.3) {
          flag = FLAG_RIDGE;
          shade = 1;
        } else if (s > shape.secondDorsal[0] && s < shape.secondDorsal[1] && across < 0.4) {
          shade = Math.max(shade, 0.82);
        } else if (shape.eye && s > shape.eye[0] && s < shape.eye[1] && across > 0.6) {
          flag = FLAG_EYE;
          shade = 0;
        } else if (s > shape.gills[0] && s < shape.gills[1] && across > 0.58) {
          if (Math.floor((s - shape.gills[0]) / (shape.gills[1] - shape.gills[0]) * 5) % 2 === 0) shade *= 0.45;
        } else if (s < 0.05) {
          shade = Math.max(shade, 0.7);
        } else if (shape === SHAPES.zebra && s > 0.08 && s < 0.55 && (across < 0.1 || Math.abs(across - 0.6) < 0.08)) {
          shade = Math.max(shade, 0.8);
        } else if (this.marked(s, a * bestSign, L, across)) {
          flag = FLAG_MARK;
        }
        this.hitFlag = flag;
        this.hitShade = shade;
        return true;
      }
      const tip = bestSign > 0 ? this.finTipRight : this.finTipLeft;
      const [p0, p1, p2] = shape.pectoral;
      if (inTriangle(u, a, L * p0, 0, L * p1, 0, L * p2, tip) && // Falcate (sickle) fins get a concave trailing edge.
      !(shape.falcate && inTriangle(u, a, L * p1, 0, L * (p1 + (p2 - p1) * 0.33), tip * 0.55, L * p2, tip))) {
        this.hitFlag = this.marked(s, a * bestSign, L, 0) ? FLAG_MARK : FLAG_FIN;
        this.hitShade = 0.38 + 0.22 * (1 - clamp(a / tip, 0, 1));
        return true;
      }
      const [v0, v1, v2, vr] = shape.pelvic;
      if (inTriangle(u, a, L * v0, 0, L * v1, 0, L * v2, L * vr) || // Forked caudal fin.
      shape.caudal > 0 && inTriangle(u, a, L * 0.86, 0, L * 0.95, 0, L, L * shape.caudal)) {
        this.hitFlag = FLAG_FIN;
        this.hitShade = 0.36;
        return true;
      }
      return false;
    }
    /** Whether a body point (s along, v across) falls on a dark marking. */
    marked(s, v, L, across) {
      if (this.shape === SHAPES.tiger) {
        if (s < 0.2 || s > 0.9 || across > 0.85) return false;
        const wobble = 0.35 * Math.sin(v / L * 25 + s * 5);
        const bar = Math.sin(s * Math.PI * 2 * 9 + wobble);
        return bar > 0.65 - 0.5 * smoothstep(0.2, 0.42, s) + 0.4 * smoothstep(0.8, 0.9, s);
      }
      if (this.shape === SHAPES.zebra) {
        if (s < 0.07) return false;
        const gu = s * L / (L * 0.06);
        const gv = v / (L * 0.045);
        const cu = Math.floor(gu);
        const cv = Math.floor(gv);
        const jx = hash3(cu, cv, this.sharkId) * 0.5 + 0.25;
        const jy = hash3(cu, cv, this.sharkId + 11) * 0.5 + 0.25;
        return (gu - cu - jx) ** 2 + (gv - cv - jy) ** 2 < 0.08;
      }
      return false;
    }
    /**
     * Build a smooth, undulating render spine from the sim spine, then
     * supersample every cell in the shark's bounding box against the shape.
     * Fully covered cells become solid skin; partial cells become edge glyphs.
     */
    rasterizeSharks(sharks, t) {
      const { sharkFlag, sharkShade, sharkKey, sharkDepth, sharkKind, sharkShadow, spine, arc, cw, ch, cols, rows } = this;
      sharkFlag.fill(0);
      sharkShadow.fill(0);
      for (const sh of sharks) {
        const L = sh.length;
        const N = SHARK_NODES;
        const n = sh.nodes;
        const swim = clamp(sh.speed / 60, 0.4, 1.4);
        this.shape = SHAPES[sh.kind];
        this.sharkId = sh.id;
        const kindIndex = KINDS.indexOf(sh.kind);
        for (let k = 0; k < N; k++) {
          const s = k / (N - 1);
          const a = Math.max(0, k - 1);
          const b = Math.min(N - 1, k + 1);
          let tx = n[a * 2] - n[b * 2];
          let ty = n[a * 2 + 1] - n[b * 2 + 1];
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl;
          ty /= tl;
          const amp = L * 0.05 * (0.1 + 0.9 * Math.pow(s, 1.8)) * swim;
          const off = amp * Math.sin(sh.phase - s * 5.2);
          spine[k * 2] = n[k * 2] - ty * off;
          spine[k * 2 + 1] = n[k * 2 + 1] + tx * off;
        }
        arc[0] = 0;
        for (let k = 1; k < N; k++) {
          arc[k] = arc[k - 1] + Math.hypot(spine[k * 2] - spine[(k - 1) * 2], spine[k * 2 + 1] - spine[(k - 1) * 2 + 1]);
        }
        this.arcTotal = arc[N - 1] || 1;
        for (let k = 0; k < N - 1; k++) {
          const j = k * 10, ax = spine[k * 2], ay = spine[k * 2 + 1];
          const bx = spine[(k + 1) * 2], by = spine[(k + 1) * 2 + 1];
          const sx = bx - ax, sy = by - ay, len2 = sx * sx + sy * sy || 1;
          const data = this.segmentData;
          data[j] = ax;
          data[j + 1] = ay;
          data[j + 2] = sx;
          data[j + 3] = sy;
          data[j + 4] = len2;
          data[j + 5] = Math.sqrt(len2);
          data[j + 6] = Math.min(ax, bx);
          data[j + 7] = Math.max(ax, bx);
          data[j + 8] = Math.min(ay, by);
          data[j + 9] = Math.max(ay, by);
        }
        this.nearestSegment = 0;
        for (let group = 0; group < 5; group++) {
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          for (let k = group * 4; k < Math.min(N - 1, group * 4 + 4); k++) {
            const j = k * 10, data = this.segmentData;
            x0 = Math.min(x0, data[j + 6]);
            x1 = Math.max(x1, data[j + 7]);
            y0 = Math.min(y0, data[j + 8]);
            y1 = Math.max(y1, data[j + 9]);
          }
          const g = group * 4;
          this.segmentGroups[g] = x0;
          this.segmentGroups[g + 1] = x1;
          this.segmentGroups[g + 2] = y0;
          this.segmentGroups[g + 3] = y1;
        }
        const bank = clamp(sh.turn * 0.45, -0.35, 0.35);
        const flex = 1 + 0.06 * Math.sin(sh.phase * 0.5);
        const reachFin = this.shape.pectoral[3];
        this.finTipRight = L * reachFin * flex * (1 - bank);
        this.finTipLeft = L * reachFin * flex * (1 + bank);
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let k = 0; k < N; k++) {
          minX = Math.min(minX, spine[k * 2]);
          maxX = Math.max(maxX, spine[k * 2]);
          minY = Math.min(minY, spine[k * 2 + 1]);
          maxY = Math.max(maxY, spine[k * 2 + 1]);
        }
        const reach = L * 0.36;
        const c0 = Math.max(0, Math.floor((minX - reach) / cw));
        const c1 = Math.min(cols - 1, Math.floor((maxX + reach) / cw));
        const r0 = Math.max(0, Math.floor((minY - reach) / ch));
        const r1 = Math.min(rows - 1, Math.floor((maxY + reach) / ch));
        if (c0 > c1 || r0 > r1) continue;
        const skipBeyond = reach + Math.hypot(cw, ch);
        const shadowDc = Math.round(L * 0.035 / cw) + 1;
        const shadowDr = Math.round(L * 0.02 / ch) + 1;
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            if (this.occluded[r * cols + c]) continue;
            const x = c * cw;
            const y = r * ch;
            const centerHit = this.sampleShark(x + cw / 2, y + ch / 2, L);
            if (!centerHit && this.hitDist > skipBeyond) continue;
            const flag = this.hitFlag;
            const shade = this.hitShade;
            const s = this.hitS;
            const v = this.hitV;
            let hits = centerHit ? 1 : 0;
            for (let k = 0; k < this.edgeSamples * 2; k += 2) {
              if (this.sampleShark(x + SUBSAMPLES[k] * cw, y + SUBSAMPLES[k + 1] * ch, L)) hits++;
            }
            if (hits === 0) continue;
            const coverage = hits / (1 + this.edgeSamples);
            const i = r * cols + c;
            const key = hash3(Math.round(s * 52), Math.round(v / (cw * 0.9)), sh.id) * 4294967295 >>> 0;
            sharkKey[i] = key;
            sharkDepth[i] = sh.depth;
            sharkKind[i] = kindIndex;
            if (centerHit && coverage >= 0.6) {
              sharkFlag[i] = flag;
              const flicker = (hash3(c, r, Math.floor(t * 6)) - 0.5) * 0.06;
              sharkShade[i] = clamp(shade + flicker, 0, 1);
              const sc = c + shadowDc;
              const sr = r + shadowDr;
              if (sc < cols && sr < rows) sharkShadow[sr * cols + sc] = 1;
            } else {
              sharkFlag[i] = FLAG_EDGE;
              sharkShade[i] = coverage;
            }
          }
        }
      }
    }
    drawSharks(t) {
      const { ctx, cols, rows, cw, ch, sharkFlag, sharkShade, sharkKey, sharkDepth, sharkKind } = this;
      const n = cols * rows;
      for (let i = 0; i < n; i++) {
        const flag = sharkFlag[i];
        if (!flag) continue;
        const col = i % cols;
        const row = i / cols | 0;
        const x = col * cw;
        const y = row * ch;
        const key = sharkKey[i];
        const shade = sharkShade[i];
        const dim = 0.7 + 0.3 * sharkDepth[i];
        const [tr, tg, tb] = this.bodyTint || SHAPES[KINDS[sharkKind[i]]].tint;
        const tick = Math.floor(t * 2.4 + key % 997 / 97);
        const roll = hash3(key, tick, 7);
        if (flag === FLAG_EDGE) {
          const set = shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
          const g = (70 + shade * 80) * dim;
          ctx.fillStyle = roll < 0.07 ? (this.paletteAccents || ACCENTS)[key % (this.paletteAccents || ACCENTS).length] : `rgb(${Math.round(g * tr)},${Math.round(g * tg)},${Math.min(255, Math.round(g * tb + 6))})`;
          ctx.fillText(set[(key >>> 8) % set.length], x + cw / 2, y + ch / 2 + 1);
          continue;
        }
        let level;
        let glyph;
        if (flag === FLAG_RIDGE) {
          level = 226;
          glyph = RIDGE_GLYPHS[(key >>> 8) % RIDGE_GLYPHS.length];
        } else if (flag === FLAG_EYE) {
          level = 12;
          glyph = "o";
        } else if (flag === FLAG_MARK) {
          level = 24 + shade * 22;
          glyph = MARK_GLYPHS[(key >>> 8) % MARK_GLYPHS.length];
        } else if (flag === FLAG_FIN) {
          level = 40 + shade * 120;
          glyph = FIN_GLYPHS[(key >>> 8) % FIN_GLYPHS.length];
        } else {
          level = 46 + shade * 160;
          const jitter = (key >>> 4) % 3 - 1;
          glyph = SKIN_RAMP[clamp(Math.floor((1 - shade) * 8.99) + jitter, 0, SKIN_RAMP.length - 1)];
        }
        level *= dim;
        ctx.fillStyle = `rgb(${Math.min(255, Math.round(level * tr))},${Math.min(255, Math.round(level * tg))},${Math.min(255, Math.round(level * tb + 4))})`;
        ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);
        let color;
        if (flag === FLAG_EYE) color = "#9aa0ad";
        else if (flag === FLAG_MARK) color = `rgb(${Math.round(70 * tr)},${Math.round(70 * tg)},${Math.round(70 * tb)})`;
        else if (roll < 0.09) color = (this.paletteAccents || ACCENTS)[key % (this.paletteAccents || ACCENTS).length];
        else if (roll < 0.13) color = "#ffffff";
        else color = shade > 0.55 ? "#0e0f13" : "#1b1d24";
        ctx.fillStyle = color;
        ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
      }
    }
    // ── fish, dots, heat ────────────────────────────────────────────────
    /**
     * Snap each fish to a cell and bucket it by brightness: far fish are dim,
     * near fish brighter, and turning or panicking fish glint. Nearer fish
     * claim a cell first when two land in the same one.
     */
    markFish(world) {
      const { fishStamp, fishBuckets, sharkFlag } = this;
      const frame = ++this.frameId;
      for (const bucket of fishBuckets) bucket.length = 0;
      for (let pass = 0; pass < 2; pass++) {
        for (const f of world.fish) {
          if (!f.alive || (f.depth > 0.78 ? 0 : 1) !== pass) continue;
          const i = this.cellIndex(f.x, f.y);
          if (i < 0 || fishStamp[i] === frame || sharkFlag[i]) continue;
          fishStamp[i] = frame;
          const glint = clamp(Math.abs(f.turn) / 3.5, 0, 1);
          const v = 0.3 + 0.4 * (f.depth - 0.55) / 0.45 + 0.3 * Math.max(glint, f.alarm);
          fishBuckets[clamp(Math.floor(v * FISH_ALPHAS.length), 0, FISH_ALPHAS.length - 1)].push(i);
        }
      }
    }
    drawFish() {
      const { ctx, cw, ch, cols, fishBuckets } = this;
      for (let b = 0; b < fishBuckets.length; b++) {
        const bucket = fishBuckets[b];
        if (!bucket.length) continue;
        ctx.fillStyle = this.fishStyles[b];
        for (const i of bucket) {
          if (this.occluded[i]) continue;
          ctx.fillText("-", i % cols * cw + cw / 2, (i / cols | 0) * ch + ch / 2 + 1);
        }
      }
    }
    drawHeat() {
      const { ctx, heat, cols, cw, ch } = this;
      for (let i = 0; i < heat.length; i++) {
        if (this.occluded[i]) continue;
        const h = heat[i];
        if (h < 0.08) continue;
        const col = i % cols;
        const row = i / cols | 0;
        ctx.fillStyle = h > 0.5 ? `rgba(255,120,60,${h.toFixed(2)})` : `rgba(220,40,40,${(h * 1.6).toFixed(2)})`;
        ctx.fillText(h > 0.6 ? "*" : "\xB7", col * cw + cw / 2, row * ch + ch / 2 + 1);
      }
    }
    /**
     * Every cell's dot twinkles on its own clock, is modulated by slow
     * caustic light bands, and flares cyan where the wake field is strong.
     * Dots are bucketed by colour/alpha so each bucket is one fillStyle.
     */
    drawDots(t) {
      const { ctx, cols, rows, cw, ch, dotKind, dotPhase, dotFreq, energy, sharkFlag, sharkShadow, fishStamp, frameId } = this;
      const { bucketOf, bucketOrder, bucketCounts } = this;
      const n = cols * rows;
      const SKIP = bucketCounts.length - 1;
      bucketCounts.fill(0);
      for (let i = 0; i < n; i++) {
        const e = energy[i];
        const kind = dotKind[i];
        if (this.occluded[i] || sharkFlag[i] || fishStamp[i] === frameId || kind === 0 && e < 0.45) {
          bucketOf[i] = SKIP;
          continue;
        }
        let bucket;
        if (e > 0.45) {
          const level = clamp(Math.floor((e - 0.45) * 5), 0, ALPHA_LEVELS - 1);
          bucket = WAKE * ALPHA_LEVELS + level;
        } else {
          const col = i % cols;
          const row = i / cols | 0;
          const twinkle = 0.5 + 0.5 * Math.sin(t * dotFreq[i] + dotPhase[i]);
          const caustic = 0.85 + 0.15 * Math.sin(col * 0.11 + t * 0.35) * Math.sin(row * 0.17 - t * 0.27);
          let v = clamp((0.55 + 0.45 * twinkle) * caustic + e * 2, 0, 1);
          if (sharkShadow[i]) v *= 0.2;
          bucket = (kind - 1) * ALPHA_LEVELS + clamp(Math.floor(v * ALPHA_LEVELS), 0, ALPHA_LEVELS - 1);
        }
        bucketOf[i] = bucket;
        bucketCounts[bucket]++;
      }
      const starts = this.dotStarts;
      for (let b = 1; b < bucketCounts.length; b++) starts[b] = starts[b - 1] + bucketCounts[b - 1];
      const cursor = this.dotCursor;
      cursor.set(starts);
      for (let i = 0; i < n; i++) {
        const b = bucketOf[i];
        if (b !== SKIP) bucketOrder[cursor[b]++] = i;
      }
      const small = Math.max(2, Math.round(cw * 0.19));
      const large = small + 1;
      for (let b = 0; b < SKIP; b++) {
        const count = bucketCounts[b];
        if (!count) continue;
        ctx.fillStyle = this.dotStyles[b];
        const size = b >= WAKE * ALPHA_LEVELS ? large : small;
        const start = starts[b];
        for (let k = start; k < start + count; k++) {
          const i = bucketOrder[k];
          const col = i % cols;
          const row = i / cols | 0;
          ctx.fillRect(Math.round(col * cw + cw * 0.66 - size / 2), Math.round(row * ch + ch * 0.64 - size / 2), size, size);
        }
      }
    }
  };


    return { World, AsciiRenderer, SHAPES, KINDS, ACCENTS };
  }
  const oceanModel = oceanModelFactory();
  const { World, AsciiRenderer } = oceanModel;
  // Canvas-compatible drawing batch: identical glyphs/colors, one GPU draw batch.
  // Geometry classification remains in the shared renderer, preserving species.
  // All grid classification, wake diffusion and composition stay on the GPU.
  // The CPU only uploads the small skeleton, sparse impulses and fish cells.
  function createOceanComputeRenderer(canvas, renderer, model) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('Floating-point GPU render targets unavailable');
    const COMMON = "precision highp float;\nprecision highp int;\nprecision highp usampler2D;\nuniform sampler2D segmentsTex;\nuniform vec4 meta[40];\nuniform ivec2 grid;\nuniform vec2 cellSize;\nuniform int sharkCount;\nuniform float time;\nuniform int flickerTick;\nconst float PI=3.141592653589793;\nuint hash32(uint x,uint y,uint z){uint h=x*374761393u^y*668265263u^z*1442695041u;h=(h^(h>>13u))*1274126177u;return h^(h>>16u);}\nfloat hash3(int x,int y,int z){return float(hash32(uint(x),uint(y),uint(z)))*(1./4294967296.);}\nfloat classicWidth(float s){if(s<.13)return .09*pow(sin(s/.13*PI*.5),.95);if(s<.3)return .09+.016*smoothstep(.13,.3,s);if(s<.84)return .019+.087*pow(max(0.,1.-(s-.3)/.54),1.25);float k=(s-.84)/.16;return .019*(1.-k)+.012*sin(k*PI);}\nfloat halfWidth(int kind,float s){\n if(kind==0)return classicWidth(s);\n if(kind==1){if(s<.06)return .045;if(s<.3)return .045+.061*smoothstep(.06,.3,s);return classicWidth(s)*.92;}\n if(kind==2){if(s<.13)return .1*pow(sin(s/.13*PI*.5),.45);if(s<.3)return .1+.014*smoothstep(.13,.3,s);if(s<.84)return .019+.095*pow(max(0.,1.-(s-.3)/.54),1.2);float k=(s-.84)/.16;return .019*(1.-k)+.012*sin(k*PI);}\n if(kind==3){if(s<.1)return .075*pow(sin(s/.1*PI*.5),.7);if(s<.28)return .075+.025*smoothstep(.1,.28,s);if(s<.55)return .022+.078*pow(max(0.,1.-(s-.28)/.27),1.1);float k=(s-.55)/.45;return .022*(1.-k*k)+.012*sin(k*PI);}\n if(kind==4){if(s<.05)return .04;if(s<.3)return .04+.07*smoothstep(.05,.3,s);return classicWidth(s)*.95;}\n if(kind==5){if(s<.17)return .088*pow(sin(s/.17*PI*.5),1.5);if(s<.32)return .088+.012*smoothstep(.17,.32,s);if(s<.86)return .014+.086*pow(max(0.,1.-(s-.32)/.54),1.45);float k=(s-.86)/.14;return .014*(1.-k)+.01*sin(k*PI);}\n if(kind==6){if(s<.08)return .07*pow(sin(s/.08*PI*.5),.75);if(s<.2)return .07+.02*smoothstep(.08,.2,s);if(s<.48)return .012+.078*pow(max(0.,1.-(s-.2)/.28),1.3);float k=(s-.48)/.52;return .012*(1.-k)+.006*sin(k*PI*.9)+.002;}\n if(s<.08)return .085*pow(sin(s/.08*PI*.5),.4);if(s<.3)return .085+.02*smoothstep(.08,.3,s);if(s<.72)return .022+.083*pow(max(0.,1.-(s-.3)/.42),1.1);float k=(s-.72)/.28;return .022*(1.-k*k)+.014*sin(k*PI);\n}\nbool triangle(vec2 p,vec2 a,vec2 b,vec2 c){float d1=(p.x-b.x)*(a.y-b.y)-(a.x-b.x)*(p.y-b.y),d2=(p.x-c.x)*(b.y-c.y)-(b.x-c.x)*(p.y-c.y),d3=(p.x-a.x)*(c.y-a.y)-(c.x-a.x)*(p.y-a.y);return !((d1<0.||d2<0.||d3<0.)&&(d1>0.||d2>0.||d3>0.));}\nbool marked(int kind,int id,float s,float v,float L,float across){\n if(kind==2){if(s<.2||s>.9||across>.85)return false;float wobble=.35*sin(v/L*25.+s*5.),bar=sin(s*PI*2.*9.+wobble);return bar>.65-.5*smoothstep(.2,.42,s)+.4*smoothstep(.8,.9,s);}\n if(kind==3){if(s<.07)return false;float gu=s/.06,gv=v/(L*.045);ivec2 c=ivec2(floor(vec2(gu,gv)));float jx=hash3(c.x,c.y,id)*.5+.25,jy=hash3(c.x,c.y,id+11)*.5+.25;vec2 q=vec2(gu,gv)-vec2(c)-vec2(jx,jy);return dot(q,q)<.08;}return false;\n}\n// x=flag, y=shade, z=longitudinal coordinate, w=signed distance.\nvec4 sampleShark(vec2 p,int sh){\n int base=sh*10,kind=int(meta[base].y),id=int(meta[base].z),bestK=0;float L=meta[base].x,best=1e30,bestU=0.;\n vec4 selected=vec4(0.),selectedLength=vec4(0.);\n for(int k=0;k<19;k++){\n  vec4 a=texelFetch(segmentsTex,ivec2(k,sh*2),0),b=texelFetch(segmentsTex,ivec2(k,sh*2+1),0);\n  float f=clamp(dot(p-a.xy,a.zw)/b.z,0.,1.);vec2 q=a.xy+a.zw*f;float d2=dot(p-q,p-q);\n  if(d2<best){best=d2;bestK=k;bestU=f;selected=a;selectedLength=b;}\n }\n float s=(selectedLength.x+bestU*selectedLength.y)/meta[base+6].z;\n float signV=selected.z*(p.y-selected.y)-selected.w*(p.x-selected.x)>=0.?1.:-1.;\n vec2 normal=vec2(-selected.w,selected.z)/selectedLength.y*signV;\n float a=sqrt(best),u=s*L,w=halfWidth(kind,s)*L;vec4 head=meta[base+5];\n if(head.x>0.&&u<L*(head.y+head.z+head.w)){\n  float r=a/(L*head.x),front=L*head.y*r*r+L*head.w*max(0.,1.-r/.14),depth=L*head.z*(1.-.2*r*r*r*r);\n  if(r<=1.&&u>=front&&u<=front+depth)return vec4(r>.84?5.:1.,r>.84?0.:.62-.2*r+(u<front+L*.012?.1:0.),s,a*signV);\n }\n if(a<=w){float across=a/(w==0.?1.:w),facing=dot(normal,vec2(-.6,-.8))*across,shade=.58-across*across*.42+facing*.26;float flag=1.;vec4 dorsal=meta[base+3],eyeGill=meta[base+4];\n  if(s>dorsal.x&&s<dorsal.y&&across<.3){flag=4.;shade=1.;}\n  else if(s>dorsal.z&&s<dorsal.w&&across<.4)shade=max(shade,.82);\n  else if(eyeGill.x>=0.&&s>eyeGill.x&&s<eyeGill.y&&across>.6){flag=5.;shade=0.;}\n  else if(s>eyeGill.z&&s<eyeGill.w&&across>.58){if(int(floor((s-eyeGill.z)/(eyeGill.w-eyeGill.z)*5.))%2==0)shade*=.45;}\n  else if(s<.05)shade=max(shade,.7);\n  else if(kind==3&&s>.08&&s<.55&&(across<.1||abs(across-.6)<.08))shade=max(shade,.8);\n  else if(marked(kind,id,s,a*signV,L,across))flag=6.;\n  return vec4(flag,shade,s,a*signV);\n }\n float tip=signV>0.?meta[base+6].y:meta[base+6].x;vec4 fin=meta[base+1],pelvic=meta[base+2];\n if(triangle(vec2(u,a),vec2(L*fin.x,0),vec2(L*fin.y,0),vec2(L*fin.z,tip))&&!(meta[base+8].w>.5&&triangle(vec2(u,a),vec2(L*fin.y,0),vec2(L*(fin.y+(fin.z-fin.y)*.33),tip*.55),vec2(L*fin.z,tip))))return vec4(marked(kind,id,s,a*signV,L,0.)?6.:3.,.38+.22*(1.-clamp(a/tip,0.,1.)),s,a*signV);\n if(triangle(vec2(u,a),vec2(L*pelvic.x,0),vec2(L*pelvic.y,0),vec2(L*pelvic.z,L*pelvic.w))||(meta[base+6].w>0.&&triangle(vec2(u,a),vec2(L*.86,0),vec2(L*.95,0),vec2(L,L*meta[base+6].w))))return vec4(3.,.36,s,a*signV);\n return vec4(0.,0.,s,a*signV);\n}\n";
    const CLASSIFY = "uniform usampler2D occlusionTex;\nuniform int edgeSamples;\nlayout(location=0) out uvec4 classified;\nvoid main(){\n ivec2 c=ivec2(gl_FragCoord.xy);classified=uvec4(0);if(texelFetch(occlusionTex,c,0).r!=0u)return;\n uint bodyFlags=0u;vec2 offsets[4]=vec2[4](vec2(.25,.3),vec2(.75,.3),vec2(.25,.72),vec2(.75,.72));\n for(int sh=0;sh<4;sh++){\n  if(sh>=sharkCount)break;vec4 bounds=meta[sh*10+7];if(float(c.x)<bounds.x||float(c.x)>bounds.y||float(c.y)<bounds.z||float(c.y)>bounds.w)continue;\n  vec2 origin=vec2(c)*cellSize;vec4 center=sampleShark(origin+cellSize*.5,sh);\n  bool centerHit=center.x>0.;if(!centerHit&&abs(center.w)>meta[sh*10].x*.36+length(cellSize))continue;\n  int hits=centerHit?1:0;for(int i=0;i<4;i++){if(i>=edgeSamples)break;if(sampleShark(origin+offsets[i]*cellSize,sh).x>0.)hits++;}\n  if(hits==0)continue;float coverage=float(hits)/float(edgeSamples+1);\n  uint h=hash32(uint(int(floor(center.z*52.+.5))),uint(int(floor(center.w/(cellSize.x*.9)+.5))),uint(meta[sh*10].z));uint key=h==0u?0u:h-1u;\n  uint flag=2u;float shade=coverage;\n  if(centerHit&&coverage>=.6){flag=uint(center.x);shade=clamp(center.y+(hash3(c.x,c.y,flickerTick)-.5)*.06,0.,1.);bodyFlags|=1u<<uint(sh);}\n  classified=uvec4(flag,key,floatBitsToUint(shade),uint(sh+1));\n }\n classified.r|=bodyFlags<<8u;\n}\n";
    const FIELDS = "uniform sampler2D previousTex;\nuniform sampler2D depositTex;\nuniform float dt;\nlayout(location=0) out vec2 field;\nvec2 added(ivec2 p){p=clamp(p,ivec2(0),grid-1);return min(vec2(1.6),texelFetch(previousTex,p,0).rg+texelFetch(depositTex,p,0).rg);}\nvoid main(){ivec2 p=ivec2(gl_FragCoord.xy);vec2 center=added(p);float mixAmount=.25*(1.-pow(.5,dt*24.));float neighbors=added(p+ivec2(-1,0)).r+added(p+ivec2(1,0)).r+added(p+ivec2(0,-1)).r+added(p+ivec2(0,1)).r;field=vec2((center.r*(1.-4.*mixAmount)+neighbors*mixAmount)*exp(-dt*1.5),center.g*exp(-dt*2.2));}\n";
    let DRAW = "uniform usampler2D classifiedTex;\nuniform usampler2D fishTex;\nuniform usampler2D occlusionTex;\nuniform sampler2D fieldTex;\nuniform sampler2D dotsTex;\nuniform sampler2D atlasTex;\nuniform vec2 viewport;\nuniform float dpr;\nuniform float atlasCell;\nuniform ivec2 atlasSize;\nuniform vec4 fishColors[5];\nuniform vec4 dotColors[30];\nuniform vec4 accentColors[7];\nuniform int accentCount;\nout vec4 pixel;\n// __GLYPH_CONSTANTS__\nfloat rectCoverage(vec2 p,vec4 rect){vec2 v=clamp(min(p+.5,rect.xy+rect.zw)-max(p-.5,rect.xy),0.,1.);return v.x*v.y;}\nfloat glyphMask(int glyph,vec2 p,vec2 anchor){\n ivec2 point=ivec2(floor(anchor*8.+.5)),phase=(point%8+8)%8;int index=glyph*64+phase.y*8+phase.x;\n vec2 center=floor(vec2(atlasCell*.5))+vec2(phase)/8.,top=vec2(point)/8.-center,local=p-top;\n if(any(lessThan(local,vec2(0.)))||any(greaterThanEqual(local,vec2(atlasCell))))return 0.;\n ivec2 origin=ivec2(index%32,index/32)*int(atlasCell);return texelFetch(atlasTex,origin+ivec2(floor(local)),0).a;\n}\nvec4 over(vec4 back,vec4 color,float coverage){float a=clamp(color.a,0.,1.)*coverage;return vec4(color.rgb*a,a)+back*(1.-a);}\n// Antialiased rectangles can cover a fraction of the next cell's first pixel.\n// Keep those contributions; dropping them would thin the original cell edges.\nvec4 neighborBackground(vec4 back,ivec2 c,vec2 p){\n if(any(lessThan(c,ivec2(0)))||any(greaterThanEqual(c,grid))||texelFetch(occlusionTex,c,0).r!=0u)return back;\n uvec4 data=texelFetch(classifiedTex,c,0);uint flag=data.r&255u;if(flag==0u||flag==2u)return back;\n float shade=uintBitsToFloat(data.b),dim=.7+.3*meta[(int(data.a)-1)*10].w,level=flag==4u?226.:flag==5u?12.:flag==6u?24.+shade*22.:flag==3u?40.+shade*120.:46.+shade*160.;\n vec3 tint=meta[(int(data.a)-1)*10+8].rgb,col=min(vec3(255.),floor(level*dim*tint+vec3(0,0,4)+.5))/255.;\n return over(back,vec4(col,1.),rectCoverage(p,vec4((vec2(c)*cellSize+1.)*dpr,(cellSize-1.)*dpr)));\n}\nvoid main(){\n vec2 p=vec2(gl_FragCoord.x,viewport.y-gl_FragCoord.y),css=p/dpr;ivec2 c=ivec2(floor(css/cellSize));pixel=vec4(0.);\n if(any(greaterThanEqual(c,grid))||texelFetch(occlusionTex,c,0).r!=0u)return;\n vec2 origin=vec2(c)*cellSize,anchor=(origin+cellSize*.5+vec2(0,1))*dpr;\n uvec4 cell=texelFetch(classifiedTex,c,0);uint flag=cell.r&255u;float energy=texelFetch(fieldTex,c,0).r,heat=texelFetch(fieldTex,c,0).g;uint fish=flag==0u?texelFetch(fishTex,c,0).r:0u;\n vec3 dots=texelFetch(dotsTex,c,0).rgb;\n if(flag==0u&&fish==0u&&!(dots.z==0.&&energy<=.45)){\n  int bucket;\n  if(energy>.45)bucket=24+clamp(int(floor((energy-.45)*5.)),0,5);\n  else{float twinkle=.5+.5*sin(time*dots.y+dots.x),caustic=.85+.15*sin(float(c.x)*.11+time*.35)*sin(float(c.y)*.17-time*.27);float v=clamp((.55+.45*twinkle)*caustic+energy*2.,0.,1.);bool shadow=false;\n   for(int sh=0;sh<4;sh++){if(sh>=sharkCount)break;ivec2 q=c-ivec2(meta[sh*10+9].xy);if(all(greaterThanEqual(q,ivec2(0)))&&all(lessThan(q,grid))&&((texelFetch(classifiedTex,q,0).r>>(8u+uint(sh)))&1u)!=0u)shadow=true;}\n   if(shadow)v*=.2;bucket=(int(dots.z)-1)*6+clamp(int(floor(v*6.)),0,5);\n  }\n  if(bucket>=0&&bucket<30){float side=max(2.,floor(cellSize.x*.19+.5))+(bucket>=24?1.:0.);vec2 xy=floor(origin+cellSize*vec2(.66,.64)-side*.5+.5);pixel=over(pixel,dotColors[bucket],rectCoverage(p,vec4(xy*dpr,vec2(side*dpr))));}\n }\n if(heat>=.08){float a=floor((heat>.5?heat:heat*1.6)*100.+.5)/100.;pixel=over(pixel,vec4(heat>.5?vec3(1.,120./255.,60./255.):vec3(220./255.,40./255.,40./255.),a),glyphMask(heat>.6?G_STAR:G_MIDDOT,p,anchor));}\n if(fish>0u)pixel=over(pixel,fishColors[int(fish)-1],glyphMask(G_DASH,p,anchor));\n bool fromLeft=css.x-origin.x<.5/dpr,fromAbove=css.y-origin.y<.5/dpr;\n if(fromLeft&&fromAbove)pixel=neighborBackground(pixel,c-ivec2(1,1),p);\n if(fromAbove)pixel=neighborBackground(pixel,c-ivec2(0,1),p);\n if(fromLeft)pixel=neighborBackground(pixel,c-ivec2(1,0),p);\n if(flag==0u)return;\n int sh=int(cell.a)-1;float shade=uintBitsToFloat(cell.b),dim=.7+.3*meta[sh*10].w;vec3 tint=meta[sh*10+8].rgb;uint key=cell.g;\n int tick=int(floor(time*2.4+float(key%997u)/97.));float roll=float(hash32(key,uint(tick),7u))*(1./4294967296.);int accent=int(key%uint(accentCount));\n if(flag==2u){float g=(70.+shade*80.)*dim;vec3 col=roll<.07?accentColors[accent].rgb:vec3(floor(g*tint.r+.5),floor(g*tint.g+.5),min(255.,floor(g*tint.b+6.+.5)))/255.;int glyph=shade>=.5?EDGE_HEAVY[int((key>>8u)%2u)]:EDGE_LIGHT[int((key>>8u)%4u)];pixel=over(pixel,vec4(col,1.),glyphMask(glyph,p,anchor));return;}\n float level;int glyph;\n if(flag==4u){level=226.;glyph=RIDGE[int((key>>8u)%3u)];}\n else if(flag==5u){level=12.;glyph=G_EYE;}\n else if(flag==6u){level=24.+shade*22.;glyph=MARK[int((key>>8u)%3u)];}\n else if(flag==3u){level=40.+shade*120.;glyph=FIN[int((key>>8u)%5u)];}\n else{level=46.+shade*160.;int jitter=int((key>>4u)%3u)-1;glyph=RAMP[clamp(int(floor((1.-shade)*8.99))+jitter,0,8)];}\n level*=dim;vec3 background=min(vec3(255.),floor(level*tint+vec3(0,0,4)+.5))/255.;pixel=over(pixel,vec4(background,1.),rectCoverage(p,vec4((origin+1.)*dpr,(cellSize-1.)*dpr)));\n vec3 color;\n if(flag==5u)color=vec3(154.,160.,173.)/255.;else if(flag==6u)color=floor(70.*tint+.5)/255.;else if(roll<.09)color=accentColors[accent].rgb;else if(roll<.13)color=vec3(1.);else color=shade>.55?vec3(14.,15.,19.)/255.:vec3(27.,29.,36.)/255.;\n pixel=over(pixel,vec4(color,1.),glyphMask(glyph,p,anchor));\n}\n";
    const chars = [...new Set(":;t%SX8#@o.',`-*·?")];
    const array = (name, value) => `const int ${name}[${value.length}]=int[${value.length}](${[...value].map(c => chars.indexOf(c)).join(',')});`;
    DRAW = DRAW.replace('// __GLYPH_CONSTANTS__', [array('RAMP', ':;t%SX8#@'), array('FIN', '%;tS:'), array('RIDGE', '@8%'), array('MARK', '#%@'), array('EDGE_HEAVY', ':;'), array('EDGE_LIGHT', ".',`"), ...[['G_STAR', '*'], ['G_MIDDOT', '·'], ['G_DASH', '-'], ['G_EYE', 'o']].map(([name, glyph]) => `const int ${name}=${chars.indexOf(glyph)};`)].join('\n'));
    const shader = (type, source) => {
      const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const vertex = shader(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2(float(gl_VertexID&1),float(gl_VertexID>>1));gl_Position=vec4(p*2.-1.,0,1);}');
    function program(fragment) {
      const value = gl.createProgram(), fs = shader(gl.FRAGMENT_SHADER, '#version 300 es\n' + COMMON + '\n' + fragment);
      gl.attachShader(value, vertex); gl.attachShader(value, fs); gl.linkProgram(value); gl.deleteShader(fs);
      if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(value));
      const uniforms = new Map();
      return { value, location(name) { if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(value, name)); return uniforms.get(name); } };
    }
    const classify = program(CLASSIFY), fields = program(FIELDS), draw = program(DRAW); gl.deleteShader(vertex);
    const vao = gl.createVertexArray();
    const segments = new Float32Array(19 * 8 * 4), metadata = new Float32Array(160), spine = new Float32Array(40), arc = new Float32Array(20);
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const segmentTexture = texture(gl.RGBA32F, 19, 8, gl.RGBA, gl.FLOAT, segments);
    let cols = 0, rows = 0, classTexture, classFbo, occlusion, fishTexture, dotTexture, depositTexture, fieldTextures = [], fieldFbos = [], current = 0;
    let deposits, fishCells, dotData, occlusionVersion = null, atlas = null, atlasCell = 0, atlasWidth = 0, atlasHeight = 0, atlasKey = '';
    let frameCount = 0, cpuMs = 0;
    function texture(internal, width, height, format, type, data = null) {
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    }
    function framebuffer(tex) {
      const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('GPU framebuffer incomplete');
      return fbo;
    }
    function bind(p, name, tex, unit) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(p.location(name), unit); }
    function common(p, world) {
      gl.useProgram(p.value); gl.bindVertexArray(vao); gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST);
      gl.uniform2i(p.location('grid'), cols, rows); gl.uniform2f(p.location('cellSize'), renderer.cw, renderer.ch);
      gl.uniform4fv(p.location('meta[0]'), metadata); gl.uniform1i(p.location('sharkCount'), Math.min(4, world.sharks.length));
      gl.uniform1f(p.location('time'), world.time); gl.uniform1i(p.location('flickerTick'), Math.floor(world.time * 6));
    }
    function ensureSize() {
      if (cols === renderer.cols && rows === renderer.rows) return;
      for (const tex of [classTexture, occlusion, fishTexture, dotTexture, depositTexture, ...fieldTextures]) if (tex) gl.deleteTexture(tex);
      for (const fbo of [classFbo, ...fieldFbos]) if (fbo) gl.deleteFramebuffer(fbo);
      cols = renderer.cols; rows = renderer.rows; const n = cols * rows;
      deposits = new Float32Array(n * 2); fishCells = new Uint8Array(n); dotData = new Float32Array(n * 4);
      classTexture = texture(gl.RGBA32UI, cols, rows, gl.RGBA_INTEGER, gl.UNSIGNED_INT); classFbo = framebuffer(classTexture);
      occlusion = texture(gl.R8UI, cols, rows, gl.RED_INTEGER, gl.UNSIGNED_BYTE);
      fishTexture = texture(gl.R8UI, cols, rows, gl.RED_INTEGER, gl.UNSIGNED_BYTE);
      for (let i = 0; i < n; i++) { dotData[i * 4] = renderer.dotPhase[i]; dotData[i * 4 + 1] = renderer.dotFreq[i]; dotData[i * 4 + 2] = renderer.dotKind[i]; }
      dotTexture = texture(gl.RGBA32F, cols, rows, gl.RGBA, gl.FLOAT, dotData);
      depositTexture = texture(gl.RG32F, cols, rows, gl.RG, gl.FLOAT);
      fieldTextures = [0, 1].map(() => texture(gl.RG32F, cols, rows, gl.RG, gl.FLOAT)); fieldFbos = fieldTextures.map(framebuffer); current = 0; occlusionVersion = null;
    }
    function ensureAtlas() {
      const dpr = renderer.dpr, size = Math.round(renderer.ch * .74), key = `${size}:${dpr}:${renderer.fontFamily}`;
      if (key === atlasKey) return; atlasKey = key;
      atlasCell = Math.ceil(size * dpr * 2 + 8); atlasWidth = atlasCell * 32; atlasHeight = atlasCell * Math.ceil(chars.length * 64 / 32);
      const image = new OffscreenCanvas(atlasWidth, atlasHeight), ctx = image.getContext('2d');
      ctx.font = `600 ${size}px ${renderer.fontFamily}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let ch = 0; ch < chars.length; ch++) for (let phase = 0; phase < 64; phase++) {
        const i = ch * 64 + phase, x = i % 32 * atlasCell, y = Math.floor(i / 32) * atlasCell;
        ctx.fillText(chars[ch], (x + Math.floor(atlasCell / 2) + phase % 8 / 8) / dpr, (y + Math.floor(atlasCell / 2) + Math.floor(phase / 8) / 8) / dpr);
      }
      if (atlas) gl.deleteTexture(atlas); atlas = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    const colors = new Map();
    function color(value) {
      if (colors.has(value)) return colors.get(value); let out;
      if (/^#[\da-f]{6}$/i.test(value)) out = [parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255, 1];
      else { const n = value.match(/[\d.]+/g)?.map(Number); out = n?.length >= 3 ? [n[0] / 255, n[1] / 255, n[2] / 255, n[3] ?? 1] : [1, 1, 1, 1]; }
      if (colors.size > 128) colors.clear(); colors.set(value, out); return out;
    }
    function skeleton(world) {
      metadata.fill(0);
      for (let sh = 0; sh < Math.min(4, world.sharks.length); sh++) {
        const s = world.sharks[sh], n = s.nodes, L = s.length, shape = model.SHAPES[s.kind], base = sh * 40;
        for (let k = 0; k < 20; k++) {
          const a = Math.max(0, k - 1), b = Math.min(19, k + 1), tx = n[a * 2] - n[b * 2], ty = n[a * 2 + 1] - n[b * 2 + 1], length = Math.hypot(tx, ty) || 1;
          const amp = L * .05 * (.1 + .9 * Math.pow(k / 19, 1.8)) * clamp(s.speed / 60, .4, 1.4), offset = amp * Math.sin(s.phase - k / 19 * 5.2);
          spine[k * 2] = n[k * 2] - ty / length * offset; spine[k * 2 + 1] = n[k * 2 + 1] + tx / length * offset;
        }
        arc[0] = 0; for (let k = 1; k < 20; k++) arc[k] = arc[k - 1] + Math.hypot(spine[k * 2] - spine[k * 2 - 2], spine[k * 2 + 1] - spine[k * 2 - 1]);
        for (let k = 0; k < 19; k++) {
          const a = (sh * 2 * 19 + k) * 4, b = a + 19 * 4, x = spine[k * 2], y = spine[k * 2 + 1], dx = spine[k * 2 + 2] - x, dy = spine[k * 2 + 3] - y;
          segments.set([x, y, dx, dy], a); segments.set([arc[k], Math.sqrt(dx * dx + dy * dy || 1), dx * dx + dy * dy || 1, 0], b);
        }
        const bank = clamp(s.turn * .45, -.35, .35), flex = 1 + .06 * Math.sin(s.phase * .5), fin = L * shape.pectoral[3] * flex;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let k = 0; k < 20; k++) { minX = Math.min(minX, spine[k * 2]); maxX = Math.max(maxX, spine[k * 2]); minY = Math.min(minY, spine[k * 2 + 1]); maxY = Math.max(maxY, spine[k * 2 + 1]); }
        metadata.set([L, model.KINDS.indexOf(s.kind), s.id, s.depth], base);
        metadata.set(shape.pectoral, base + 4); metadata.set(shape.pelvic, base + 8); metadata.set([...shape.dorsal, ...shape.secondDorsal], base + 12);
        metadata.set([...(shape.eye || [-1, -1]), ...shape.gills], base + 16);
        if (shape.head) metadata.set([shape.head.span, shape.head.sweep, shape.head.depth, shape.head.notch], base + 20);
        metadata.set([fin * (1 + bank), fin * (1 - bank), arc[19] || 1, shape.caudal], base + 24);
        metadata.set([Math.max(0, Math.floor((minX - L * .36) / renderer.cw)), Math.min(cols - 1, Math.floor((maxX + L * .36) / renderer.cw)), Math.max(0, Math.floor((minY - L * .36) / renderer.ch)), Math.min(rows - 1, Math.floor((maxY + L * .36) / renderer.ch))], base + 28);
        metadata.set([...(renderer.bodyTint || shape.tint), shape.falcate ? 1 : 0], base + 32);
        metadata.set([Math.round(L * .035 / renderer.cw) + 1, Math.round(L * .02 / renderer.ch) + 1, 0, 0], base + 36);
      }
      gl.bindTexture(gl.TEXTURE_2D, segmentTexture); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 19, 8, gl.RGBA, gl.FLOAT, segments);
    }
    function index(x, y) { const c = Math.floor(x / renderer.cw), r = Math.floor(y / renderer.ch); return c >= 0 && c < cols && r >= 0 && r < rows ? r * cols + c : -1; }
    function stamp(channel, x, y, radius, amount) {
      const c0 = Math.floor(x / renderer.cw), r0 = Math.floor(y / renderer.ch);
      for (let r = Math.max(0, r0 - radius); r <= Math.min(rows - 1, r0 + radius); r++) for (let c = Math.max(0, c0 - radius); c <= Math.min(cols - 1, c0 + radius); c++) {
        const d = Math.hypot(c - c0, (r - r0) * 1.4); if (d <= radius + .5) { const i = (r * cols + c) * 2 + channel; deposits[i] = Math.min(1.6, deposits[i] + amount * (1 - d / (radius + 1))); }
      }
    }
    function impulses(world, dt) {
      deposits.fill(0);
      for (const e of world.events) if (e.kind === 'eat') { stamp(1, e.x, e.y, 2, 1); stamp(0, e.x, e.y, 3, .9); } else stamp(0, e.x, e.y, 6, 1.4);
      world.events.length = 0; const scale = dt * 24;
      for (const f of world.fish) if (f.alive) { const i = index(f.x, f.y); if (i >= 0) deposits[i * 2] = Math.min(1.6, deposits[i * 2] + (.012 + f.alarm * .03) * scale); }
      for (const s of world.sharks) for (let k = 14; k < 20; k++) { const i = index(s.nodes[k * 2], s.nodes[k * 2 + 1]); if (i >= 0) deposits[i * 2] = Math.min(1.6, deposits[i * 2] + (.05 + s.speed * .0012) * scale); }
      if (world.pointer.active) stamp(0, world.pointer.x, world.pointer.y, 1, .08 * scale);
      gl.bindTexture(gl.TEXTURE_2D, depositTexture); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RG, gl.FLOAT, deposits);
    }
    function fish(world) {
      fishCells.fill(0);
      for (let pass = 0; pass < 2; pass++) for (const f of world.fish) {
        if (!f.alive || (f.depth > .78 ? 0 : 1) !== pass) continue; const i = index(f.x, f.y); if (i < 0 || fishCells[i]) continue;
        const glint = clamp(Math.abs(f.turn) / 3.5, 0, 1), v = .3 + .4 * (f.depth - .55) / .45 + .3 * Math.max(glint, f.alarm);
        fishCells[i] = clamp(Math.floor(v * 5), 0, 4) + 1;
      }
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.bindTexture(gl.TEXTURE_2D, fishTexture); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RED_INTEGER, gl.UNSIGNED_BYTE, fishCells);
    }
    return {
      render(world, dt, masks = []) {
        const started = performance.now(); if (gl.isContextLost()) throw new Error('GPU compute context lost');
        ensureSize(); ensureAtlas(); skeleton(world); fish(world);
        if (occlusionVersion !== renderer.occlusionKey) { gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.bindTexture(gl.TEXTURE_2D, occlusion); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RED_INTEGER, gl.UNSIGNED_BYTE, renderer.occluded); occlusionVersion = renderer.occlusionKey; }
        if (dt > 0) {
          impulses(world, dt); common(fields, world); gl.bindFramebuffer(gl.FRAMEBUFFER, fieldFbos[1 - current]); gl.viewport(0, 0, cols, rows);
          bind(fields, 'previousTex', fieldTextures[current], 0); bind(fields, 'depositTex', depositTexture, 1); gl.uniform1f(fields.location('dt'), dt); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); current = 1 - current;
        }
        common(classify, world); gl.bindFramebuffer(gl.FRAMEBUFFER, classFbo); gl.viewport(0, 0, cols, rows); bind(classify, 'segmentsTex', segmentTexture, 0); bind(classify, 'occlusionTex', occlusion, 1); gl.uniform1i(classify.location('edgeSamples'), renderer.edgeSamples); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        common(draw, world); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
        bind(draw, 'classifiedTex', classTexture, 0); bind(draw, 'fieldTex', fieldTextures[current], 1); bind(draw, 'fishTex', fishTexture, 2); bind(draw, 'occlusionTex', occlusion, 3); bind(draw, 'dotsTex', dotTexture, 4); bind(draw, 'atlasTex', atlas, 5);
        gl.uniform2f(draw.location('viewport'), canvas.width, canvas.height); gl.uniform1f(draw.location('dpr'), renderer.dpr); gl.uniform1f(draw.location('atlasCell'), atlasCell); gl.uniform2i(draw.location('atlasSize'), atlasWidth, atlasHeight);
        gl.uniform4fv(draw.location('fishColors[0]'), renderer.fishStyles.flatMap(color)); gl.uniform4fv(draw.location('dotColors[0]'), renderer.dotStyles.flatMap(color));
        const accents = renderer.paletteAccents || model.ACCENTS; gl.uniform1i(draw.location('accentCount'), accents.length); gl.uniform4fv(draw.location('accentColors[0]'), [...accents, ...Array(7 - accents.length).fill('#000000')].flatMap(color));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        for (const r of masks) { const d = renderer.dpr; gl.enable(gl.SCISSOR_TEST); gl.scissor(Math.floor(r.x * d), Math.floor(canvas.height - (r.y + r.h) * d), Math.ceil(r.w * d), Math.ceil(r.h * d)); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
        gl.disable(gl.SCISSOR_TEST); frameCount++; cpuMs = performance.now() - started;
      },
      clearFields() { for (const fbo of fieldFbos) { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.clearBufferfv(gl.COLOR, 0, new Float32Array(4)); } },
      getState: () => ({ frameCount, cpuMs }),
      // QA only: never called by the production rendering path.
      inspectCells() { const result = new Uint32Array(cols * rows * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, classFbo); gl.readPixels(0, 0, cols, rows, gl.RGBA_INTEGER, gl.UNSIGNED_INT, result); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return result; },
      inspectFields() { const result = new Float32Array(cols * rows * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, fieldFbos[current]); gl.readPixels(0, 0, cols, rows, gl.RGBA, gl.FLOAT, result); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return result; },
    };
  }

  function createOceanGpuContext(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    const shader = (type, source) => {
      const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const program = gl.createProgram();
    const vertex = shader(gl.VERTEX_SHADER, `#version 300 es
      precision highp float;
      layout(location=0) in vec4 box;
      layout(location=1) in vec4 color;
      layout(location=2) in vec4 uvbox;
      layout(location=3) in float glyph;
      uniform vec2 size;out vec4 tint;out vec2 uv;flat out float isGlyph;flat out vec4 bounds;
      void main(){vec2 p=vec2(float(gl_VertexID&1),float(gl_VertexID>>1));
      vec2 lo=glyph>.5?box.xy:floor(box.xy),hi=glyph>.5?box.xy+box.zw:ceil(box.xy+box.zw);
      vec2 xy=mix(lo,hi,p)/size;gl_Position=vec4(xy.x*2.-1.,1.-xy.y*2.,0,1);
      tint=color;uv=uvbox.xy+p*uvbox.zw;isGlyph=glyph;bounds=box;}`);
    const fragment = shader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;uniform sampler2D atlas;uniform vec2 size;in vec4 tint;in vec2 uv;flat in float isGlyph;flat in vec4 bounds;out vec4 pixel;
      void main(){vec2 p=vec2(gl_FragCoord.x,size.y-gl_FragCoord.y);
      vec2 coverage=clamp(min(p+.5,bounds.xy+bounds.zw)-max(p-.5,bounds.xy),0.,1.);
      float a=tint.a*(isGlyph>.5?texture(atlas,uv).a:coverage.x*coverage.y);pixel=vec4(tint.rgb*a,a);}`);
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const buffer = gl.createBuffer(), texture = gl.createTexture(), vao = gl.createVertexArray();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    let values = new Float32Array(13 * 4096), count = 0, sx = 1, sy = 1;
    let color = [0, 0, 0, 1], fillStyle = '#000', font = '600 12px monospace', atlasKey = '', glyphs = null, atlasCanvas = null;
    const colors = new Map(), chars = [...new Set(":;t%SX8#@o.',`-*·?")];
    const parse = value => {
      if (colors.has(value)) return colors.get(value);
      let c;
      if (/^#[\da-f]{6}$/i.test(value)) c = [parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255, 1];
      else if (/^#[\da-f]{3}$/i.test(value)) c = [...value.slice(1)].map(v => parseInt(v + v, 16) / 255).concat(1);
      else { const n = value.match(/[\d.]+/g)?.map(Number); c = n?.length >= 3 ? [n[0] / 255, n[1] / 255, n[2] / 255, n[3] ?? 1] : [1, 1, 1, 1]; }
      if (colors.size >= 1024) colors.clear(); colors.set(value, c); return c;
    };
    function atlas() {
      const key = font + ':' + sx + ':' + sy;
      if (key === atlasKey) return;
      flush(); atlasKey = key;
      const fontSize = parseFloat(font.match(/([\d.]+)px/)?.[1]) || 12;
      // Eight subpixel phases prevent atlas resampling from blurring glyphs.
      const cell = Math.ceil(fontSize * Math.max(sx, sy) * 2 + 8), columns = 32, rows = Math.ceil(chars.length * 64 / columns);
      atlasCanvas = new OffscreenCanvas(cell * columns, cell * rows);
      const ctx = atlasCanvas.getContext('2d');
      ctx.font = font; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.setTransform(sx, 0, 0, sy, 0, 0); glyphs = new Map();
      chars.forEach((char, charIndex) => {
        const variants = [];
        for (let phase = 0; phase < 64; phase++) {
          const i = charIndex * 64 + phase, x = i % columns * cell, y = Math.floor(i / columns) * cell;
          const cx = Math.floor(cell / 2) + (phase % 8) / 8, cy = Math.floor(cell / 2) + Math.floor(phase / 8) / 8;
          ctx.fillText(char, (x + cx) / sx, (y + cy) / sy);
          variants.push({ cell, cx, cy, u: x / atlasCanvas.width, v: y / atlasCanvas.height, uw: cell / atlasCanvas.width, vh: cell / atlasCanvas.height });
        }
        glyphs.set(char, variants);
      });
      gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    function push(x, y, w, h, uv = [0, 0, 0, 0], glyph = 0) {
      if ((count + 1) * 13 > values.length) { const next = new Float32Array(values.length * 2); next.set(values); values = next; }
      const i = count++ * 13;
      values[i] = x; values[i + 1] = y; values[i + 2] = w; values[i + 3] = h;
      values[i + 4] = color[0]; values[i + 5] = color[1]; values[i + 6] = color[2]; values[i + 7] = color[3];
      values[i + 8] = uv[0]; values[i + 9] = uv[1]; values[i + 10] = uv[2]; values[i + 11] = uv[3]; values[i + 12] = glyph;
    }
    function flush() {
      if (!count) return;
      if (gl.isContextLost()) throw new Error('Ocean WebGL context lost');
      gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(program); gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, values.subarray(0, count * 13), gl.DYNAMIC_DRAW);
      for (const [location, length, offset] of [[0, 4, 0], [1, 4, 4], [2, 4, 8], [3, 1, 12]]) {
        gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, length, gl.FLOAT, false, 52, offset * 4); gl.vertexAttribDivisor(location, 1);
      }
      gl.uniform2f(gl.getUniformLocation(program, 'size'), canvas.width, canvas.height);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(gl.getUniformLocation(program, 'atlas'), 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count); count = 0;
    }
    return {
      get fillStyle() { return fillStyle; }, set fillStyle(value) { fillStyle = value; color = parse(value); },
      get font() { return font; }, set font(value) { font = value; },
      textAlign: 'center', textBaseline: 'middle',
      setTransform(a, b, c, d) { sx = a; sy = d; },
      fillRect(x, y, w, h) { push(x * sx, y * sy, w * sx, h * sy); },
      fillText(text, x, y) {
        atlas();
        const px = Math.round(x * sx * 8), py = Math.round(y * sy * 8);
        const phase = ((py % 8 + 8) % 8) * 8 + (px % 8 + 8) % 8, g = (glyphs.get(text) || glyphs.get('?'))[phase];
        push(px / 8 - g.cx, py / 8 - g.cy, g.cell, g.cell, [g.u, g.v, g.uw, g.vh], 1);
      },
      clearRect(x, y, w, h) {
        if (x === 0 && y === 0 && w * sx >= canvas.width && h * sy >= canvas.height) { count = 0; gl.disable(gl.SCISSOR_TEST); }
        else { flush(); gl.enable(gl.SCISSOR_TEST); gl.scissor(Math.floor(x * sx), Math.floor(canvas.height - (y + h) * sy), Math.ceil(w * sx), Math.ceil(h * sy)); }
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.SCISSOR_TEST);
      },
      flush,
    };
  }

  // Precompute motion, not pixels: full-resolution rendering remains live.
  // 12 Hz Float32 keyframes preserve all render-relevant motion fields.
  function createOceanReplayEngine(World, notify = () => {}, yieldSlice = null) {
    let generation = 0, requestedKey = '', clip = null, cursor = 0, previousFrame = -1, eventCursor = 0, active = false;
    let status = { state: 'live', progress: 0, bytes: 0, cached: false };
    const emit = value => { status = { ...status, ...value }; notify(status); };
    async function database() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('cgpt-unified-ocean-replay-v1', 2);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('clips')) request.result.createObjectStore('clips', { keyPath: 'key' });
          if (!request.result.objectStoreNames.contains('meta')) request.result.createObjectStore('meta', { keyPath: 'key' });
        };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Replay cache blocked'));
      });
    }
    async function load(key) {
      const db = await database();
      try { return await new Promise((resolve, reject) => { const r = db.transaction('clips').objectStore('clips').get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
      finally { db.close(); }
    }
    async function save(value) {
      const db = await database();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(['clips', 'meta'], 'readwrite'), store = tx.objectStore('clips'), meta = tx.objectStore('meta');
          // Retain at most two geometries and 128 MiB across all replay clips.
          const request = meta.getAll();
          request.onsuccess = () => {
            const old = request.result.filter(c => c.key !== value.key).sort((a, b) => b.created - a.created);
            let total = value.data.byteLength;
            old.forEach((entry, i) => { total += entry.bytes; if (i >= 1 || total > 128 * 1024 * 1024) { store.delete(entry.key); meta.delete(entry.key); } });
            store.put(value);
            meta.put({ key: value.key, created: value.created, bytes: value.data.byteLength });
          };
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
        });
      } finally { db.close(); }
    }
    const capture = (world, array, offset) => {
      for (const f of world.fish) { array[offset++] = f.x; array[offset++] = f.y; array[offset++] = f.alarm; array[offset++] = f.turn; array[offset++] = f.alive ? 1 : 0; }
      for (const s of world.sharks) { array.set(s.nodes, offset); offset += s.nodes.length; array[offset++] = s.phase; array[offset++] = s.turn; array[offset++] = s.speed; }
    };
    async function prepare(config, world) {
      if (!config.replaySeconds) {
        if (requestedKey) { generation++; requestedKey = ''; clip = null; active = false; emit({ state: 'live', progress: 0, bytes: 0 }); }
        return;
      }
      const key = JSON.stringify(['motion-v1', config.width, config.height, config.density, config.kinds, config.placementKey, config.replaySeconds]);
      if (key === requestedKey) return;
      const ticket = ++generation; requestedKey = key; clip = null; active = false; cursor = 0; previousFrame = -1; eventCursor = 0;
      emit({ state: 'preparing', progress: 0, bytes: 0, cached: false });
      try {
        let cached = null;
        try { cached = await load(key); } catch (_) { /* Private mode/quota: memory-only replay still works. */ }
        if (ticket !== generation) return;
        if (cached?.data instanceof Float32Array && cached.stride > 0 && cached.data.length === cached.stride * cached.frames && cached.duration === config.replaySeconds && cached.fps === 12) {
          clip = cached; emit({ state: 'ready', progress: 1, bytes: clip.data.byteLength, cached: true }); return;
        }
        const model = Object.assign(new World(), structuredClone(world));
        model.pointer = { x: 0, y: 0, active: false }; model.events = [];
        const fps = 12, frames = config.replaySeconds * fps + 1, stride = model.fish.length * 5 + model.sharks.reduce((n, s) => n + s.nodes.length + 3, 0);
        if (stride * frames * 4 > 120 * 1024 * 1024) throw new Error('Replay exceeds memory budget');
        const result = { key, created: Date.now(), duration: config.replaySeconds, fps, frames, stride,
          data: new Float32Array(stride * frames), base: structuredClone({ fish: model.fish, sharks: model.sharks, time: model.time }), events: [] };
        capture(model, result.data, 0);
        let frame = 1, reported = 0;
        while (frame < frames) {
          const end = performance.now() + 3;
          do {
            model.step(1 / fps); capture(model, result.data, frame * stride);
            for (const event of model.events) result.events.push({ frame, ...event });
            model.events.length = 0; frame++;
          } while (frame < frames && performance.now() < end);
          if (ticket !== generation) return;
          if (performance.now() - reported > 500) { emit({ progress: frame / frames, bytes: result.data.byteLength }); reported = performance.now(); }
          await new Promise(resolve => yieldSlice ? yieldSlice(resolve) : setTimeout(resolve, 12));
        }
        if (ticket !== generation) return;
        clip = result; emit({ state: 'ready', progress: 1, bytes: result.data.byteLength, cached: false });
        try { await save(result); if (ticket === generation) emit({ cached: true }); } catch (_) { /* Do not interrupt a working memory replay. */ }
      } catch (error) { if (ticket === generation) emit({ state: 'error', message: String(error), progress: 0 }); }
    }
    function sample(world, dt) {
      if (!clip) return null;
      if (!active) {
        const base = structuredClone(clip.base); world.fish = base.fish; world.sharks = base.sharks; world.events = []; active = true;
      }
      cursor = (cursor + dt) % clip.duration;
      const frame = Math.min(clip.frames - 2, Math.floor(cursor * clip.fps)), fraction = cursor * clip.fps - frame;
      let offset = frame * clip.stride, next = offset + clip.stride;
      const mix = i => clip.data[offset + i] * (1 - fraction) + clip.data[next + i] * fraction;
      for (const f of world.fish) {
        const continuous = clip.data[offset + 4] === clip.data[next + 4]
          && Math.abs(clip.data[offset] - clip.data[next]) + Math.abs(clip.data[offset + 1] - clip.data[next + 1]) < 200;
        f.x = continuous ? mix(0) : clip.data[offset]; f.y = continuous ? mix(1) : clip.data[offset + 1];
        f.alarm = mix(2); f.turn = mix(3); f.alive = clip.data[offset + 4] > .5; offset += 5; next += 5;
      }
      for (const s of world.sharks) {
        for (let i = 0; i < s.nodes.length; i++) s.nodes[i] = mix(i);
        const n = s.nodes.length; s.phase = mix(n); s.turn = mix(n + 1); s.speed = mix(n + 2); offset += n + 3; next += n + 3;
      }
      if (frame < previousFrame) { previousFrame = -1; eventCursor = 0; }
      while (eventCursor < clip.events.length && clip.events[eventCursor].frame <= frame) {
        const event = clip.events[eventCursor++]; if (event.frame > previousFrame) world.events.push(event);
      }
      previousFrame = frame;
      world.time = clip.base.time + cursor; world.pointer = { x: 0, y: 0, active: false };
      return Math.max(0, Math.min(1, cursor / .45, (clip.duration - cursor) / .45));
    }
    async function clear() {
      generation++;
      const db = await database();
      try { await new Promise((resolve, reject) => { const tx = db.transaction(['clips', 'meta'], 'readwrite'); tx.objectStore('clips').clear(); tx.objectStore('meta').clear(); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); emit({ cached: false, state: clip ? 'ready' : 'cancelled' }); }
      finally { db.close(); }
    }
    return { prepare, sample, clear, cancel: () => { generation++; }, getState: () => ({ ...status }) };
  }

  function oceanWorkerProgram(factory) {
    const model = factory(), { World, AsciiRenderer } = model;
    let world, renderer, canvas, currentConfig, layoutVersion = -1, placementVersion = -1, direct = false;
    let simulationSteps = 0, fieldTicks = 0, frames = 0, gpu = false, compute = null, computeError = '';
    const replay = createOceanReplayEngine(World, status => self.postMessage({ type: 'replay-status', status }));
    self.onmessage = ({ data }) => {
      if (data.type === 'clear-replay') { replay.clear().catch(() => {}); return; }
      try {
        const started = performance.now();
        if (data.config) currentConfig = data.config;
        const config = currentConfig;
        if (!world) {
          world = new World(config.kinds.map((kind, i) => ({ kind, size: [1, .7, .84, .77][i] })), config.density);
          direct = !!data.surface; canvas = data.surface || new OffscreenCanvas(1, 1);
          let ctx = null;
          if (config.rendererMode === 'compute') {
            try { renderer = new AsciiRenderer(canvas, {}); compute = createOceanComputeRenderer(canvas, renderer, model); gpu = true; }
            catch (error) { if (direct) throw error; computeError = String(error); compute = null; canvas = new OffscreenCanvas(1, 1); }
          }
          if (!compute) {
            if (config.rendererMode === 'gpu' || config.rendererMode === 'compute') {
              try { ctx = createOceanGpuContext(canvas); gpu = !!ctx; } catch (_) { /* Keep Canvas if WebGL is unavailable. */ }
              if (!ctx) { if (direct) throw Error('Direct WebGL context unavailable'); canvas = new OffscreenCanvas(1, 1); }
            }
            renderer = new AsciiRenderer(canvas, ctx);
          }
          renderer.setFontFamily('Consolas,"Courier New",monospace');
          renderer.setDetail(config.quality === 'eco');
          renderer.setExternalFieldClock(true);
        }
        if (config.layoutVersion !== layoutVersion) {
          if (renderer.width !== config.width || renderer.height !== config.height || renderer.dpr !== config.dpr) {
            renderer.resize(config.width, config.height, config.dpr);
            world.resize(config.width, config.height, renderer.cellWidth, renderer.cellHeight);
          }
          renderer.setOcclusion(config.masks);
          renderer.bodyTint = config.palette.bodyTint;
          renderer.paletteAccents = config.palette.paletteAccents;
          renderer.fishStyles = config.palette.fishStyles;
          renderer.dotStyles = config.palette.dotStyles;
          layoutVersion = config.layoutVersion;
        }
        if (config.placementVersion !== placementVersion) {
          // Main thread chooses placement from DOM bounds once; all motion stays here.
          world.fish = config.fish;
          world.sharks = config.sharks;
          placementVersion = config.placementVersion;
        }
        world.pointer = data.pointer;
        replay.prepare(config, world);
        const dt = data.dt;
        const previousTime = world.time, simulationStart = performance.now(), replayFade = replay.sample(world, dt);
        if (replayFade !== null && world.time < previousTime) { renderer.energy.fill(0); renderer.heat.fill(0); compute?.clearFields(); }
        if (replayFade === null && data.splash) world.splash(data.splash.x, data.splash.y);
        if (dt > 0) {
          if (replayFade === null) { world.step(dt); simulationSteps++; }
          if (!compute) renderer.advanceFields(world, dt);
          fieldTicks++;
        }
        const simulationMs = performance.now() - simulationStart, renderStart = performance.now();
        if (compute) compute.render(world, dt, config.masks);
        else {
          renderer.render(world, dt);
          const ctx = renderer.ctx; ctx.setTransform(config.dpr, 0, 0, config.dpr, 0, 0);
          for (const r of config.masks) ctx.clearRect(r.x, r.y, r.w, r.h);
          ctx.flush?.();
        }
        const bitmap = direct ? null : canvas.transferToImageBitmap(); frames++;
        self.postMessage({ bitmap, direct, epoch: data.epoch, layoutVersion, time: world.time, simulationSteps, fieldTicks, frames, gpu, gpuCompute: !!compute, computeError, replay: replay.getState(), replayFade: replayFade ?? 1, simulationMs, renderMs: performance.now() - renderStart, workMs: performance.now() - started }, bitmap ? [bitmap] : []);
      } catch (error) { self.postMessage({ error: String(error) }); }
    };
  }

  function createOceanWorker(onFrame, onFailure, onStatus = () => {}) {
    if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') return null;
    let worker, busy = false, stopped = false, timer = 0;
    try {
      const source = `${createOceanComputeRenderer.toString()}\n${createOceanGpuContext.toString()}\n${createOceanReplayEngine.toString()}\n(${oceanWorkerProgram.toString()})(${oceanModelFactory.toString()});`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      try { worker = new Worker(trustedWorkerURL(url)); } finally { URL.revokeObjectURL(url); }
    } catch (_) { return null; }
    const stop = () => { stopped = true; clearTimeout(timer); worker.terminate(); };
    const fail = error => { if (stopped) return; stop(); onFailure(error); };
    worker.onerror = event => { event.preventDefault(); fail(event.message || 'worker blocked or failed'); };
    worker.onmessage = ({ data }) => {
      if (data.type === 'replay-status') { onStatus(data.status); return; }
      clearTimeout(timer); busy = false;
      if (stopped) { data.bitmap?.close(); return; }
      if (data.error) { fail(data.error); return; }
      try { onFrame(data); } catch (error) { fail(String(error)); } finally { data.bitmap?.close(); }
    };
    return {
      send(data) {
        if (busy || stopped) return false;
        busy = true;
        timer = setTimeout(() => fail('worker timed out'), 5000);
        try { worker.postMessage(data, data.surface ? [data.surface] : []); return true; } catch (error) { fail(String(error)); return false; }
      },
      stop,
      clearReplay() { if (!stopped) worker.postMessage({ type: 'clear-replay' }); },
      get busy() { return busy; },
    };
  }

  // work/message-glass-v65.ts


// ═══ AI Studio appearance and native glass adapter ═══
const APP_STYLE_ID='ast-toolbox-page-style';
const glassControllers=new Map(),messageGlassControllers=new Map();
const viewport=(()=>{
 const observed=new Set(),visible=new Set();let disposed=false,main=null,mainSize=null;
 const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
  let changed=false;for(const entry of entries){if(entry.isIntersecting){if(!visible.has(entry.target)){visible.add(entry.target);changed=true;}}else if(visible.delete(entry.target))changed=true;}
  if(changed&&!disposed)scheduleLayout();
 },{rootMargin:'160px'}):null;
 function sync(){const next=new Set(settings.messageGlass||settings.ocean?messages().filter(m=>m.role==='assistant').flatMap(m=>m.roots):[]);
  const current=dom.main();if(current!==main){mainSize?.disconnect();main=current;mainSize=main?runtime.pageWork.observeSize(main,scheduleLayout):null;}
  for(const root of observed)if(!next.has(root)){observer?.unobserve(root);observed.delete(root);visible.delete(root);}
  for(const root of next)if(!observed.has(root)){observed.add(root);if(observer)observer.observe(root);else visible.add(root);}
 }
 return {sync,roots:()=>[...visible].filter(el=>el.isConnected),destroy(){disposed=true;observer?.disconnect();mainSize?.disconnect();observed.clear();visible.clear();}};
})();
let composerGlassController=null,shadowGlassStyle=null,rootBaseline=null;
const rootAttributes=['data-cgfc-theme','data-cgfc-liquid-glass','data-ast-ocean','data-cgfc-glass-render-mode','data-cgfc-glass-style','data-cgfc-glass-finish'];
const rootProperties=['--ast-ui-font','--ast-ui-size','--ast-ui-width'];
for(const surface of GLASS_SURFACES){
 const prefix=surface.id==='composer'?'--cgfc-glass-':`--cgfc-${surface.kind}-glass-`;
 for(const key of ['strength','blur','opacity','thickness','glare','chroma','curvature','bend','radius','saturation','brightness','tint'])rootProperties.push(prefix+key);
 if(surface.id!=='composer')rootAttributes.push(`data-cgfc-${surface.kind}-liquid-glass`,`data-cgfc-${surface.kind}-glass-render-mode`,`data-cgfc-${surface.kind}-glass-style`,`data-cgfc-${surface.kind}-glass-finish`);
}
function captureRootBaseline(root){
 if(rootBaseline)return;
 rootBaseline={attributes:new Map(rootAttributes.map(name=>[name,root.getAttribute(name)])),properties:new Map(rootProperties.map(name=>[name,[root.style.getPropertyValue(name),root.style.getPropertyPriority(name)]]))};
}
function restoreRootBaseline(root){
 if(!rootBaseline)return;
 for(const [name,value] of rootBaseline.attributes){if(value===null)root.removeAttribute(name);else root.setAttribute(name,value);}
 for(const [name,[value,priority]] of rootBaseline.properties){if(value)root.style.setProperty(name,value,priority);else root.style.removeProperty(name);}
 rootBaseline=null;
}
function pageIsDark(){
 const root=document.documentElement;
 if(root.matches('.dark,[data-theme="dark"],[data-color-scheme="dark"]'))return true;
 if(root.matches('.light,[data-theme="light"],[data-color-scheme="light"]'))return false;
 const value=getComputedStyle(document.body).backgroundColor,match=value.match(/\d+(?:\.\d+)?/g);
 if(match&&match.length>=3&&!(match.length>3&&Number(match[3])===0))return .299*Number(match[0])+.587*Number(match[1])+.114*Number(match[2])<128;
 return matchMedia('(prefers-color-scheme: dark)').matches;
}
function applySettings(){
 const root=document.documentElement;if(!root)return;captureRootBaseline(root);
 const dark=settings.themeMode==='native'?pageIsDark():settings.themeMode==='dark';root.setAttribute('data-cgfc-theme',dark?'dark':'light');
 if(typeof ui!=='undefined'&&ui.host)ui.host.dataset.theme=dark?'dark':'light';
 const isOn=key=>Boolean(settings[key+'Enabled']);
 const body='ms-chat-turn ms-cmark-node, ms-chat-turn .very-large-text-container';
 const bold='ms-chat-turn ms-cmark-node :is(strong,b), ms-chat-turn .very-large-text-container :is(strong,b)';
 const code='ms-chat-turn :is(pre,code,ms-code-block)';
 const math='ms-chat-turn :is(math,mjx-container,.katex,.MathJax)';
 const declarations=[];
 const rgb=hex=>hex.match(/[a-f0-9]{2}/gi).map(x=>parseInt(x,16)).join(',');
 if(settings.pageBackground){const image=imageURL(settings.backgroundImage);declarations.push(`body{background-color:${settings.backgroundColor}!important;background-image:${image?`linear-gradient(#000${Math.round(settings.backgroundShade*255).toString(16).padStart(2,'0')},#000${Math.round(settings.backgroundShade*255).toString(16).padStart(2,'0')}),url(${JSON.stringify(image)})`:'none'}!important;background-size:cover!important;background-position:center!important;background-attachment:fixed!important}body :is(ms-app,.layout-wrapper,.layout-main,ms-prompt-renderer,ms-chunk-editor,.chunk-editor-main,main){background-color:transparent!important}`);}
 if(settings.panelBackground)declarations.push(`ms-navbar-v2,ms-right-side-panel,ms-run-settings{background:rgba(${rgb(settings.panelColor)},${settings.panelOpacity})!important}`);
 if(settings.customAccent)declarations.push(`:root{--mat-sys-primary:${settings.accentColor};--sys-primary:${settings.accentColor};--color-primary:${settings.accentColor}}ms-run-button button:not(:disabled){border-color:${settings.accentColor}!important}::selection{background:rgba(${rgb(settings.accentColor)},.35)}`);
 if(isOn('contentWidth'))declarations.push(`ms-chat-turn{width:${settings.contentWidth}%!important;margin-inline:auto!important;box-sizing:border-box}ms-chat-turn :is(ms-cmark-node,.very-large-text-container){max-width:100%;overflow-wrap:anywhere}`);
 const add=(selector,condition,property,value)=>{if(condition)declarations.push(`${selector}{${property}:${value}!important}`);};
 const normalStack=[isOn('latinFont')?cssFont(settings.latinFont,'Lora'):null,isOn('chineseFont')?cssFont(settings.chineseFont,'serif'):null,'serif'].filter(Boolean).join(', ');
 const boldStack=[isOn('boldLatinFont')?cssFont(settings.boldLatinFont,'Lora'):null,isOn('boldChineseFont')?cssFont(settings.boldChineseFont,'serif'):null,'serif'].filter(Boolean).join(', ');
 add(body,isOn('latinFont')||isOn('chineseFont'),'font-family',normalStack);
 add(body,isOn('fontSize'),'font-size',`${settings.fontSize}px`);
 add(body,isOn('lineHeight'),'line-height',settings.lineHeight);
 add(bold,isOn('boldLatinFont')||isOn('boldChineseFont'),'font-family',boldStack);
 add(bold,isOn('boldWeight'),'font-weight',settings.boldWeight);
 add(body,isOn('normalColor')&&!(settings.nativeLightBodyColors&&!dark&&settings.normalColor.toLowerCase()==='#ffffff'),'color',settings.normalColor);
 add(bold,isOn('boldColor')&&!(settings.nativeLightBodyColors&&!dark&&settings.boldColor.toLowerCase()==='#e8e2d8'),'color',settings.boldColor);
 add(code,isOn('codeFont'),'font-family',cssFont(settings.codeFont,'monospace'));
 add(code,isOn('codeFontSize'),'font-size',`${settings.codeFontSize}px`);
 add(code,isOn('codeLineHeight'),'line-height',settings.codeLineHeight);
 add('ms-chat-turn math',isOn('mathFont')&&settings.mathFontMode!=='off','font-family',cssFont(settings.mathFont,'serif'));
 add(math,isOn('formulaFontSize'),'font-size',`${settings.formulaFontSize}px`);
 if(settings.wrapCode)declarations.push('ms-chat-turn pre{white-space:pre-wrap!important;overflow-wrap:anywhere!important}');
 if(settings.fontSmoothing)declarations.push(`${body}{-webkit-font-smoothing:antialiased!important;text-rendering:optimizeLegibility!important}`);
 declarations.push(`
  .ast-copy-button{position:absolute;right:8px;top:8px;z-index:4;border:1px solid #8885;border-radius:7px;padding:4px 7px;color:inherit;background:rgba(50,50,50,.46);cursor:pointer;font:12px system-ui}
  ms-chat-turn[data-ast-copy-host]{position:relative}
  html[data-ast-ocean] :is(app-root,ms-app,.layout-wrapper,.layout-main,ms-prompt-renderer,ms-chunk-editor,.chunk-editor-main){background-color:transparent!important;background-image:none!important}
  html[data-ast-ocean] app-root,html[data-ast-ocean] ms-app{position:relative;z-index:1}
  html[data-ast-ocean] [role="main"]{background-color:transparent!important}
 `);
 let pageStyle=document.getElementById(APP_STYLE_ID);if(!pageStyle){pageStyle=document.createElement('style');pageStyle.id=APP_STYLE_ID;(document.head||root).appendChild(pageStyle);}
  declarations.push(pageAppearanceCSS(settings,dark));
  const css=declarations.join('\n');if(pageStyle.textContent!==css)pageStyle.textContent=css;
 root.style.setProperty('--ast-ui-font',cssFont(settings.toolboxFont,'sans-serif'));
 root.style.setProperty('--ast-ui-size',`${settings.toolboxFontSize}px`);
 root.style.setProperty('--ast-ui-width',`${settings.toolboxWidth}px`);
 root.toggleAttribute('data-cgfc-liquid-glass',settings.composerGlass);
 for(const surface of GLASS_SURFACES){
  const {id,kind}=surface,isComposer=id==='composer',prefix=isComposer?'--cgfc-glass-':`--cgfc-${kind}-glass-`,attr=isComposer?'data-cgfc-glass':`data-cgfc-${kind}-glass`;
  if(!isComposer)root.toggleAttribute(`data-cgfc-${kind}-liquid-glass`,settings[id+'Glass']);
  for(const suffix of ['strength','blur','opacity','thickness','glare','chroma','curvature','bend','radius','saturation','brightness'])root.style.setProperty(prefix+suffix,String(settings[id+suffix[0].toUpperCase()+suffix.slice(1)]));
  const tint=settings[id+'TintMode']==='custom'?settings[id+'Tint'].match(/[a-f0-9]{2}/gi).map(value=>parseInt(value,16)).join(','):'';
  root.style.setProperty(prefix+'tint',tint);
  root.setAttribute(`${attr}-render-mode`,settings[id+'Mode']);root.setAttribute(`${attr}-style`,settings[id+'Style']);root.setAttribute(`${attr}-finish`,settings[id+'Finish']);
 }
 root.toggleAttribute('data-ast-ocean',settings.ocean);
 glassOpticsFrameValue=null;
 refreshGlass();
 if(typeof ocean!=='undefined')ocean.updateSettings();
 if(typeof ui!=='undefined')ui.syncSettings();
}
function glassFor(kind){
 let instance=glassControllers.get(kind);
 if(!instance){instance=new ComposerLiquidGlass(runtime,{kind,enabledAttribute:`data-cgfc-${kind}-liquid-glass`,direct:true,sharedStyle:true,managed:true});glassControllers.set(kind,instance);}
 return instance;
}
function refreshGlass(){
 if(!composerGlassController)composerGlassController=new ComposerLiquidGlass(runtime,{managed:true});
 composerGlassController.attach(dom.shell());
 glassFor('send').attach(dom.runButton());
 const scrollButton=document.querySelector('button[aria-label*="scroll to bottom" i],button[aria-label*="jump to bottom" i],button[aria-label*="滚动到底部"]');
 glassFor('scroll').attach(scrollButton);
 if(typeof ui!=='undefined'&&ui.host?.isConnected){
  glassFor('toolbox').attach(ui.navPanel);glassFor('settings').attach(ui.settingsPanel);glassFor('queue').attach(ui.queuePanel);
  glassFor('toggle').attach(ui.launcher);glassFor('stats').attach(ui.tokenBadge);
  if(!shadowGlassStyle?.isConnected||shadowGlassStyle.getRootNode()!==ui.shadow){shadowGlassStyle?.remove();shadowGlassStyle=text('style',GLASS_STYLE.slice(GLASS_STYLE.indexOf('    :is([data-cgfc-liquid-composer]')));ui.shadow.appendChild(shadowGlassStyle);}
 }
 viewport.sync();
 const visible=settings.messageGlass?viewport.roots().slice(-16):[];
 const keep=new Set(visible);
 for(const [el,controller] of messageGlassControllers)if(!keep.has(el)||!el.isConnected){controller.destroy();messageGlassControllers.delete(el);}
 for(const el of visible){let controller=messageGlassControllers.get(el);if(!controller){controller=new ComposerLiquidGlass(runtime,{kind:'message',enabledAttribute:'data-cgfc-message-liquid-glass',direct:true,sharedStyle:true,managed:true,visibilityManaged:true});messageGlassControllers.set(el,controller);}controller.attach(el);}
}
function destroyGlass(){composerGlassController?.destroy();for(const controller of glassControllers.values())controller.destroy();for(const controller of messageGlassControllers.values())controller.destroy();glassControllers.clear();messageGlassControllers.clear();shadowGlassStyle?.remove();shadowGlassStyle=null;window.removeEventListener('pagehide',onGlassPageHide);glassMapService.stop();}


// ═══ AI Studio ocean adapter ═══
const ocean=(()=>{
 let canvas=null,renderer=null,world=null,worker=null,configKey='',width=0,height=0,dpr=1,layoutVersion=0,sentLayout=-1,epoch=0,last=0,timer=0,raf=0,failedWorker=false,status='未启动',backend='未启动';
 let currentConfig=null,clips=[],pointerBound=false,workerFailure='',pausedBusy=false,cachedCoverage='off',drawFrames=0,lastWorkMs=0;
 let gpuCanvas=null,gpuRenderer=null,gpuCompute=null,replay=null,gpuFailure='',paletteKey='',staticFrameKey='';
 const targetFps=()=>Math.min(settings.oceanFps,settings.oceanQuality==='eco'?18:30);
 function syncPalette(){if(!renderer)return;const palette=oceanPalette(),next=JSON.stringify(palette);if(next===paletteKey)return;paletteKey=next;renderer.setPalette(...palette);gpuRenderer?.setPalette(...palette);layoutVersion++;sentLayout=-1;currentConfig=null;}
 const motion=matchMedia('(prefers-reduced-motion: reduce)');
 let lastReducedMotion=motion.matches;
 const kinds=()=>settings.oceanSpecies==='mixed'?['hammerhead','tiger','mako','thresher']:Array(4).fill(settings.oceanSpecies);
 function stopFrames(){clearTimeout(timer);cancelAnimationFrame(raf);timer=raf=0;last=0;epoch++;}
 function detach(){
  stopFrames();worker?.stop();worker=null;replay?.cancel();replay=null;
  try{gpuCanvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();}catch(_){}
  gpuCanvas=gpuRenderer=gpuCompute=null;canvas?.remove();canvas=renderer=world=null;width=height=0;sentLayout=-1;currentConfig=null;paletteKey='';staticFrameKey='';
 }
 function active(){return !!settings.ocean && !document.hidden && !pausedBusy;}
 function coverage(){return cachedCoverage;}
 function updateClips(){
  cachedCoverage=dom.turns().length?settings.oceanCoverage:settings.oceanHome;
  document.documentElement.toggleAttribute('data-ast-ocean',settings.ocean&&cachedCoverage!=='off');
  const mode=coverage();clips=[];
  if(mode==='off')return;
  const main=dom.main();const mainRect=main?.getBoundingClientRect();
  const safe=mainRect&&mainRect.width>0?{x:Math.max(0,mainRect.left),y:0,w:Math.min(innerWidth,mainRect.right)-Math.max(0,mainRect.left),h:innerHeight}:{x:0,y:0,w:innerWidth,h:innerHeight};
  if(mode==='full'){clips.push(safe);return;}
  const rects=viewport.roots().map(n=>runtime.pageWork.rect(n)).filter(r=>r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight);
  if(mode==='glass')clips=rects.map(r=>({x:Math.max(safe.x,r.left),y:Math.max(0,r.top),w:Math.max(0,Math.min(safe.x+safe.w,r.right)-Math.max(safe.x,r.left)),h:Math.max(0,Math.min(innerHeight,r.bottom)-Math.max(0,r.top))})).filter(r=>r.w>0&&r.h>0);
  else if(mode==='gutter'){
   const reference=rects[0]||dom.shell()?.getBoundingClientRect();
   if(reference){const left=clamp(reference.left,safe.x,safe.x+safe.w),right=clamp(reference.right,safe.x,safe.x+safe.w);if(left>safe.x)clips.push({x:safe.x,y:0,w:left-safe.x,h:innerHeight});if(right<safe.x+safe.w)clips.push({x:right,y:0,w:safe.x+safe.w-right,h:innerHeight});}
  }
 }
 function resize(){
  if(!renderer||!world||!canvas)return;
  const w=innerWidth,h=innerHeight,ratio=Math.min(devicePixelRatio||1,settings.oceanQuality==='eco'?1:settings.oceanQuality==='fine'?1.5:1.25);
  if(w!==width||h!==height||dpr!==ratio){
   width=w;height=h;dpr=ratio;renderer.resize(w,h,ratio);world.resize(w,h,renderer.cellWidth,renderer.cellHeight);
   if(gpuRenderer){gpuRenderer.resize(w,h,ratio);gpuRenderer.setOcclusion([]);}
   canvas.style.width=w+'px';canvas.style.height=h+'px';layoutVersion++;sentLayout=-1;
  }
 }
 function drawBitmap(bitmap){
  if(!canvas||!renderer||!active())return;
  resize();const ctx=renderer.ctx;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
  if(!clips.length)return;
  ctx.save();ctx.beginPath();for(const r of clips)ctx.rect(r.x*dpr,r.y*dpr,r.w*dpr,r.h*dpr);ctx.clip();ctx.drawImage(bitmap,0,0);ctx.restore();canvas.dataset.state='running';drawFrames++;
 }
 function createMainGpu(){
  gpuFailure='';if(settings.oceanRenderer==='canvas'||typeof OffscreenCanvas!=='function')return;
  if(settings.oceanRenderer==='compute'){
   try{gpuCanvas=new OffscreenCanvas(1,1);const candidate=new AsciiRenderer(gpuCanvas,{});gpuCompute=createOceanComputeRenderer(gpuCanvas,candidate,oceanModel);gpuRenderer=candidate;backend='主线程 GPU 计算 + 绘制';}
   catch(error){gpuFailure=String(error);gpuCanvas=gpuRenderer=gpuCompute=null;}
  }
  if(!gpuRenderer){
   try{gpuCanvas=new OffscreenCanvas(1,1);const context=createOceanGpuContext(gpuCanvas);if(!context)throw Error('WebGL2 不可用');gpuRenderer=new AsciiRenderer(gpuCanvas,context);backend='主线程 GPU 绘制';}
   catch(error){gpuFailure=String(error);gpuCanvas=gpuRenderer=gpuCompute=null;}
  }
  if(gpuRenderer){gpuRenderer.setFontFamily('Consolas,"Courier New",monospace');gpuRenderer.setDetail(settings.oceanQuality==='eco');gpuRenderer.setExternalFieldClock(true);gpuRenderer.setPalette(...oceanPalette());gpuRenderer.resize(width,height,dpr);gpuRenderer.setOcclusion([]);}
 }
 function idleReplaySlice(done){
  const expected=canvas;
  const schedule=()=>{
   if(canvas!==expected||!settings.ocean){done();return;}
   if(document.hidden||(settings.oceanPauseBusy&&dom.isBusy())){setTimeout(schedule,1000);return;}
   if(typeof requestIdleCallback==='function')requestIdleCallback(()=>done(),{timeout:1500});else setTimeout(done,64);
  };
  schedule();
 }
 function create(){
  canvas=document.createElement('canvas');canvas.id='ast-ascii-ocean';canvas.setAttribute('aria-hidden','true');
  canvas.style.cssText=`position:fixed;inset:0;pointer-events:none;user-select:none;z-index:0;opacity:${settings.oceanOpacity};background:transparent;contain:strict`;
  document.body.prepend(canvas);
  world=new World(kinds().map((kind,i)=>({kind,size:[1,.7,.84,.77][i]})),settings.oceanDensity);
  renderer=new AsciiRenderer(canvas);renderer.setFontFamily('Consolas,"Courier New",monospace');renderer.setDetail(settings.oceanQuality==='eco');renderer.setExternalFieldClock(true);
  syncPalette();canvas.style.filter=pageIsDark()?'none':'brightness(.55)';
  resize();
  if(!failedWorker&&!motion.matches){
   const surface=canvas;
   worker=createOceanWorker(data=>{if(canvas!==surface||data.epoch!==epoch||data.layoutVersion!==layoutVersion)return;lastWorkMs=data.workMs||0;backend=data.gpuCompute?'GPU 计算 + 绘制':data.gpu?'GPU 绘制':'后台 Canvas';drawBitmap(data.bitmap);if(typeof ui!=='undefined')ui.updateOceanStatus(`${backend} · ${status}`);},error=>{
    if(canvas!==surface)return;failedWorker=true;workerFailure=String(error);status='后台线程不可用，已回退标准绘制';detach();if(active())refresh();console.warn('[AI Studio ocean]',error);
   },info=>{status=info.state==='preparing'?`正在准备回放 ${Math.floor((info.progress||0)*100)}%`:info.state==='ready'?'回放已就绪':info.state==='error'?'回放不可用，使用实时模拟':'实时模拟';if(typeof ui!=='undefined')ui.updateOceanStatus(`${backend} · ${status}`);});
  }
  backend=worker?'后台线程':'标准 Canvas';
  if(!worker&&!motion.matches){
   if(!workerFailure)workerFailure='后台线程或 OffscreenCanvas 不可用';
   createMainGpu();
   const expected=canvas;
   replay=createOceanReplayEngine(World,info=>{
    if(canvas!==expected)return;
    status=info.state==='preparing'?`空闲准备回放 ${Math.floor((info.progress||0)*100)}%`:info.state==='ready'?'回放已就绪':info.state==='error'?'回放不可用，使用实时模拟':'实时模拟';
    if(typeof ui!=='undefined')ui.updateOceanStatus(`${backend} · ${status}`);
   },idleReplaySlice);
  }
  status=settings.oceanMotion!=='live'?'等待准备回放':'实时模拟';
  if(typeof ui!=='undefined')ui.updateOceanStatus(`${backend} · ${status}`);
 }
 function makeConfig(){return {width,height,dpr,masks:[],layoutVersion,placementVersion:1,density:settings.oceanDensity,quality:settings.oceanQuality,rendererMode:settings.oceanRenderer,
  replaySeconds:settings.oceanMotion==='replay30'?1800:settings.oceanMotion==='replay15'?900:0,placementKey:[coverage()],kinds:kinds(),fish:world.fish,sharks:world.sharks,
  palette:{bodyTint:renderer.bodyTint,paletteAccents:renderer.paletteAccents,fishStyles:renderer.fishStyles,dotStyles:renderer.dotStyles}};}
 function draw(dt){
  resize();if(!clips.length)return;
  if(worker){if(worker.busy)return;const config=sentLayout!==layoutVersion?makeConfig():undefined;
   if(worker.send({config,dt,pointer:world.pointer,epoch})){sentLayout=layoutVersion;currentConfig=config||currentConfig;}return;
  }
  if(replay){if(!currentConfig||currentConfig.layoutVersion!==layoutVersion)currentConfig=makeConfig();replay.prepare(currentConfig,world);}
  const previousTime=world.time,fade=replay?.sample(world,dt)??null;
  if(fade!==null&&world.time<previousTime){renderer.energy.fill(0);renderer.heat.fill(0);if(gpuRenderer){gpuRenderer.energy.fill(0);gpuRenderer.heat.fill(0);}gpuCompute?.clearFields();}
  if(dt>0&&fade===null)world.step(dt);
  if(gpuRenderer){
   try{
    if(gpuCompute)gpuCompute.render(world,dt,[]);
    else{if(dt>0)gpuRenderer.advanceFields(world,dt);gpuRenderer.render(world,dt);gpuRenderer.ctx.flush?.();}
    const bitmap=gpuCanvas.transferToImageBitmap();try{drawBitmap(bitmap);}finally{bitmap.close();}return;
   }catch(error){gpuFailure=String(error);console.warn('[AI Studio ocean] GPU fallback',error);try{gpuCanvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();}catch(_){}gpuCanvas=gpuRenderer=gpuCompute=null;backend='标准 Canvas';if(typeof ui!=='undefined')ui.updateOceanStatus(`${backend} · ${status}`);}
  }
  const ctx=renderer.ctx;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);ctx.beginPath();for(const r of clips)ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();
  if(dt>0)renderer.advanceFields(world,dt);renderer.render(world,dt);ctx.restore();canvas.dataset.state=motion.matches?'reduced-motion':'running';drawFrames++;
 }
 function tick(now){
  raf=0;if(!active()||!canvas||motion.matches)return;
  const fps=targetFps(),elapsed=last?now-last:1000/fps;
  if(elapsed>=1000/fps-2){last=now;try{draw(Math.min(elapsed/1000,1.25/fps));}catch(error){status='动画绘制失败';console.warn('[AI Studio ocean]',error);detach();return;}}
  timer=setTimeout(()=>{timer=0;raf=requestAnimationFrame(tick);},Math.max(0,1000/fps-6));
 }
 function onPointer(event){if(world){world.pointer={x:event.clientX,y:event.clientY,active:true};}}
 function onLeave(){if(world)world.pointer.active=false;}
 function syncPointer(){const need=settings.ocean&&settings.oceanPointer;if(need===pointerBound)return;pointerBound=need;const method=need?'addEventListener':'removeEventListener';window[method]('pointermove',onPointer);window[method]('pointerleave',onLeave);}
 function refresh(){
  if(lastReducedMotion!==motion.matches){lastReducedMotion=motion.matches;detach();}
  pausedBusy=Boolean(settings.oceanPauseBusy&&dom.isBusy());
  updateClips();
  syncPointer();if(!settings.ocean||coverage()==='off'){detach();status='海洋已关闭';return;}
  if(!document.body)return;
  if(canvas&&!canvas.isConnected)detach();
  if(!active()){detach();status=document.hidden?'标签页隐藏，动画已暂停':'生成期间暂停';return;}
  if(!canvas)try{create();}catch(error){status='海洋未启动';console.warn('[AI Studio ocean]',error);detach();return;}
  canvas.hidden=false;canvas.style.opacity=String(settings.oceanOpacity);canvas.style.filter=document.documentElement.getAttribute('data-cgfc-theme')==='light'?'brightness(.55)':'none';syncPalette();resize();
  if(motion.matches){stopFrames();const key=JSON.stringify([width,height,dpr,paletteKey,clips]);if(key!==staticFrameKey){staticFrameKey=key;try{draw(0);}catch(error){console.warn('[AI Studio ocean]',error);}}status='减少动态效果：静态显示';backend='静态 Canvas';return;}
  if(!raf&&!timer)raf=requestAnimationFrame(tick);
 }
 function updateSettings(){
  const next=JSON.stringify([settings.oceanSpecies,settings.oceanDensity,settings.oceanQuality,settings.oceanRenderer,settings.oceanMotion]);
  if(next!==configKey){configKey=next;failedWorker=false;workerFailure='';detach();}
  refresh();
 }
 function clearReplay(){if(worker)worker.clearReplay();else (replay||createOceanReplayEngine(World)).clear().catch(error=>console.warn('[AI Studio ocean] cache',error));}
 function onVisibility(){refresh();}
 function onResize(){scheduleLayout();}
 function destroy(){detach();if(pointerBound){window.removeEventListener('pointermove',onPointer);window.removeEventListener('pointerleave',onLeave);pointerBound=false;}document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('resize',onResize);motion.removeEventListener?.('change',onVisibility);}
 document.addEventListener('visibilitychange',onVisibility);window.addEventListener('resize',onResize,{passive:true});motion.addEventListener?.('change',onVisibility);
 return {updateSettings,refresh,clearReplay,destroy,getStatus:()=>status,getState:()=>({active:!!canvas,worker:!!worker,backend,status,workerFailure,gpuFailure,replay:replay?.getState()||null,coverage:coverage(),clips:clips.length,frames:drawFrames,fpsCap:targetFps(),lastWorkMs})};
})();
