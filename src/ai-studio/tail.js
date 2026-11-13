// ═══ Explicitly started, conservative message queue ═══
const queue=(()=>{
 let items=readJSON(KEY.queue,[]),running=false,timer=0,inflight=null,disposed=false,releaseLock=null,starting=false,generation=0;
 const valid=value=>Array.isArray(value)?value.filter(x=>x&&typeof x.content==='string'&&x.content.trim()).map(x=>({id:String(x.id||uid()),content:x.content,route:String(x.route||location.pathname),status:x.status==='sending'||x.status==='uncertain'?'uncertain':'waiting'})):[];
 items=valid(items);
 const refreshUI=()=>{if(typeof ui!=='undefined')ui.queueChanged();};
 const persist=()=>{const saved=writeJSON(KEY.queue,items);refreshUI();return saved;};
 const notify=message=>{if(typeof ui!=='undefined')ui.toast(message);};
 function pause(message){generation++;starting=false;running=false;clearTimeout(timer);timer=0;releaseLock?.();releaseLock=null;if(inflight){const item=items.find(x=>x.id===inflight.id);if(item)item.status='uncertain';inflight=null;writeJSON(KEY.queue,items);}refreshUI();if(message)notify(message);}
 function plan(delay=800){clearTimeout(timer);if(running&&!disposed)timer=setTimeout(tick,delay);}
 function answerSignature(){const all=messages().filter(m=>m.role==='assistant');const last=all.at(-1);return `${all.length}:${last?pageIndex.source(last):''}`;}
 function tick(){
  timer=0;if(!running||disposed)return;
  if(document.hidden){pause('页面隐藏，队列已暂停');return;}
  if(inflight){
   if(location.pathname!==inflight.route){const current=items.find(x=>x.id===inflight.id);if(current)current.status='uncertain';persist();inflight=null;pause('页面已切换，请确认上一条发送状态');return;}
   const all=messages(),users=all.filter(m=>m.role==='user'),lastUser=users.at(-1);
   const accepted=users.length>inflight.users&&lastUser&&pageIndex.source(lastUser)===normalized(inflight.content);
   if(users.length>inflight.users&&!accepted){pause('检测到其他新消息，请确认发送状态');return;}
   const signature=answerSignature(),busy=dom.isBusy(),changed=signature!==inflight.answer&&accepted&&all.some(m=>m.role==='assistant'&&m.index>lastUser.index&&pageIndex.source(m).trim());
   if(busy)inflight.sawBusy=true;
   if(changed)inflight.sawAnswer=true;
   if(signature!==inflight.latest){inflight.latest=signature;inflight.quietAt=0;}
   if(!busy&&inflight.sawAnswer){
    if(!inflight.quietAt)inflight.quietAt=Date.now();
    if(Date.now()-inflight.quietAt>=2000){items=items.filter(x=>x.id!==inflight.id);persist();inflight=null;notify('队列消息已完成');plan(800);return;}
   }else inflight.quietAt=0;
   if(!inflight.sawAnswer&&!busy&&Date.now()-inflight.started>20000){const current=items.find(x=>x.id===inflight.id);if(current)current.status='uncertain';persist();inflight=null;pause('未检测到有效回答，队列已暂停，请检查原站状态');return;}
   plan();return;
  }
  const item=items[0];if(!item){pause('队列已发送完毕');return;}
  if(item.status!=='waiting'){pause('请先确认队列中状态待确认的消息');return;}
  if(item.route!==location.pathname){pause('队列属于另一页面，已暂停');return;}
  if(dom.isBusy()){plan();return;}
  const editor=dom.editor(),run=dom.runButton();
  if(!editor||!run){pause('未找到输入框或运行按钮');return;}
  if((editor.value??editor.textContent??'').trim()){pause('输入框有未发送草稿，队列已暂停');return;}
  if(!setEditorValue(item.content)){pause('填入队列消息失败');return;}
  const ticket=generation;
  timer=setTimeout(()=>{
   timer=0;if(!running||disposed)return;
   if(ticket!==generation||!items.includes(item))return;
   const current=dom.editor(),send=dom.runButton(),value=current?.value??current?.textContent??'';
   if(location.pathname!==item.route||document.hidden||dom.isBusy()||!send||send.disabled||send.getAttribute('aria-disabled')==='true'||value!==item.content){pause('输入或运行状态发生变化，队列已暂停');return;}
   const answer=answerSignature();item.status='sending';inflight={id:item.id,route:item.route,started:Date.now(),answer,latest:answer,users:messages().filter(m=>m.role==='user').length,content:item.content,sawBusy:false,sawAnswer:false,quietAt:0};
   if(!persist()){pause('保存队列失败，已暂停发送');return;}
   try{send.click();plan(500);}catch(_){pause('运行按钮响应异常，请确认发送状态');}
  },250);
 }
 function add(value){const content=String(value??'');if(!content.trim()){notify('队列内容为空');return false;}items.push({id:uid(),content,route:location.pathname,status:'waiting'});persist();notify('已加入队列');return true;}
 function remove(id){if(running||starting)pause('队列已暂停');items=items.filter(item=>item.id!==id);persist();}
 function toggle(){if(running||starting){pause('队列已暂停');return;}if(!items.length){notify('队列为空');return;}
  if(!navigator.locks){notify('此浏览器不支持跨标签页发送锁，请使用手动填入');return;}
  starting=true;const ticket=++generation;
  navigator.locks.request('ai-studio-toolbox-auto-send',{ifAvailable:true},async lock=>{
   if(disposed||ticket!==generation)return;
   starting=false;if(!lock){notify('另一标签页正在发送队列');return;}
   const released=new Promise(resolve=>{releaseLock=resolve;});running=true;refreshUI();notify('队列已启动');plan(0);await released;
  }).catch(error=>{if(ticket===generation)pause('无法取得发送锁：'+error.message);});
 }
 function retry(id){if(running||starting)pause();const item=items.find(x=>x.id===id);if(!item||item.status!=='uncertain')return;if(!confirm('请先检查原站对话。将此消息重新标记为待发送可能造成重复发送，继续？'))return;item.status='waiting';persist();}
 function routeChanged(){if(running||starting||inflight)pause('页面已切换，队列已暂停，请确认发送状态');}
 function externalUpdate(value){const pending=inflight?items.find(x=>x.id===inflight.id):null;inflight=null;if(running||starting)pause('另一标签页更新了队列，自动发送已暂停');items=valid(value);if(pending){const existing=items.find(x=>x.id===pending.id);if(existing)existing.status='uncertain';else items.unshift({...pending,status:'uncertain'});writeJSON(KEY.queue,items);}refreshUI();}
 function onStorage(event){if(event.key===KEY.queue){let value;try{value=JSON.parse(event.newValue||'[]');}catch(_){return;}externalUpdate(value);}}
 window.addEventListener('storage',onStorage);
 function replace(value){pause();inflight=null;items=valid(value);persist();}
 function destroy(){disposed=true;window.removeEventListener('storage',onStorage);pause();}
 return {get items(){return items;},get running(){return running;},add,remove,toggle,replace,retry,pause,routeChanged,destroy};
})();


