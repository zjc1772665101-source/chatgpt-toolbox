// Explicit, persisted queue state machine. It never interprets a button click as
// delivery: a new user turn and a stable assistant response must be observed.
const queue=(()=>{
  let running=false,starting=false,disposed=false,timer=0,generation=0,inflight=null,staged=null,releaseLock=null,completed=0,singleItemId=null;
  const life=new Lifetime();
  const normalizeFiles=value=>Array.isArray(value)?value.filter(file=>file&&typeof file.id==='string'&&typeof file.name==='string').map(file=>({id:file.id,name:file.name,type:String(file.type||'application/octet-stream'),size:Math.max(0,finite(file.size)),lastModified:finite(file.lastModified,Date.now())})):[];
  const normalize=value=>{
    if(!Array.isArray(value))return [];
    const ids=new Set();
    return value.filter(item=>item&&typeof item.content==='string'&&(item.content.trim()||item.attachments?.length)).slice(0,2000).map(item=>{
      let id=String(item.id||uid());if(ids.has(id))id=uid();ids.add(id);
      return {id,content:item.content.slice(0,2000000),title:String(item.title||'').slice(0,200),route:String(item.route||conversationRoute()).replace(/^\/u\/\d+(?=\/)/,''),status:['sending','uncertain'].includes(item.status)?'uncertain':'waiting',attachments:normalizeFiles(item.attachments),createdAt:finite(item.createdAt,Date.now())};
    });
  };
  let items=normalize(readJSON(KEY.queue,[]));

  function refreshUI(){try{ui.queueChanged();}catch(error){console.warn('[AI Studio queue UI]',error);}}
  function notify(message,error=false){ui.toast(message,error);}
  function persist(){const saved=writeJSON(KEY.queue,items);refreshUI();return saved;}
  function clearTimer(){clearTimeout(timer);timer=0;}
  function plan(delay=600){clearTimer();if(running&&!disposed)timer=setTimeout(()=>{timer=0;tick().catch(error=>pause(error.message||'队列状态检查失败'));},delay);}

  function pause(message){
    generation++;running=false;starting=false;singleItemId=null;clearTimer();
    if(inflight){const item=items.find(entry=>entry.id===inflight.id);if(item)item.status='uncertain';inflight=null;writeJSON(KEY.queue,items);}
    if(staged&&!staged.attachments.length){const editor=dom.editor();if(staged.wroteText&&(editor?.value??editor?.textContent??'')===staged.content)setEditorValue('');staged=null;}
    const release=releaseLock;releaseLock=null;release?.();refreshUI();if(message)notify(message);
  }

  function answerSnapshot(){
    const assistants=messages().filter(message=>message.role==='assistant');
    const last=assistants.at(-1);
    return {count:assistants.length,last:last?last.index:-1,text:last?pageIndex.source(last):''};
  }

  function userSnapshot(){return messages().filter(message=>message.role==='user');}

  function sameConversation(item){return item.route===conversationRoute();}

  function adoptNewConversation(){
    if(!inflight||!/^\/prompts\/new_chat$/.test(inflight.route)||!/^\/prompts\/(?!new_chat$)[^/]+$/.test(conversationRoute())||inflight.usersBefore!==0)return false;
    const users=userSnapshot();if(users.length!==1)return false;
    const source=pageIndex.source(users[0]);
    if(inflight.content.trim()&&normalized(source)!==normalized(inflight.content))return false;
    const old=inflight.route,next=conversationRoute();inflight.route=next;
    for(const item of items)if(item.route===old)item.route=next;
    persist();return true;
  }

  function routeChanged(){
    if(!running&&!starting&&!inflight)return;
    if(adoptNewConversation())return;
    pause('会话已切换，队列已暂停，请确认上一条发送状态');
  }

  async function waitForAttachments(metadata,ticket){
    if(!metadata.length)return;
    const started=Date.now();
    while(Date.now()-started<20000){
      if(ticket!==generation||!running||disposed)throw Error('附件准备已取消');
      const names=nativeAttachments();
      const ready=metadata.every(file=>names.some(name=>name.includes(file.name)));
      const shell=dom.editor()?.closest('footer,ms-prompt-box')||dom.shell();
      const pending=shell?.querySelector('[role="progressbar"],.uploading,.upload-progress,[aria-busy="true"]');
      if(ready&&!pending)return;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw Error('附件尚未确认上传完成，已暂停。请在原站检查附件后手动发送。');
  }

  async function tick(){
    if(!running||disposed)return;
    if(document.hidden&&settings.queuePauseHidden){pause('页面隐藏，发送队列已暂停');return;}
    if(inflight){
      if(inflight.route!==conversationRoute()&&!adoptNewConversation()){routeChanged();return;}
      const users=userSnapshot();
      if(users.length>inflight.usersBefore+1){pause('检测到其他新提问，发送队列已暂停');return;}
      const accepted=users.length===inflight.usersBefore+1;
      const lastUser=accepted?users.at(-1):null;
      const answer=answerSnapshot();
      const hasAnswer=accepted&&answer.last>lastUser.index&&answer.text.trim().length>0;
      const changed=answer.count!==inflight.answerBefore.count||answer.text!==inflight.answerBefore.text;
      const busy=dom.isBusy();
      if(busy)inflight.sawBusy=true;
      if(hasAnswer&&changed)inflight.sawAnswer=true;
      const signature=answer.count+':'+answer.text;
      if(signature!==inflight.latest){inflight.latest=signature;inflight.quietAt=0;}
      if(!busy&&accepted&&inflight.sawAnswer){
        if(!inflight.quietAt)inflight.quietAt=Date.now();
        if(Date.now()-inflight.quietAt>=settings.queueQuietSeconds*1000){
          const finished=items.find(item=>item.id===inflight.id);
          items=items.filter(item=>item.id!==inflight.id);inflight=null;completed++;persist();
          if(finished?.attachments.length)releaseAttachments(finished.attachments.map(file=>file.id)).catch(error=>console.warn('[AI Studio queue files]',error));
          if(finished?.id===singleItemId){pause('此条消息已完成，其他队列项保持暂停');return;}
          notify('队列消息已完成');plan(settings.queueDelay*1000);return;
        }
      }else inflight.quietAt=0;
      if(!busy&&!inflight.sawAnswer&&Date.now()-inflight.started>settings.queueTimeout*1000){pause('没有检测到有效回答，已保留待确认消息。请检查原站错误提示。');return;}
      plan();return;
    }
    const item=items[0];
    if(!item){pause('队列已发送完毕');return;}
    if(item.status!=='waiting'){pause('队列首条状态待确认，请先检查原站再重新标记待发');return;}
    if(!sameConversation(item)){pause('队列属于另一会话，请在原会话中继续');return;}
    if(dom.isBusy()){plan();return;}
    const editor=dom.editor(),send=dom.runButton();
    if(!editor||!send){pause('未找到 AI Studio 输入框或运行按钮');return;}
    const nativeNames=nativeAttachments(),nativeValue=editor.value??editor.textContent??'';
    const resumeStaged=staged?.id===item.id&&(nativeValue===staged.content||(!staged.wroteText&&!nativeValue.trim()))&&item.attachments.every(file=>nativeNames.some(name=>name.includes(file.name)))&&nativeNames.every(name=>item.attachments.some(file=>name.includes(file.name)));
    if(!resumeStaged&&((editor.value??editor.textContent??'').trim()||nativeAttachments().length)){pause('原站输入框有草稿或附件，已暂停以保留现有内容');return;}
    const ticket=generation;
    try{
      if(!resumeStaged){staged={id:item.id,content:item.content,attachments:item.attachments,wroteText:false};if(item.attachments.length){await insertNativeAttachments(item.attachments);await waitForAttachments(item.attachments,ticket);}}
      if(ticket!==generation||!running||disposed)return;
      if(!setEditorValue(item.content)){pause('无法写入原站输入框');return;}
      staged.wroteText=true;
      await new Promise(resolve=>setTimeout(resolve,250));
      if(ticket!==generation||!running||disposed||!items.includes(item))return;
      const current=dom.editor(),button=dom.runButton(),value=current?.value??current?.textContent??'';
      if(!sameConversation(item)||(document.hidden&&settings.queuePauseHidden)||dom.isBusy()||!button||button.disabled||button.getAttribute('aria-disabled')==='true'||value!==item.content){pause('输入、会话或运行状态变化，已暂停发送');return;}
      const baseline=answerSnapshot();
      staged=null;
      inflight={id:item.id,route:item.route,content:item.content,started:Date.now(),usersBefore:userSnapshot().length,answerBefore:baseline,latest:baseline.count+':'+baseline.text,quietAt:0,sawBusy:false,sawAnswer:false};
      item.status='sending';
      if(!persist()){pause('发送状态未能保存，已暂停发送');return;}
      button.click();plan(400);
    }catch(error){if(ticket===generation)pause(error.message||'准备发送失败');}
  }

  function start(onlyId=null){
    if(disposed||running||starting)return;
    if(!items.length){notify('队列为空');return;}
    if(!navigator.locks){notify('浏览器不支持跨标签页发送锁，请使用手动填入',true);return;}
    singleItemId=onlyId;starting=true;const ticket=++generation;refreshUI();
    navigator.locks.request('ai-studio-toolbox-auto-send',{ifAvailable:true},async lock=>{
      if(disposed||ticket!==generation)return;
      starting=false;
      if(!lock){refreshUI();notify('另一标签页正在自动发送，请先在那里暂停');return;}
      const released=new Promise(resolve=>{releaseLock=resolve;});running=true;refreshUI();notify('队列已启动');plan(0);await released;
    }).catch(error=>{if(ticket===generation)pause('无法取得发送锁：'+error.message);});
  }

  function toggle(){if(running||starting)pause('队列已暂停');else start();}

  function add(value,metadata=undefined,attachments=undefined){
    const content=String(value??''),files=normalizeFiles(attachments);
    if(!content.trim()&&!files.length){notify('队列内容为空');return false;}
    if(items.length>=2000){notify('队列已达到 2000 条上限，请先发送或导出整理');return false;}
    const item={id:uid(),content,title:String(metadata?.title||''),route:conversationRoute(),status:'waiting',attachments:files,createdAt:Date.now()};items.push(item);
    if(!persist()){items.pop();refreshUI();notify('无法保存队列，消息未加入',true);return false;}
    notify('已加入队列');return true;
  }

  function update(id,content,attachments){
    const item=items.find(entry=>entry.id===id);if(!item||item.status==='sending')return false;
    if(running||starting)pause('编辑队列后自动发送已暂停');
    const files=normalizeFiles(attachments??item.attachments);if(!String(content).trim()&&!files.length){notify('消息不能同时没有文字和附件');return false;}
    item.content=String(content);item.attachments=files;return persist();
  }

  function remove(id,options={}){
    const item=items.find(entry=>entry.id===id);if(!item)return;
    if(running||starting)pause('队列已暂停');items=items.filter(entry=>entry.id!==id);persist();
    if(staged?.id===id)staged=null;
    if(!options.retainFiles&&item.attachments.length)releaseAttachments(item.attachments.map(file=>file.id)).catch(()=>{});
  }

  function move(id,delta){
    const index=items.findIndex(item=>item.id===id),target=index+delta;
    if(index<0||target<0||target>=items.length||items[index].status==='sending')return;
    if(running||starting)pause('调整队列顺序后自动发送已暂停');
    const [item]=items.splice(index,1);items.splice(target,0,item);persist();
  }

  function clear(){const files=items.flatMap(item=>item.attachments.map(file=>file.id));pause();items=[];staged=null;persist();releaseAttachments(files).catch(()=>{});}
  function replace(value){pause();staged=null;items=normalize(value);persist();}
  function retry(id,confirmed=false){const item=items.find(entry=>entry.id===id);if(!item||item.status!=='uncertain')return;if(!confirmed){notify('请在队列面板中确认重新发送');return;}if(running||starting)pause();item.status='waiting';persist();}
  function sendNow(id){
    const item=items.find(entry=>entry.id===id);if(!item)return;
    if(item.status!=='waiting'){notify('请先确认该消息的发送状态');return;}
    if(running||starting)pause('队列已暂停');
    items=[item,...items.filter(entry=>entry!==item)];persist();start(id);
  }

  function externalUpdate(value){
    const pending=inflight?items.find(item=>item.id===inflight.id):null;inflight=null;
    if(running||starting)pause('另一标签页更新了队列，自动发送已暂停');
    items=normalize(value);
    if(pending){const existing=items.find(item=>item.id===pending.id);if(existing)existing.status='uncertain';else items.unshift({...pending,status:'uncertain'});writeJSON(KEY.queue,items);}
    refreshUI();
  }

  life.listen(window,'storage',event=>{if(event.key===KEY.queue){try{externalUpdate(JSON.parse(event.newValue||'[]'));}catch(_) { /* Invalid external storage is not a reason to send anything. */ }}});
  life.listen(document,'input',event=>{if(event.isTrusted&&(running||starting)&&event.target===dom.editor())pause('你正在编辑原站输入框，队列已暂停');},true);
  life.listen(document,'pointerdown',event=>{if(!event.isTrusted||(!running&&!starting))return;const run=dom.runButton();if(run&&(event.target===run||run.contains(event.target)))pause('你手动操作了运行按钮，队列已暂停');},true);
  life.listen(document,'visibilitychange',()=>{if(document.hidden&&settings.queuePauseHidden&&(running||starting))pause('页面隐藏，发送队列已暂停');});

  function destroy(){disposed=true;pause();life.destroy();}
  return {get items(){return items;},get running(){return running||starting;},get completed(){return completed;},get phase(){return starting?'acquiring-lock':running?'running':'paused';},add,update,remove,move,clear,replace,retry,sendNow,start,toggle,pause,routeChanged,destroy};
})();
