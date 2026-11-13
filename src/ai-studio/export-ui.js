function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));}

function safeMessageHTML(message){
  const container=document.createElement('div');
  for(const root of message.roots)container.append(root.cloneNode(true));
  for(const node of container.querySelectorAll('script,style,button,input,textarea,select,form,iframe,object,embed,foreignObject,ms-thought-chunk,[data-ast-owned],.ast-copy-button,.ast-message-tools,.ast-code-toolbar'))node.remove();
  for(const element of container.querySelectorAll('*')){
    for(const attribute of [...element.attributes]){
      const name=attribute.name.toLowerCase();
      if(name.startsWith('on')||name==='srcdoc'||name==='id'||name==='contenteditable'||name.startsWith('data-ast')||name.startsWith('data-cgfc'))element.removeAttribute(attribute.name);
      if(['href','src','xlink:href'].includes(name)){const destination=safeExportDestination(attribute.value,name==='src');if(destination)element.setAttribute(attribute.name,destination);else element.removeAttribute(attribute.name);}
      if(name==='style'&&/url\s*\(|expression\s*\(/i.test(attribute.value))element.removeAttribute(attribute.name);
    }
    if(element.tagName==='A'){element.setAttribute('target','_blank');element.setAttribute('rel','noopener noreferrer');}
  }
  return container.innerHTML;
}

class ConversationExportView {
  constructor(app){this.app=app;this.root=null;this.selected=new Set();this.selectEnabled=false;this.role='all';this.history=[];this.loading=false;this.cancelled=false;}

  mount(root){
    this.root=root;root.replaceChildren();
    const body=text('div',undefined,'ast-export-body');
    body.append(text('h3','导出当前会话'),text('p','保留 Markdown 结构、代码空行、公式源码和表格。附件以名称或链接记录，不导出隐藏思考或附件二进制。','ast-muted'));
    const selector=text('div',undefined,'ast-row');
    const roles=document.createElement('select');roles.setAttribute('aria-label','导出消息角色');
    for(const [value,label] of [['all','用户与 Gemini'],['user','仅用户提问'],['assistant','仅 Gemini 回答']]){const option=document.createElement('option');option.value=value;option.textContent=label;roles.append(option);}roles.value=this.role;
    roles.addEventListener('change',()=>{this.role=roles.value;this.renderSelection();});
    const choose=actionButton('check','选择消息',()=>{this.selectEnabled=!this.selectEnabled;choose.setAttribute('aria-pressed',String(this.selectEnabled));this.renderSelection();});
    selector.append(roles,choose);body.append(selector);
    this.selection=text('div',undefined,'ast-export-selection');body.append(this.selection);
    const formats=text('div',undefined,'ast-export-format');
    for(const [format,title,description] of [['markdown','Markdown','适合笔记与代码'],['json','JSON','结构化消息数据'],['text','纯文本','通用阅读与归档'],['html','HTML','独立可阅读网页']]){
      const control=button('',`下载 ${title}`,()=>this.export(format));control.append(text('strong',title),text('p',description,'ast-muted'));formats.append(control);
    }
    body.append(formats,actionButton('copy','复制 Markdown',()=>this.copy()));
    this.loadButton=actionButton('import','向上加载并收集历史消息',()=>this.loadHistory());
    this.cancelButton=actionButton('close','停止收集',()=>{this.cancelled=true;});this.cancelButton.hidden=true;
    this.status=text('p','','ast-health');
    body.append(this.loadButton,this.cancelButton,this.status,text('p','导出通常基于原站已加载内容。需要更早的消息时，可先运行历史收集；收集过程使用原站滚动加载机制，不访问未公开会话接口。','ast-muted'));
    root.append(body);this.renderSelection();this.updateStatus();
  }

  collect(includeHTML=false){
    const snapshot=messages().map(message=>({id:this.app.navigation.labels.identity(message),index:message.index,role:message.role,markdown:messageMarkdown(message),text:pageIndex.source(message),...(includeHTML?{html:safeMessageHTML(message)}:{})}));
    if(!this.history.length)return snapshot;
    const merged=new Map(this.history.map(item=>[item.id,item]));for(const item of snapshot)merged.set(item.id,{...merged.get(item.id),...item});
    return [...merged.values()];
  }

  filtered(includeHTML=false){return this.collect(includeHTML).filter(message=>(this.role==='all'||message.role===this.role)&&(!this.selectEnabled||this.selected.has(message.id)));}

  renderSelection(){
    if(!this.selection)return;this.selection.hidden=!this.selectEnabled;this.selection.replaceChildren();if(!this.selectEnabled)return;
    const records=this.collect().filter(message=>this.role==='all'||message.role===this.role);
    const actions=text('div',undefined,'ast-row');actions.append(actionButton('check','全选',()=>{for(const message of records)this.selected.add(message.id);this.renderSelection();}),actionButton('close','清除选择',()=>{this.selected.clear();this.renderSelection();}));this.selection.append(actions);
    for(const [index,message] of records.entries()){
      const label=text('label');const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=this.selected.has(message.id);checkbox.addEventListener('change',()=>{if(checkbox.checked)this.selected.add(message.id);else this.selected.delete(message.id);this.updateStatus();});
      label.append(checkbox,text('span',`${index+1}. ${message.role==='user'?'用户':'Gemini'} · ${message.text.slice(0,100)||'[附件消息]'}`));this.selection.append(label);
    }
  }

  serialize(format,records){
    const title=conversationTitle();
    const exportedAt=new Date().toISOString();
    if(format==='json')return {extension:'json',mime:'application/json;charset=utf-8',content:JSON.stringify({schema:'ai-studio-conversation/v4',title,exportedAt,source:location.origin+location.pathname,historyCollected:this.history.length>0,messages:records.map(({id,role,markdown,text})=>({id,role,markdown,text}))},null,2)};
    if(format==='text')return {extension:'txt',mime:'text/plain;charset=utf-8',content:title+'\n\n'+records.map(message=>`【${message.role==='user'?'用户':'Gemini'}】\n\n${message.text}`).join('\n\n'+ '='.repeat(40)+'\n\n')};
    if(format==='html'){
      let mathCss=typeof KATEX_CSS==='string'?KATEX_CSS:'';
      mathCss=mathCss.replace(/url\((?:'|")?fonts\//g,'url(https://cdn.jsdelivr.net/npm/katex@0.16.44/dist/fonts/');
      const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https:; font-src https: data:; base-uri 'none'; form-action 'none'"><title>${escapeHTML(title)}</title><style>body{max-width:960px;margin:40px auto;padding:0 24px;font:17px/1.8 system-ui,\"Microsoft YaHei\",sans-serif;color:#243147;background:#f8faff}header{margin-bottom:32px}h1{font-size:28px}article{border:1px solid #bcc8d5;border-radius:16px;padding:22px;margin:20px 0;background:white;overflow-wrap:anywhere}article[data-role=user]{background:#eef3fb}h2.role{font-size:13px;color:#60728b;margin-top:0}pre{background:#122035;color:#edf2fa;padding:18px;border-radius:10px;overflow:auto;white-space:pre-wrap}code{font:14px/1.7 Consolas,monospace}table{border-collapse:collapse;max-width:100%}th,td{border:1px solid #bdcbdc;padding:8px 12px}img{max-width:100%}blockquote{border-left:3px solid #9ab7df;padding-left:16px;color:#52647c}small{color:#60728b}${mathCss}</style><header><h1>${escapeHTML(title)}</h1><small>${escapeHTML(exportedAt)} · ${records.length} 条消息</small></header>${records.map(message=>`<article data-role="${message.role}"><h2 class="role">${message.role==='user'?'用户':'Gemini'}</h2>${message.html}</article>`).join('\n')}</html>`;
      return {extension:'html',mime:'text/html;charset=utf-8',content:html};
    }
    return {extension:'md',mime:'text/markdown;charset=utf-8',content:`# ${title}\n\n`+records.map(message=>`## ${message.role==='user'?'用户':'Gemini'}\n\n${message.markdown}`).join('\n\n---\n\n')};
  }

  async export(format){
    if(dom.isBusy()&&!await this.app.dialogs.confirm('回答仍在生成','现在导出只包含已经显示的内容，继续？'))return;
    const records=this.filtered(format==='html');if(!records.length){this.app.toast('没有选中可导出的消息');return;}
    const result=this.serialize(format,records);download(`${conversationTitle()}.${result.extension}`,result.content,result.mime);this.app.toast(`已导出 ${records.length} 条消息`);
  }

  async copy(){const records=this.filtered();if(!records.length){this.app.toast('没有可复制的消息');return;}this.app.toast(await copyText(this.serialize('markdown',records).content)?`已复制 ${records.length} 条消息`:'复制失败');}

  updateStatus(){if(this.status)this.status.textContent=this.loading?`正在收集历史，已保存 ${this.history.length} 条消息…`:`已加载 ${messages().length} 条消息${this.history.length?` · 历史收集 ${this.history.length} 条`:''}${this.selectEnabled?` · 已选 ${this.selected.size} 条`:''}`;}

  async loadHistory(){
    if(this.loading)return;
    if(dom.isBusy()){this.app.toast('请等待当前回答生成结束再收集历史');return;}
    if(!await this.app.dialogs.confirm('收集历史消息','页面会临时向上滚动以触发原站加载，完成后恢复阅读位置。发送队列将暂停。'))return;
    queue.pause();this.loading=true;this.cancelled=false;this.loadButton.disabled=true;this.cancelButton.hidden=false;
    const scroller=findConversationScroller(),top=scroller.scrollTop,left=scroller.scrollLeft,route=conversationRoute();
    const archive=new Map(this.collect().map(message=>[message.id,message]));let stable=0,previous='';
    try{
      for(let round=0;round<60&&!this.cancelled;round++){
        if(conversationRoute()!==route)throw Error('会话已切换，历史收集停止');
        scrollLock.intent(1800);scroller.scrollTop=0;
        await new Promise(resolve=>setTimeout(resolve,650));
        pageIndex.invalidate(null,true);
        const current=messages();
        const fresh=current.map(message=>({id:this.app.navigation.labels.identity(message),index:message.index,role:message.role,markdown:messageMarkdown(message),text:pageIndex.source(message),html:safeMessageHTML(message)}));
        // Newly revealed older records precede the already collected branch.
        const ordered=new Map();for(const item of fresh)ordered.set(item.id,item);for(const [id,item]of archive)if(!ordered.has(id))ordered.set(id,item);
        archive.clear();for(const [id,item]of ordered)archive.set(id,item);
        this.history=[...archive.values()];this.updateStatus();
        const signature=`${current.length}:${fresh[0]?.id}:${scroller.scrollHeight}`;
        stable=signature===previous?stable+1:0;previous=signature;
        if(stable>=3)break;
      }
      this.app.toast(this.cancelled?'已停止收集，已收集内容仍可导出':`已收集 ${this.history.length} 条当前可访问消息`);
    }catch(error){this.app.toast(error.message,true);}finally{
      this.loading=false;this.loadButton.disabled=false;this.cancelButton.hidden=true;
      if(conversationRoute()===route){scrollLock.intent(1500);scroller.scrollLeft=left;scroller.scrollTop=top;}
      this.renderSelection();this.updateStatus();
    }
  }

  routeChanged(){this.cancelled=true;this.history=[];this.selected.clear();this.updateStatus();}
  destroy(){this.cancelled=true;this.root=null;}
}