// ═══ Preserve a user's reading position without wrapping native scroll APIs ═══
const scrollLock=(()=>{
 let baseline=null,manualUntil=0,captureTimer=0,frame=0,disposed=false;
 function findScroller(){
  for(const sample of [dom.turns().at(-1),dom.editor()])for(let el=sample?.parentElement;el&&el!==document.body;el=el.parentElement){
   if(el instanceof HTMLElement&&el.scrollHeight>el.clientHeight+3&&/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY))return el;
  }
  return document.scrollingElement||document.documentElement;
 }
 function capture(){if(disposed)return;const target=findScroller();baseline=target?{target,top:target.scrollTop,left:target.scrollLeft}:null;}
 function intent(duration=900){manualUntil=Date.now()+duration;clearTimeout(captureTimer);captureTimer=setTimeout(capture,duration+80);}
 function onUserEvent(event){if(event.type==='keydown'&&!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))return;intent();}
 function onScroll(event){
  if(disposed||frame)return;const target=event.target===document?document.scrollingElement:event.target;
  frame=requestAnimationFrame(()=>{frame=0;if(disposed)return;
   if(!settings.stopAutoScroll||!dom.isBusy()||Date.now()<manualUntil){capture();return;}
   if(!baseline||!baseline.target.isConnected){capture();return;}
   if(target!==baseline.target&&target!==document&&target!==window)return;
   if(Math.abs(baseline.target.scrollTop-baseline.top)>2)baseline.target.scrollTop=baseline.top;
   if(Math.abs(baseline.target.scrollLeft-baseline.left)>2)baseline.target.scrollLeft=baseline.left;
  });
 }
 function route(){baseline=null;intent(500);}
 function destroy(){disposed=true;clearTimeout(captureTimer);cancelAnimationFrame(frame);for(const type of ['wheel','touchstart','pointerdown','keydown'])document.removeEventListener(type,onUserEvent,true);}
 for(const type of ['wheel','touchstart','pointerdown','keydown'])document.addEventListener(type,onUserEvent,{capture:true,passive:true});
 return {capture,intent,onScroll,route,destroy};
})();


