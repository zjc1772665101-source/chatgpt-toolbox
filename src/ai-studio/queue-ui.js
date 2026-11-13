class QueueView {
  constructor(app){this.app=app;this.life=new Lifetime();this.attachments=Array.isArray(app.state.queueDraftFiles)?app.state.queueDraftFiles:[];this.signature='';this.draft=app.state.queueDraft||'';}

  build(){
    const entry=this.app.createWindow('queue','发送队列','queue',{width:settings.queuePanelWidth,height:650,minWidth:300,minHeight:310,side:'right',top:160});
    this.panel=entry.panel;this.panel.classList.add('ast-queue');
    const composer=text('div',undefined,'ast-queue-composer');
    this.input=document.createElement('textarea');this.input.rows=3;this.input.placeholder='输入待发送内容，Ctrl + Enter 加入队列';this.input.setAttribute('aria-label','队列草稿');this.input.value=this.draft;
    this.files=text('div',undefined,'ast-file-list');
    const actions=text('div',undefined,'ast-row ast-wrap');
    this.attachButton=actionButton('attach','添加附件',()=>this.chooseAttachments());
    this.addButton=actionButton('plus','加入队列',()=>this.enqueueDraft(),{className:'ast-primary'});
    actions.append(this.attachButton,actionButton('copy','加入当前输入',()=>this.enqueueCurrent()),this.addButton);
    composer.append(this.input,this.files,actions);
    const toolbar=text('div',undefined,'ast-view-toolbar');
    this.startButton=actionButton('play','启动自动发送',()=>queue.toggle());
    this.status=text('span','','ast-queue-state ast-spacer');
    toolbar.append(this.startButton,this.status,actionButton('trash','清空待发送消息',()=>this.clear(),{iconOnly:true}));
    this.progress=text('div',undefined,'ast-queue-progress');
    this.list=text('div',undefined,'ast-queue-list');
    entry.body.replaceWith(composer,toolbar,this.progress,this.list);
    const footer=text('footer','手动启动后逐条发送；草稿、附件、会话或回答状态不确定时会暂停。','ast-window-footer');this.panel.append(footer);
    this.life.listen(this.input,'input',()=>this.saveDraft());
    this.life.listen(this.input,'keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();this.enqueueDraft();}});
    this.life.listen(composer,'dragover',event=>{if(event.dataTransfer?.types?.includes('Files')){event.preventDefault();composer.dataset.fileDrop='';}});
    this.life.listen(composer,'dragleave',()=>delete composer.dataset.fileDrop);
    this.life.listen(composer,'drop',event=>{delete composer.dataset.fileDrop;if(!event.dataTransfer?.files?.length)return;event.preventDefault();this.addFiles([...event.dataTransfer.files]);});
    this.life.listen(this.input,'paste',event=>{const files=[...event.clipboardData?.files||[]];if(files.length){event.preventDefault();this.addFiles(files);}});
    this.renderAttachments();return this.panel;
  }

  saveDraft(){this.draft=this.input.value;this.app.state.queueDraft=this.draft;this.app.state.queueDraftFiles=this.attachments;this.app.persistState();}

  async chooseAttachments(){const files=await this.app.chooseFiles('*/*',true);if(files?.length)await this.addFiles(files);}

  async addFiles(files){
    this.attachButton.disabled=true;
    try{
      for(const file of files){
        if(this.attachments.some(item=>item.name===file.name&&item.size===file.size))continue;
        this.attachments.push(await attachmentStore.put(file));
      }
      this.saveDraft();this.renderAttachments();this.app.toast(`已准备 ${this.attachments.length} 个附件`);
    }catch(error){this.app.toast(error.message,true);}finally{this.attachButton.disabled=false;}
  }

  renderAttachments(){
    if(!this.files)return;this.files.replaceChildren();
    for(const attachment of this.attachments){
      const chip=text('div',undefined,'ast-file-chip');chip.title=attachment.name+' · '+formatBytes(attachment.size);chip.append(icon('attach',13),text('span',attachment.name),text('small',formatBytes(attachment.size)),actionButton('close','移除附件 '+attachment.name,()=>{this.attachments=this.attachments.filter(item=>item.id!==attachment.id);this.saveDraft();this.renderAttachments();attachmentStore.remove([attachment.id]).catch(()=>{});},{iconOnly:true}));this.files.append(chip);
    }
  }

  enqueueDraft(){
    const content=this.input.value;
    if(!content.trim()&&!this.attachments.length){this.app.toast('请先输入内容或选择附件');return;}
    if(queue.add(content,undefined,this.attachments)){
      this.input.value='';this.attachments=[];this.saveDraft();this.renderAttachments();this.render();
    }
  }

  enqueueCurrent(){
    const editor=dom.editor();if(!editor){this.app.toast('未找到原站输入框',true);return;}
    if(nativeAttachments().length){this.app.toast('原站已有附件。为保留附件，请直接在原站发送，或在队列中重新选择原文件。',true);return;}
    const value=editor.value??editor.textContent??'';
    if(queue.add(value))this.render();
  }

  async edit(item){
    const result=await this.app.dialogs.open({title:'编辑队列消息',description:item.attachments?.length?`已有 ${item.attachments.length} 个附件；本次保留这些附件。`:'消息尚未发送。',fields:[{name:'content',label:'消息内容',type:'textarea',value:item.content,rows:9,required:!item.attachments?.length}],accept:'保存修改'});
    if(result===null)return;
    if(queue.update(item.id,result.content,item.attachments))this.app.toast('队列消息已更新');
  }

  async remove(item){
    if(item.status==='sending'&&!await this.app.dialogs.confirm('移除正在发送的队列项','这不会取消原站正在生成的回答。队列将暂停，移除前请确认发送状态。'))return;
    queue.remove(item.id);
  }

  async retry(item){
    if(!await this.app.dialogs.confirm('重新标记待发送','请先检查原站对话，确认这条消息需要再次发送。重新发送可能生成重复消息。'))return;
    queue.retry(item.id,true);
  }

  async fill(item){
    const editor=dom.editor();if(!editor){this.app.toast('未找到输入框',true);return;}
    if((editor.value??editor.textContent??'').trim()&&!await this.app.dialogs.confirm('替换原站草稿','当前输入框已有内容，是否用这条队列消息替换？'))return;
    queue.pause();
    try{
      if(item.attachments?.length)await insertNativeAttachments(item.attachments);
      if(!setEditorValue(item.content))throw Error('写入原站输入框失败');
      queue.remove(item.id);this.app.toast('已填入原站，请手动检查后发送');
    }catch(error){this.app.toast(error.message,true);}
  }

  async clear(){
    if(!queue.items.length)return;
    if(await this.app.dialogs.confirm('清空队列','所有待发送项和对应附件将移除。正在生成的原站回答不会被取消。',true))queue.clear();
  }

  renderCard(item,index){
    const card=text('article',undefined,'ast-card');card.dataset.queueId=item.id;
    const header=text('div',undefined,'ast-row');
    const status=text('span',item.status==='sending'?'正在等待回答':item.status==='uncertain'?'发送状态待确认':'等待发送','ast-queue-state');status.dataset.state=item.status;
    header.append(text('span',String(index+1),'ast-tag'),status,text('span',item.title||'', 'ast-spacer ast-muted'));
    const preview=text('p',item.content?item.content.slice(0,600):'[仅附件消息]','ast-card-preview');
    card.append(header,preview);
    if(item.attachments?.length){const files=text('div',undefined,'ast-file-list');for(const file of item.attachments){const chip=text('span',undefined,'ast-file-chip');chip.append(icon('attach',12),text('span',file.name),text('small',formatBytes(file.size)));files.append(chip);}card.append(files);}
    const actions=text('div',undefined,'ast-card-actions');
    if(item.status==='uncertain')actions.append(actionButton('reset','重新待发',()=>this.retry(item)));
    if(item.status!=='sending')actions.append(actionButton('edit','编辑',()=>this.edit(item)),actionButton('edit','填入',()=>this.fill(item)),actionButton('play','发送此条',()=>queue.sendNow(item.id)));
    actions.append(actionButton('trash','删除',()=>this.remove(item)),text('span',undefined,'ast-spacer'));
    if(index>0&&item.status!=='sending')actions.append(actionButton('up','队列上移',()=>queue.move(item.id,-1),{iconOnly:true}));
    if(index<queue.items.length-1&&item.status!=='sending')actions.append(actionButton('down','队列下移',()=>queue.move(item.id,1),{iconOnly:true}));
    card.append(actions);
    if(item.route!==conversationRoute())card.append(text('p','属于其他会话；在原会话中打开后才能自动发送。','ast-error'));
    return card;
  }

  render(){
    if(!this.panel?.isConnected)return;
    const items=queue.items;
    this.startButton.replaceChildren(icon(queue.running?'pause':'play',16),text('span',queue.running?'暂停自动发送':'启动自动发送'));
    this.startButton.setAttribute('aria-label',queue.running?'暂停自动发送':'启动自动发送');
    this.status.textContent=queue.running?'自动发送中':`${items.length} 条待处理`;
    this.status.dataset.state=queue.running?'sending':'waiting';
    const completed=queue.completed||0,total=items.length+completed;
    this.progress.style.setProperty('--ast-queue-progress',`${total?Math.round(completed/total*100):0}%`);
    const signature=JSON.stringify(items.map(item=>[item.id,item.status,item.content,item.title,item.route,item.attachments]));
    if(signature===this.signature)return;
    this.signature=signature;
    const scroll=this.list.scrollTop;this.list.replaceChildren();
    items.forEach((item,index)=>this.list.append(this.renderCard(item,index)));
    if(!items.length)this.list.append(emptyState('队列为空','加入消息后，点击“启动自动发送”按条发送。','queue'));
    this.list.scrollTop=scroll;
  }

  destroy(){this.life.destroy();}
}
