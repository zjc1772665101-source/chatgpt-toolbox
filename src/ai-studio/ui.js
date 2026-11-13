class ToolboxApp {
  constructor(){
    this.host=null;this.shadow=null;this.navPanel=null;this.settingsPanel=null;this.queuePanel=null;this.launcher=null;this.tokenBadge=null;
    this.state=normalizeUIState(readJSON(KEY.ui,{}));
    this.tab=['conversation','headings','search','prompts','export'].includes(this.state.tab)?this.state.tab:'conversation';
    this.life=new Lifetime();this.windows=null;this.dialogs=null;
    this.navigation=new NavigationView(this);this.prompts=new PromptLibraryView(this);this.exporter=new ConversationExportView(this);
    this.queueView=null;this.settingsEditor=null;this.toastTimer=0;this.stateTimer=0;this.hoverTimer=0;this.oceanStatus='';this.lastRoute=conversationRoute();this.lastStats='';
  }

  persistState(){if(this.destroyed)return;clearTimeout(this.stateTimer);this.stateTimer=setTimeout(()=>{this.stateTimer=0;writeJSON(KEY.ui,this.state);},160);}
  flushState(){
    clearTimeout(this.stateTimer);this.stateTimer=0;
    if(this.settingsEditor&&!this.settingsEditor.query)for(const [id,entry]of this.settingsEditor.groups)(this.state.groups??={})[id]=entry.details.open;
    this.windows?.finishGesture(true);this.windows?.flush();writeJSON(KEY.ui,this.state);
  }

  createWindow(id,title,name,defaults){
    const panel=text('section',undefined,`ast-window panel ast-${id}`);panel.hidden=true;panel.tabIndex=-1;panel.setAttribute('aria-label',title);
    const header=text('header',undefined,'ast-window-header');
    const caption=text('div',undefined,'ast-header-title');caption.append(icon('grip',15),icon(name,17),text('span',title));caption.firstChild.classList.add('ast-header-grip');
    const actions=text('div',undefined,'ast-header-actions');
    actions.append(actionButton('down','折叠 '+title,()=>this.windows.collapse(id),{iconOnly:true}),actionButton('maximize','最大化或恢复 '+title,()=>this.windows.maximize(id),{iconOnly:true}),actionButton('close','关闭 '+title,()=>this.closeWindow(id),{iconOnly:true}));
    header.append(caption,actions);
    const body=text('div',undefined,'ast-window-body');panel.append(header,body);this.shadow.append(panel);
    this.windows.register(id,panel,header,{...defaults,label:title});
    return {panel,header,body};
  }

  mount(){
    if(this.host?.isConnected)return;
    this.teardownSurface();this.destroyed=false;this.life=new Lifetime();
    this.host=text('div');this.host.id='ast-toolbox-host';this.host.setAttribute('data-ast-version',VERSION);this.host.style.cssText='position:fixed!important;inset:0!important;z-index:2147482000!important;pointer-events:none!important';
    this.shadow=this.host.attachShadow({mode:'open'});
    this.shadow.append(text('style',TOOLBOX_CSS));
    this.windows=new FloatingWindows(this.host,'ai-studio-toolbox-layout-v4',()=>this.requestLayout());
    this.dialogs=new Dialogs(this.shadow);
    this.buildLauncher();this.buildNavigation();
    this.settingsEditor=new SettingsEditor(this);this.settingsPanel=this.settingsEditor.build();
    this.queueView=new QueueView(this);this.queuePanel=this.queueView.build();
    this.buildDock();this.buildTokenSummary();
    this.toastNode=text('div','','ast-toast');this.toastNode.hidden=true;this.toastNode.setAttribute('role','status');this.toastNode.setAttribute('aria-live','polite');this.shadow.append(this.toastNode);
    document.body.append(this.host);
    this.life.listen(document,'keydown',event=>this.handleKey(event),true);
    this.life.listen(window,'storage',event=>this.onStorage(event));
    this.life.listen(document,'ast-storage-error',()=>this.toast('浏览器本地存储写入失败；请先导出备份，避免刷新后丢失本次修改。',true));
    this.life.listen(document,'ast-settings-saved',event=>{if(this.settingsEditor?.status){this.settingsEditor.status.textContent=event.detail.saved?`${Object.keys(SCHEMA).length} 项设置 · 已保存`:'本次设置未保存，请导出备份';this.settingsEditor.status.classList.toggle('ast-error',!event.detail.saved);}});
    this.life.listen(this.host,'pointerenter',()=>this.cancelHoverClose());
    this.life.listen(this.host,'pointerleave',()=>this.scheduleHoverClose());
    this.life.listen(window,'resize',()=>this.requestLayout(),{passive:true});
    this.setNavOpen(this.state.navOpen,false);this.showQueue(this.state.queueOpen,false);this.showSettings(this.state.settingsOpen,false);
    this.renderTab();this.syncSettings();this.queueView.render();this.requestLayout();
  }

  buildLauncher(){
    const bar=text('div',undefined,'ast-launcher');bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','AI Studio 工具箱入口，可拖动');
    const grip=text('span',undefined,'ast-launcher-grip');grip.append(icon('grip',14));grip.title='按住拖动工具箱入口';bar.append(grip);
    this.navToggle=actionButton('menu','工具箱',()=>this.setNavOpen(this.navPanel.hidden));this.navToggle.setAttribute('aria-label','打开或收起工具箱');this.navToggle.setAttribute('aria-controls','ast-nav-window');
    this.settingsToggle=actionButton('settings','设置',()=>this.showSettings(this.settingsPanel.hidden));this.settingsToggle.setAttribute('aria-label','打开工具箱设置');this.settingsToggle.setAttribute('aria-controls','ast-settings-window');
    this.queueToggle=actionButton('queue','队列',()=>this.showQueue(this.queuePanel.hidden),{iconOnly:true});this.queueToggle.setAttribute('aria-label','打开或收起发送队列');
    bar.append(this.navToggle,this.settingsToggle,this.queueToggle);this.shadow.append(bar);this.launcher=bar;
    this.windows.registerLauncher(bar,{width:226,height:42});
    this.life.listen(bar,'contextmenu',event=>{event.preventDefault();this.showLayoutMenu();});
    this.life.listen(this.navToggle,'pointerenter',()=>{
      if(!settings.navHoverExpand||!this.navPanel.hidden)return;
      this.hoverTimer=setTimeout(()=>{this.hoverTimer=0;this.transientNav=true;this.setNavOpen(true,false);},260);
    });
    this.life.listen(this.navToggle,'pointerleave',()=>{if(this.hoverTimer){clearTimeout(this.hoverTimer);this.hoverTimer=0;}});
  }

  buildNavigation(){
    const entry=this.createWindow('nav','对话工具箱','list',{width:settings.toolboxWidth,height:620,minWidth:260,minHeight:240,side:'right',top:78});
    this.navPanel=entry.panel;this.navPanel.id='ast-nav-window';this.navHeader=entry.header;
    const tabs=text('div',undefined,'ast-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','工具箱视图');
    for(const [id,label,name] of [['conversation','问答','list'],['headings','章节','book'],['search','搜索','search'],['prompts','提示词','edit'],['export','导出','export']]){
      const control=actionButton(name,label,()=>this.showTab(id));control.dataset.tab=id;control.setAttribute('role','tab');control.setAttribute('aria-controls','ast-nav-view');tabs.append(control);
    }
    this.tabs=tabs;entry.body.before(tabs);entry.body.classList.add('ast-nav-content');entry.body.style.overflow='hidden';entry.body.id='ast-nav-view';entry.body.setAttribute('role','tabpanel');this.navBody=entry.body;
    const footer=text('footer',undefined,'ast-window-footer');
    this.navCount=text('span','','ast-spacer');footer.append(this.navCount,actionButton('up','回到对话顶部',()=>this.jumpBoundary(false),{iconOnly:true}),actionButton('down','回到对话底部',()=>this.jumpBoundary(true),{iconOnly:true}),actionButton('settings','打开工具箱设置',()=>this.showSettings(true),{iconOnly:true}));
    this.navPanel.append(footer);
    this.life.listen(tabs,'keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      const controls=[...tabs.querySelectorAll('button')].filter(node=>!node.hidden);const index=controls.indexOf(event.target);if(index<0)return;
      const target=event.key==='Home'?0:event.key==='End'?controls.length-1:(index+(event.key==='ArrowRight'?1:-1)+controls.length)%controls.length;
      event.preventDefault();controls[target].focus();controls[target].click();
    });
  }

  buildDock(){
    this.composerDock=text('div',undefined,'ast-composer-dock');this.composerDock.setAttribute('role','toolbar');this.composerDock.setAttribute('aria-label','发送队列快捷入口');
    this.dockQueueButton=actionButton('queue','队列',()=>this.showQueue(!this.state.queueOpen));
    this.dockCount=text('span','','ast-tag');
    this.composerDock.append(this.dockQueueButton,this.dockCount,actionButton('plus','排队当前草稿',()=>{this.queueView.enqueueCurrent();this.showQueue(true);},{iconOnly:true}));this.shadow.append(this.composerDock);
  }

  buildTokenSummary(){
    this.tokenBadge=text('div',undefined,'ast-token-summary');this.tokenBadge.hidden=true;this.tokenBadge.title='输入 / 输出 / 已加载上下文的本地估算；不是官方 usage';this.tokenBadge.setAttribute('aria-label','Token 估算汇总');this.shadow.append(this.tokenBadge);
  }

  setNavOpen(open,persist=true){
    if(!this.navPanel)return;
    this.navPanel.hidden=!open;this.navToggle?.setAttribute('aria-expanded',String(open));
    if(open){this.windows.ensureVisible('nav');this.refreshView();}
    if(persist){this.transientNav=false;this.state.navOpen=!!open;this.persistState();}
    this.requestLayout();
  }

  showSettings(show=true,persist=true){
    if(!this.settingsPanel)return;
    if(show)this.previousFocus=this.shadow.activeElement||document.activeElement;
    this.settingsPanel.hidden=!show;this.settingsToggle?.setAttribute('aria-expanded',String(show));
    this.state.settingsOpen=!!show;
    if(show){this.windows.ensureVisible('settings');this.settingsEditor.sync();this.settingsEditor.focus();}
    else if(this.previousFocus?.isConnected)this.previousFocus.focus({preventScroll:true});
    if(persist)this.persistState();
    this.host.toggleAttribute('data-settings-open',show);this.requestLayout();
  }

  showQueue(show=true,persist=true){
    if(!this.queuePanel)return;
    this.queuePanel.hidden=!show;this.state.queueOpen=!!show;this.queueToggle?.setAttribute('aria-expanded',String(show));
    if(show){this.windows.ensureVisible('queue');this.queueView.render();}
    if(persist)this.persistState();this.requestLayout();
  }

  closeWindow(id){if(id==='settings')this.showSettings(false);else if(id==='queue')this.showQueue(false);else this.setNavOpen(false);}

  showTab(tab){
    if(tab==='queue'){this.showQueue(true);return;}
    if(!['conversation','headings','search','prompts','export'].includes(tab))return;
    if(!settings.showNav&&['conversation','headings'].includes(tab))tab='prompts';
    this.tab=tab;this.state.tab=tab;this.persistState();this.setNavOpen(true);this.renderTab();
  }

  renderTab(){
    if(!this.navBody)return;
    this.navigation.destroy();this.navBody.replaceChildren();
    for(const tab of this.tabs.querySelectorAll('[data-tab]')){const selected=tab.dataset.tab===this.tab;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}
    if(this.tab==='prompts')this.prompts.mount(this.navBody);
    else if(this.tab==='export')this.exporter.mount(this.navBody);
    else this.navigation.mount(this.navBody,this.tab);
    this.requestLayout();
  }

  refreshView(){
    if(this.navPanel?.hidden)return;
    if(['conversation','headings','search'].includes(this.tab))this.navigation.refresh();
    else if(this.tab==='export')this.exporter.updateStatus();
  }

  toast(message,error=false){
    if(!this.toastNode)return;this.toastNode.textContent=String(message);this.toastNode.toggleAttribute('data-error',error);this.toastNode.hidden=false;
    clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>{if(this.toastNode)this.toastNode.hidden=true;},error?5500:3000);
  }

  syncSettings(){
    if(!this.host)return;
    const dark=document.documentElement.getAttribute('data-cgfc-theme')==='dark';this.host.dataset.theme=dark?'dark':'light';
    const put=(key,value)=>this.host.style.setProperty(key,value);
    put('--ast-font',cssFont(settings.toolboxFont,'"Segoe UI",sans-serif'));put('--ast-font-size',settings.toolboxFontSize+'px');put('--ast-line-height',String(settings.toolboxLineHeight));
    put('--ast-queue-font',cssFont(settings.queueFont,'"Segoe UI",sans-serif'));put('--ast-queue-font-size',settings.queueFontSize+'px');put('--ast-queue-line-height',String(settings.queueLineHeight));
    const rgb=hex=>hex.match(/[a-f0-9]{2}/gi).map(value=>parseInt(value,16)).join(',');
    for(const name of ['--ast-text','--ast-bg','--ast-accent','--ast-opacity'])this.host.style.removeProperty(name);
    if(settings.toolboxUseCustomColors){put('--ast-text',settings.toolboxTextColor);put('--ast-bg',rgb(settings.toolboxBackgroundColor));put('--ast-accent',settings.toolboxAccentColor);put('--ast-opacity',String(settings.toolboxBackgroundOpacity));}
    if(this.queuePanel){
      for(const name of ['--ast-text','--ast-bg','--ast-accent','--ast-opacity'])this.queuePanel.style.removeProperty(name);
      if(settings.queueUseCustomColors){for(const [name,value]of [['--ast-text',settings.queueTextColor],['--ast-bg',rgb(settings.queueBackgroundColor)],['--ast-accent',settings.queueAccentColor],['--ast-opacity',String(settings.queueBackgroundOpacity)]])this.queuePanel.style.setProperty(name,value);}
    }
    for(const label of this.launcher.querySelectorAll('.ast-action>span'))label.hidden=!settings.showToolbarLabels;
    for(const tab of this.tabs.querySelectorAll('[data-tab]'))tab.hidden=!settings.showNav&&['conversation','headings'].includes(tab.dataset.tab);
    if(!settings.showNav&&['conversation','headings'].includes(this.tab)){this.tab='prompts';this.renderTab();}
    this.settingsEditor?.sync();this.updateTokens();this.requestLayout();
  }

  updateTokens(){
    if(!this.tokenBadge)return;
    this.tokenBadge.hidden=!(settings.showTokenStats&&settings.showTokenSummary);
    if(this.tokenBadge.hidden)return;
    const stats=typeof reading!=='undefined'?reading.statistics():{input:0,output:0,total:0,messages:0};
    const signature=JSON.stringify(stats);
    if(signature!==this.lastStats){this.lastStats=signature;this.tokenBadge.replaceChildren();for(const [label,value]of [['输入',stats.input],['输出',stats.output],['上下文',stats.total]]){const entry=text('span');entry.append(text('span',label+' ','ast-token-label'),text('strong','≈ '+value.toLocaleString()));this.tokenBadge.append(entry,document.createTextNode('  '));}}
    this.tokenBadge.toggleAttribute('data-compact',settings.tokenSummaryCompact||innerWidth<650);
    this.tokenBadge.style.color=settings.tokenCustomColors?settings.tokenTextColor:'';
    this.tokenBadge.style.background=settings.tokenCustomColors?settings.tokenBackgroundColor:'';
  }

  positionAuxiliary(){
    if(!this.host?.isConnected)return;
    const shell=dom.shell(),rect=shell?runtime.pageWork.rect(shell):null;
    const dockVisible=settings.showComposerDock&&rect&&rect.width>160&&rect.top<innerHeight&&rect.bottom>0;
    this.composerDock.hidden=!dockVisible;
    if(dockVisible){this.composerDock.style.left=clamp(rect.right-this.composerDock.offsetWidth-8,8,innerWidth-this.composerDock.offsetWidth-8)+'px';this.composerDock.style.top=clamp(rect.top-this.composerDock.offsetHeight-7,8,innerHeight-this.composerDock.offsetHeight-8)+'px';}
    if(this.tokenBadge&&!this.tokenBadge.hidden){
      const [vertical,horizontal]=settings.tokenSummaryPosition.split('-');
      this.tokenBadge.style.left='auto';this.tokenBadge.style.right='auto';this.tokenBadge.style.top='auto';this.tokenBadge.style.bottom='auto';
      this.tokenBadge.style[horizontal]=clamp(settings.tokenSummaryOffsetX,8,Math.max(8,innerWidth-this.tokenBadge.offsetWidth-8))+'px';this.tokenBadge.style[vertical]=clamp(settings.tokenSummaryOffsetY,8,Math.max(8,innerHeight-this.tokenBadge.offsetHeight-8))+'px';
      if(settings.tokenSummaryAvoidQueue&&!this.queuePanel.hidden){
        const queueRect=runtime.pageWork.rect(this.queuePanel),badgeRect=runtime.pageWork.rect(this.tokenBadge);
        if(badgeRect.left<queueRect.right+8&&badgeRect.right>queueRect.left-8&&badgeRect.top<queueRect.bottom+8&&badgeRect.bottom>queueRect.top-8){this.tokenBadge.style.top='auto';this.tokenBadge.style.bottom=clamp(innerHeight-queueRect.top+8,8,Math.max(8,innerHeight-this.tokenBadge.offsetHeight-8))+'px';}
      }
    }
  }

  requestLayout(){
    if(this.layoutFrame||!this.host)return;
    this.layoutFrame=requestAnimationFrame(()=>{this.layoutFrame=0;this.positionAuxiliary();if(typeof scheduleLayout==='function')scheduleLayout();});
  }

  queueChanged(){if(!this.host)return;this.queueView?.render();const count=queue.items.length;this.dockCount.textContent=String(count);this.dockCount.hidden=!count;this.queueToggle.title=`发送队列 · ${count} 条`;this.requestLayout();}
  updateOceanStatus(value){if(this.oceanStatus===value)return;this.oceanStatus=value;if(this.settingsEditor?.oceanStatus)this.settingsEditor.oceanStatus.textContent=value;}
  getPrompts(){return this.prompts.store.items;}
  isBookmarked(message){return !!this.navigation.labels.get(message).bookmarked;}
  toggleBookmark(message){const value=this.navigation.labels.toggleBookmark(message);this.navigation.signature='';this.refreshView();this.toast(value?'已添加书签':'已移除书签');}

  refresh(){
    if(!this.host?.isConnected)this.mount();
    const route=conversationRoute();if(route!==this.lastRoute){this.lastRoute=route;this.exporter.routeChanged();this.navigation.signature='';}
    this.refreshView();this.navCount.textContent=`${messages().length} 条消息 · 已加载`;
    this.updateTokens();this.positionAuxiliary();
    if(!this.settingsPanel.hidden&&this.settingsEditor.category==='diagnostics')this.settingsEditor.sync();
  }

  jumpBoundary(bottom){scrollLock.intent(1800);const scroller=findConversationScroller();scroller.scrollTo({top:bottom?scroller.scrollHeight:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}

  handleKey(event){
    if(event.defaultPrevented)return;
    if(event.key==='Escape'){
      if(this.dialogs?.current)return;
      const visible=[['settings',this.settingsPanel],['queue',this.queuePanel],['nav',this.navPanel]].filter(([,panel])=>panel&&!panel.hidden).sort((a,b)=>Number(b[1].style.zIndex)-Number(a[1].style.zIndex));
      if(visible.length){event.preventDefault();event.stopPropagation();this.closeWindow(visible[0][0]);}
      return;
    }
    if(!settings.keyboardShortcuts||!event.altKey||event.ctrlKey||event.metaKey)return;
    const key=event.key.toLowerCase();
    if(key==='g'&&!event.shiftKey){event.preventDefault();this.setNavOpen(this.navPanel.hidden);}
    else if(key==='s'&&!event.shiftKey){event.preventDefault();this.showSettings(this.settingsPanel.hidden);}
    else if(key==='q'&&!event.shiftKey){event.preventDefault();this.showQueue(this.queuePanel.hidden);}
    else if(key==='r'&&event.shiftKey){event.preventDefault();this.resetLayout();}
  }

  resetLayout(){this.windows.reset();this.windows.ensureVisible('launcher');this.toast('窗口和入口已回到默认位置');}
  async showLayoutMenu(){const content=text('div',undefined,'ast-stack');content.append(actionButton('settings','打开设置',()=>{this.dialogs.current?.finish(null);this.showSettings(true);}),actionButton('reset','恢复全部窗口位置',()=>{this.resetLayout();this.dialogs.current?.finish(null);}),text('p','按住入口左侧握柄，或任一窗口标题栏，可以拖动整个工具箱。','ast-muted'));await this.dialogs.open({title:'工具箱入口',content,accept:'关闭'});}
  cancelHoverClose(){if(this.hoverCloseTimer){clearTimeout(this.hoverCloseTimer);this.hoverCloseTimer=0;}}
  scheduleHoverClose(){if(!this.transientNav)return;this.cancelHoverClose();this.hoverCloseTimer=setTimeout(()=>{if(this.transientNav){this.setNavOpen(false,false);this.transientNav=false;}},500);}

  chooseFile(accept){return this.chooseFiles(accept,false).then(files=>files?.[0]||null);}
  chooseFiles(accept,multiple=false){
    return new Promise(resolve=>{
      const input=document.createElement('input');input.type='file';input.accept=accept;input.multiple=multiple;input.hidden=true;this.shadow.append(input);
      let finished=false;const finish=files=>{if(finished)return;finished=true;input.remove();resolve(files);};
      input.addEventListener('change',()=>finish([...input.files||[]]),{once:true});input.addEventListener('cancel',()=>finish([]),{once:true});this.life.own(()=>finish([]));input.click();
    });
  }

  async exportBackup(){
    try{
      const ids=new Set([...queue.items.flatMap(item=>(item.attachments||[]).map(file=>file.id)),...this.queueView.attachments.map(file=>file.id)]);
      const files=[];let bytes=0;
      for(const record of await attachmentStore.list())if(ids.has(record.id)){
        bytes+=record.size;if(bytes>96*1024*1024)throw Error('附件总量超过 96 MiB，请分开保存附件后再导出工具箱备份');
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(record.blob);});
        const {blob,...metadata}=record;files.push({...metadata,data});
      }
      const backup={schema:'ai-studio-toolbox-backup/v4',version:VERSION,exportedAt:new Date().toISOString(),settings,prompts:this.prompts.store.items,queue:queue.items,ui:this.state,layout:this.windows.saved,labels:{route:conversationRoute(),values:this.navigation.labels.values},files};
      download('AI Studio 工具箱完整备份.json',JSON.stringify(backup,null,2),'application/json;charset=utf-8');this.toast('已导出工具箱完整备份');
    }catch(error){this.toast('备份失败：'+error.message,true);}
  }

  async importBackup(){
    const file=await this.chooseFile('.json,application/json');if(!file)return;
    try{
      if(file.size>128*1024*1024)throw Error('备份文件不能超过 128 MiB');
      const data=JSON.parse(await file.text());
      if(!['ai-studio-toolbox-backup/v3','ai-studio-toolbox-backup/v4'].includes(data?.schema)||!data.settings||!Array.isArray(data.prompts)||!Array.isArray(data.queue))throw Error('备份格式不正确');
      const next=normalizeSettings(data.settings),prompts=this.prompts.store.normalize(data.prompts),incomingFiles=Array.isArray(data.files)?data.files:[];
      for(const entry of incomingFiles)if(!entry||typeof entry.id!=='string'||typeof entry.name!=='string'||typeof entry.data!=='string'||!/^data:[\w/+.-]*;base64,[a-z0-9+/=]*$/i.test(entry.data))throw Error('附件备份格式无效');
      if(!await this.dialogs.confirm('导入完整工具箱备份','将替换显示设置、提示词和队列。当前自动队列会停止；窗口位置也会使用备份值。'))return;
      const oldSettings=settings,oldPrompts=[...this.prompts.store.items],oldQueue=[...queue.items],oldState={...this.state},oldLayout={...this.windows.saved};
      const imported=[];
      try{
        for(const entry of incomingFiles){
          const binary=atob(entry.data.slice(entry.data.indexOf(',')+1));if(binary.length>100*1024*1024)throw Error('备份中的单个附件过大');
          const bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));
          const metadata=await attachmentStore.put(new File([bytes],entry.name,{type:entry.type||'application/octet-stream',lastModified:entry.lastModified||Date.now()}));imported.push({oldId:entry.id,metadata});
        }
        const mapping=new Map(imported.map(item=>[item.oldId,item.metadata]));
        const nextQueue=data.queue.map(item=>({...item,attachments:(item.attachments||[]).map(entry=>mapping.get(entry.id)||entry)}));
        queue.pause();this.prompts.store.replace(prompts);queue.replace(nextQueue);settings=next;
        if(!saveSettings())throw Error('显示设置写入失败');
        if(data.ui&&typeof data.ui==='object'&&!Array.isArray(data.ui)){this.state=normalizeUIState({...data.ui,settingsOpen:true,queueOpen:false});this.state.queueDraftFiles=this.state.queueDraftFiles.map(entry=>mapping.get(entry.id)||entry);}
        if(data.layout&&typeof data.layout==='object'&&!Array.isArray(data.layout)){this.windows.saved=data.layout;writeJSON('ai-studio-toolbox-layout-v4',data.layout);}
        if(data.labels?.route===conversationRoute()&&data.labels.values&&typeof data.labels.values==='object'){writeJSON(this.navigation.labels.storageKey(),data.labels.values);this.navigation.labels.route='';}
        writeJSON(KEY.ui,this.state);this.remount();applySettings();this.toast('完整备份已导入，自动发送保持暂停');
      }catch(error){
        settings=oldSettings;saveSettings();this.prompts.store.replace(oldPrompts);queue.replace(oldQueue);this.state=oldState;writeJSON(KEY.ui,oldState);writeJSON('ai-studio-toolbox-layout-v4',oldLayout);await attachmentStore.remove(imported.map(item=>item.metadata.id)).catch(()=>{});throw error;
      }
    }catch(error){this.toast('导入失败：'+error.message,true);}
  }

  diagnostics(){return {version:VERSION,origin:location.origin,route:conversationRoute(),editor:!!dom.editor(),runButton:!!dom.runButton(),turns:messages().length,math:typeof getBundledKatex==='function',mathLoaded:typeof bundledKatexCache!=='undefined'&&!!bundledKatexCache,queueItems:typeof queue!=='undefined'?queue.items.length:0,queueRunning:typeof queue!=='undefined'?queue.running:false,ocean:ocean.getState(),performance:{...pageIndex.stats}};}

  onStorage(event){
    if(event.key===KEY.settings&&event.newValue){try{const next=normalizeSettings(JSON.parse(event.newValue));clearTimeout(saveTimer);settings=next;applySettings();}catch(_){} }
    if(event.key===KEY.prompts){this.prompts.store.items=this.prompts.store.normalize(readJSON(KEY.prompts,[]));if(this.tab==='prompts'){this.prompts.refreshCategories();this.prompts.render();}}
  }

  remount(){this.host?.remove();this.mount();}

  teardownSurface(){
    this.cancelHoverClose();clearTimeout(this.hoverTimer);clearTimeout(this.toastTimer);if(this.layoutFrame)cancelAnimationFrame(this.layoutFrame);this.layoutFrame=0;
    this.queueView?.destroy();this.settingsEditor?.destroy();this.navigation.destroy();this.prompts.destroy();this.exporter.destroy();this.dialogs?.destroy();this.windows?.destroy();this.life.destroy();this.host?.remove();
    this.host=this.shadow=null;
  }

  destroy(){
    this.destroyed=true;clearTimeout(this.stateTimer);if(this.stateTimer)writeJSON(KEY.ui,this.state);this.stateTimer=0;this.teardownSurface();
    this.navPanel=this.settingsPanel=this.queuePanel=this.launcher=this.tokenBadge=null;
  }
}

const ui=new ToolboxApp();