// ═══ Page lifecycle and interactions ═══
let disposed=false,observer=null,themeObserver=null,refreshTimer=0,maxRefreshTimer=0,scrollTimer=0,lastRoute=location.href;
function doRefresh(){
 clearTimeout(refreshTimer);clearTimeout(maxRefreshTimer);refreshTimer=maxRefreshTimer=0;if(disposed)return;
 pageIndex.stats.refreshes++;onRoute();
 try{ui.refresh();reading.refresh();refreshGlass();ocean.refresh();}catch(error){console.error('[AI Studio toolbox] refresh',error);}
}
function scheduleRefresh(){if(disposed)return;clearTimeout(refreshTimer);refreshTimer=setTimeout(doRefresh,350);if(!maxRefreshTimer)maxRefreshTimer=setTimeout(doRefresh,1600);}
function ignoredNode(node){
 const element=node instanceof Element?node:node.parentElement;
 return !!element&&(element.closest('#ast-toolbox-host, #ast-ascii-ocean, .ast-copy-button, [data-ast-owned], [data-cgfc-glass-effect], [data-cgfc-glass-tint], [data-cgfc-glass-rim], [data-cgfc-glass-sheen]')||element.id===APP_STYLE_ID||element.id==='ast-katex-style');
}
function onMutations(records){
 pageIndex.stats.mutationBatches++;
 if(lastRoute!==location.href)onRoute();
 if(!ui.host?.isConnected || (settings.ocean && !document.getElementById('ast-ascii-ocean'))){scheduleRefresh();}
 let relevant=false,structure=false;const dirty=new Set();
 for(const record of records){
  if(ignoredNode(record.target))continue;
  if(record.type==='childList'&&[...record.addedNodes,...record.removedNodes].every(ignoredNode))continue;
  const element=record.target instanceof Element?record.target:record.target.parentElement;
  const turn=element?.closest('ms-chat-turn');
  if(turn){dirty.add(turn);relevant=true;}
  if(record.type==='attributes'){
   if(element?.matches('body')){applySettings();relevant=true;}
   else if(element?.matches('ms-run-button,ms-run-button button'))relevant=true;
   continue;
  }
  if(record.type==='childList')for(const node of [...record.addedNodes,...record.removedNodes]){
   if(ignoredNode(node))continue;
   if(node instanceof Element){
    if(node.matches('ms-chat-turn,ms-prompt-box,ms-chunk-editor,textarea')||node.querySelector('ms-chat-turn,ms-prompt-box,ms-chunk-editor,textarea'))structure=true;
    if(!turn)relevant=true;
   }
  }
 }
 for(const turn of dirty)pageIndex.invalidate(turn);
 if(structure)pageIndex.invalidate(null,true);
 if(relevant)scheduleRefresh();
}
function scheduleLayout(){if(disposed||scrollTimer)return;scrollTimer=setTimeout(()=>{scrollTimer=0;if(!disposed){pageIndex.stats.layoutPasses++;refreshGlass();ocean.refresh();ui.refresh();reading.refreshCodeTools();reading.queueMath();}},100);}
function onScroll(event){if(ignoredNode(event.target))return;scrollLock.onScroll(event);scheduleLayout();}
function onRoute(){if(lastRoute===location.href)return;lastRoute=location.href;pageIndex.invalidate(null,true);queue.routeChanged();scrollLock.route();scheduleRefresh();}
function onPageVisibility(){if(!document.hidden){glassOpticsFrameValue=null;scheduleRefresh();}else{for(const controller of [composerGlassController,...glassControllers.values(),...messageGlassControllers.values()])controller?.pause();}}
async function onFormulaCopy(event){
 if(!settings.formulaCopy||!(event.target instanceof Element))return;
 const formula=event.target.closest('.katex,math,mjx-container,[data-latex],[data-math-source]');if(!formula||!formula.closest('ms-chat-turn'))return;
 let latex=formula.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()||formula.getAttribute('data-latex')||formula.getAttribute('data-math-source')||'';
 if(!latex){ui.toast('该公式未暴露 LaTeX 源码');return;}
 const block=formula.matches('.katex-display, math[display="block"], mjx-container[display="true"]')||!!formula.closest('.katex-display,[data-display="true"]');
 if(settings.formulaDelimiters)latex=block?`$$\n${latex}\n$$`:`$${latex}$`;
 event.preventDefault();event.stopPropagation();const copied=await copyText(latex);ui.toast(copied?'已复制公式 LaTeX':'公式复制失败');if(copied){formula.setAttribute('data-ast-formula-copied','');setTimeout(()=>formula.removeAttribute('data-ast-formula-copied'),1000);}
}
function destroy(){
 if(disposed)return;disposed=true;clearTimeout(refreshTimer);clearTimeout(maxRefreshTimer);clearTimeout(scrollTimer);cancelAnimationFrame(applySettingsFrame);applySettingsFrame=0;if(saveTimer)saveSettings();observer?.disconnect();themeObserver?.disconnect();viewport.destroy();
 document.removeEventListener('scroll',onScroll,true);document.removeEventListener('dblclick',onFormulaCopy,true);window.removeEventListener('popstate',onRoute);window.navigation?.removeEventListener('navigatesuccess',onRoute);
 document.removeEventListener('visibilitychange',onPageVisibility);window.removeEventListener('resize',scheduleLayout);window.removeEventListener('pagehide',onPageHide);window.removeEventListener('pageshow',onPageShow);
 queue.destroy();scrollLock.destroy();reading.destroy();ocean.destroy();destroyGlass();runtime.pageWork.destroy();ui.destroy();document.getElementById(APP_STYLE_ID)?.remove();
 restoreRootBaseline(document.documentElement);
 if(globalThis[INSTANCE]?.destroy===destroy)delete globalThis[INSTANCE];
}
function start(){
 if(!document.body||disposed)return;ui.mount();applySettings();reading.start();ui.updateTokens();scrollLock.capture();
 observer=new MutationObserver(onMutations);observer.observe(document.body,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['class','data-turn-role','disabled','aria-disabled','aria-label']});
 themeObserver=new MutationObserver(()=>applySettings());themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['class','data-theme','data-color-scheme']});
 document.addEventListener('visibilitychange',onPageVisibility);window.addEventListener('resize',scheduleLayout,{passive:true});window.addEventListener('pagehide',onPageHide);window.addEventListener('pageshow',onPageShow);
 document.addEventListener('scroll',onScroll,{capture:true,passive:true});document.addEventListener('dblclick',onFormulaCopy,true);window.addEventListener('popstate',onRoute);window.navigation?.addEventListener('navigatesuccess',onRoute);
 globalThis[INSTANCE]={version:VERSION,destroy,openSettings:()=>ui.showSettings(true),openToolbox:()=>ui.setNavOpen(true),openQueue:()=>ui.showQueue(true),resetLayout:()=>ui.resetLayout(),getState:()=>({version:VERSION,turns:messages().length,queue:queue.items.length,queueRunning:queue.running,ocean:ocean.getState(),math:{bundled:true,loaded:!!bundledKatexCache},performance:{...pageIndex.stats},settings:{...settings},ui:{tab:ui.tab,navOpen:!ui.navPanel.hidden,settingsOpen:!ui.settingsPanel.hidden,queueOpen:!ui.queuePanel.hidden,windows:Object.fromEntries([...ui.windows.windows].map(([key,value])=>[key,{...value.rect}]))}})};
}
function onPageHide(){queue.pause('页面离开，队列已暂停');ui.flushState();if(saveTimer)saveSettings();}
function onPageShow(event){if(event.persisted){pageIndex.invalidate(null,true);scheduleRefresh();}}
try{if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});}catch(error){console.error('[AI Studio toolbox] init failed',error);try{destroy();}catch(_) {}}
})();
