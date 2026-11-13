function emptyState(message, description = '', name = 'info') {
  const state=text('div',undefined,'ast-empty');
  state.append(icon(name,30),text('strong',message));
  if(description)state.append(text('p',description,'ast-muted'));
  return state;
}

function hashText(value) {
  let hash=2166136261;
  for(let index=0;index<value.length;index++)hash=Math.imul(hash^value.charCodeAt(index),16777619);
  return (hash>>>0).toString(36);
}

function highlightText(value, needle) {
  const fragment=document.createDocumentFragment();
  if(!needle){fragment.append(document.createTextNode(value));return fragment;}
  const lower=value.toLocaleLowerCase(),query=needle.toLocaleLowerCase();
  let start=0,at;
  while((at=lower.indexOf(query,start))>=0){
    fragment.append(document.createTextNode(value.slice(start,at)),text('mark',value.slice(at,at+needle.length)));
    start=at+needle.length;
    if(start>10000)break;
  }
  fragment.append(document.createTextNode(value.slice(start)));
  return fragment;
}

class MessageLabels {
  constructor(){this.route='';this.values={};this.identities=new WeakMap();this.revision=-1;}

  sync() {
    const route=conversationRoute();
    if(route!==this.route){this.route=route;const value=readJSON(this.storageKey(),{});this.values=value&&typeof value==='object'&&!Array.isArray(value)?value:{};this.revision=-1;}
    if(this.revision===pageIndex.revision)return;
    const counts=new Map();let question='home',answer=0;
    for(const message of messages()){
      if(message.role==='user'){
        const hash=hashText(pageIndex.source(message).slice(0,1024));
        const count=(counts.get(hash)||0)+1;counts.set(hash,count);question=`q-${hash}-${count}`;answer=0;
      }
      const native=message.turn.getAttribute('data-turn-id')||message.turn.getAttribute('data-message-id')||message.turn.id;
      const id=native?`native:${native}`:message.role==='user'?question:`${question}:a-${++answer}`;
      this.identities.set(message.turn,id);
    }
    this.revision=pageIndex.revision;
  }

  storageKey(){return 'ai-studio-toolbox-labels-v4:'+conversationRoute();}
  identity(message){this.sync();return this.identities.get(message.turn)||`turn-${message.index}`;}
  get(message){return this.values[this.identity(message)]||{};}
  set(message,patch){const key=this.identity(message);this.values[key]={...this.values[key],...patch};writeJSON(this.storageKey(),this.values);}
  toggleBookmark(message){const current=this.get(message);this.set(message,{bookmarked:!current.bookmarked});return !current.bookmarked;}
}

class NavigationView {
  constructor(app) {
    this.app=app;
    this.life=new Lifetime();
    this.mode='conversation';
    this.root=null;
    this.list=null;
    this.search='';
    this.filter='all';
    this.signature='';
    this.entries=[];
    this.rows=new Map();
    this.activeTurn=null;
    this.manualScrollUntil=0;
    this.searchTimer=0;
    this.labels=new MessageLabels();
  }

  mount(root,mode) {
    this.life.destroy();this.life=new Lifetime();
    this.root=root;this.mode=mode;this.signature='';
    root.replaceChildren();
    const toolbar=text('div',undefined,'ast-view-toolbar');
    const field=document.createElement('input');field.type='search';field.placeholder=mode==='search'?'搜索已加载对话':'筛选目录';field.setAttribute('aria-label',field.placeholder);field.value=this.search;
    const previous=actionButton('up','上一条匹配',()=>this.step(-1),{iconOnly:true});
    const next=actionButton('down','下一条匹配',()=>this.step(1),{iconOnly:true});
    toolbar.append(field,previous,next);
    if(mode==='conversation')toolbar.append(actionButton('star','只显示书签',()=>{this.filter=this.filter==='bookmarked'?'all':'bookmarked';this.signature='';this.refresh();},{iconOnly:true}));
    root.append(toolbar);
    this.summary=text('p','', 'ast-search-summary');root.append(this.summary);
    this.list=text('div',undefined,'ast-nav-list');this.list.setAttribute('role','list');this.list.setAttribute('aria-label',mode==='headings'?'回答章节目录':mode==='search'?'搜索结果':'问答目录');root.append(this.list);
    this.life.listen(field,'input',()=>{this.search=field.value;clearTimeout(this.searchTimer);this.searchTimer=setTimeout(()=>{this.signature='';this.refresh();},120);});
    this.life.listen(this.list,'scroll',()=>{this.manualScrollUntil=Date.now()+1500;},{passive:true});
    this.life.listen(this.list,'keydown',event=>this.onKey(event));
    this.refresh();
  }

  currentAnswer() {
    const visible=viewport.roots();
    if(!visible.length)return messages().filter(message=>message.role==='assistant')[0]||null;
    const line=innerHeight*.28;
    const candidates=visible.map(root=>({root,rect:runtime.pageWork.rect(root)})).sort((a,b)=>a.rect.top-b.rect.top);
    const selected=candidates.filter(item=>item.rect.top<=line).at(-1)||candidates[0];
    return messages().find(message=>message.roots.includes(selected.root))||null;
  }

  headings(answer) {
    if(!answer)return [];
    const roots=answer.roots;
    let headings=roots.flatMap(root=>[...root.querySelectorAll('h1,h2,h3,h4,h5,h6')]).map(node=>({node,label:normalized(node.textContent),level:Number(node.tagName[1]),derived:false})).filter(item=>item.label);
    if(!headings.length&&settings.navDerivedHeadings){
      const blocks=roots.flatMap(root=>[...root.querySelectorAll('p,pre,blockquote,table,ul,ol')]).filter(node=>!node.closest('pre pre,li,table table,blockquote blockquote,[data-ast-owned]'));
      headings=blocks.filter(node=>normalized(node.textContent).length>=20||node.matches('pre,table')).slice(0,60).map((node,index)=>({node,label:node.matches('pre')?`代码块 ${index+1}`:node.matches('table')?`表格 ${index+1}`:normalized(node.textContent).split(/[。！？!?\n]/)[0].slice(0,100),level:2,derived:true}));
    }
    return headings.map((heading,index)=>({...heading,id:`heading-${answer.index}-${index}`,turn:answer.turn,index:answer.index,role:'assistant'}));
  }

  collect() {
    const all=messages();
    const query=this.search.trim().toLocaleLowerCase();
    if(this.mode==='headings')return this.headings(this.currentAnswer()).filter(entry=>!query||entry.label.toLocaleLowerCase().includes(query));
    if(this.mode==='search'){
      if(!query)return [];
      return all.flatMap(message=>{
        const content=pageIndex.source(message),at=content.toLocaleLowerCase().indexOf(query);
        if(at<0)return [];
        return [{id:this.labels.identity(message),node:message.turn,turn:message.turn,index:message.index,role:message.role,label:content.slice(Math.max(0,at-45),Math.min(content.length,at+query.length+150)),preview:message.role==='user'?'用户提问':'Gemini 回答'}];
      });
    }
    const users=all.filter(message=>message.role==='user');
    return users.flatMap((message,index)=>{
      const metadata=this.labels.get(message);
      if(this.filter==='bookmarked'&&!metadata.bookmarked)return [];
      const source=pageIndex.source(message);
      const label=metadata.title||source||'[附件消息]';
      const following=all.find(candidate=>candidate.index>message.index&&candidate.role==='assistant');
      const preview=settings.navPreview&&following?pageIndex.source(following).slice(0,140):'';
      if(query&&!`${label}\n${preview}`.toLocaleLowerCase().includes(query))return [];
      return [{id:this.labels.identity(message),node:message.turn,turn:message.turn,index:message.index,role:message.role,number:index+1,label:label.slice(0,settings.navLabelLength),fullLabel:label,preview,bookmarked:metadata.bookmarked,message}];
    });
  }

  renderEntry(entry) {
    const row=text('div',undefined,'ast-nav-item'+(this.mode==='headings'?' ast-nav-heading':''));row.setAttribute('role','listitem');row.dataset.entry=entry.id;
    if(entry.level)row.dataset.level=String(entry.level);
    row._entry=entry;row._stamp=JSON.stringify([entry.label,entry.preview,entry.bookmarked,this.search]);
    const jump=button('',entry.fullLabel||entry.label,()=>this.jump(row._entry));jump.className='ast-nav-jump';
    if(entry.level)jump.style.paddingLeft=`${8+Math.max(0,entry.level-1)*11}px`;
    const number=text('span',entry.number?String(entry.number):this.mode==='search'?entry.role==='user'?'问':'答':'','ast-nav-number');
    if(this.mode!=='headings')jump.append(number);
    const content=text('span',undefined,'ast-spacer');
    const label=text('span',undefined,'ast-nav-label');label.append(highlightText(entry.label,this.search.trim()));
    if(entry.bookmarked)label.prepend(text('span','★ '));
    content.append(label);
    if(entry.preview)content.append(text('span',entry.preview,'ast-nav-preview'));
    jump.append(content);row.append(jump);
    if(entry.message){
      const actions=text('div',undefined,'ast-nav-item-actions');
      actions.append(actionButton('edit','重命名目录条目',()=>this.rename(row._entry),{iconOnly:true}),actionButton('star',entry.bookmarked?'移除书签':'添加书签',()=>{this.app.toggleBookmark(row._entry.message);},{iconOnly:true}));row.append(actions);
    }
    return row;
  }

  refresh() {
    if(!this.root?.isConnected)return;
    const entries=this.collect();
    const signature=JSON.stringify([this.mode,this.search,this.filter,entries.map(entry=>[entry.id,entry.label,entry.preview,entry.bookmarked])]);
    if(signature!==this.signature){
      const scroll=this.list.scrollTop;
      const focused=this.app.shadow.activeElement?.closest('[data-entry]')?.dataset.entry;
      this.entries=entries;this.signature=signature;
      const wanted=new Set(entries.map(entry=>entry.id));
      for(const [id,row]of this.rows)if(!wanted.has(id)){row.remove();this.rows.delete(id);}
      for(const empty of this.list.querySelectorAll('.ast-empty'))empty.remove();
      for(const [index,entry]of entries.entries()){
        let row=this.rows.get(entry.id);
        if(!row){row=this.renderEntry(entry);this.rows.set(entry.id,row);}
        else{
          row._entry=entry;
          const stamp=JSON.stringify([entry.label,entry.preview,entry.bookmarked,this.search]);
          if(row._stamp!==stamp){
            const label=row.querySelector('.ast-nav-label');label.replaceChildren(highlightText(entry.label,this.search.trim()));if(entry.bookmarked)label.prepend(text('span','★ '));
            let preview=row.querySelector('.ast-nav-preview');if(entry.preview){if(!preview){preview=text('span','','ast-nav-preview');label.after(preview);}preview.textContent=entry.preview;}else preview?.remove();
            row.querySelector('.ast-nav-jump').title=entry.fullLabel||entry.label;row.querySelector('.ast-nav-jump').setAttribute('aria-label',entry.fullLabel||entry.label);row._stamp=stamp;
          }
        }
        if(this.list.children[index]!==row)this.list.insertBefore(row,this.list.children[index]||null);
      }
      if(!entries.length)this.list.append(emptyState(this.mode==='search'&&!this.search?'搜索对话内容':this.filter==='bookmarked'?'还没有书签':'没有匹配的条目',this.mode==='headings'?'当前回答没有可提取的章节。':'已加载的消息会自动出现在这里。',this.mode==='search'?'search':'list'));
      this.list.scrollTop=scroll;
      if(focused){const row=[...this.list.children].find(node=>node.dataset.entry===focused);row?.querySelector('button')?.focus({preventScroll:true});}
      this.summary.textContent=this.mode==='headings'?`${entries.length} 个章节 · 当前可见回答`:this.mode==='search'?`${entries.length} 条匹配消息`:`${entries.length} 条提问${this.filter==='bookmarked'?' · 仅书签':''}`;
    }
    this.updateActive();
  }

  updateActive() {
    if(!this.list||!this.entries.length)return;
    const line=innerHeight*.32;
    // At most one geometry read per nearby indexed turn, not every loaded turn.
    const visibleRoots=viewport.roots();
    const answer=visibleRoots.map(root=>({root,rect:runtime.pageWork.rect(root)})).filter(item=>item.rect.bottom>0).sort((a,b)=>Math.abs(a.rect.top-line)-Math.abs(b.rect.top-line))[0];
    const turn=answer?.root.closest('ms-chat-turn');
    const message=turn?messages().find(item=>item.turn===turn):null;
    const active=message?this.entries.filter(entry=>entry.index<=message.index).at(-1):this.entries[0];
    if(active?.id===this.activeTurn)return;
    this.activeTurn=active?.id||null;
    for(const row of this.list.querySelectorAll('[data-entry]'))row.toggleAttribute('data-active',row.dataset.entry===this.activeTurn);
    if(settings.navFollow&&Date.now()>this.manualScrollUntil){
      const row=[...this.list.children].find(node=>node.dataset.entry===this.activeTurn);
      if(row){const top=row.offsetTop-this.list.offsetTop;if(top<this.list.scrollTop)this.list.scrollTop=top;else if(top+row.offsetHeight>this.list.scrollTop+this.list.clientHeight)this.list.scrollTop=top+row.offsetHeight-this.list.clientHeight;}
    }
  }

  jump(entry) {
    if(!entry.node?.isConnected){this.app.toast('目标消息已被页面卸载，请在原站重新加载历史');return;}
    scrollLock.intent(2200);
    entry.node.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
    this.activeTurn=null;
    if(settings.navAutoCollapse)this.app.setNavOpen(false);
  }

  step(delta) {
    if(!this.entries.length)return;
    const index=this.entries.findIndex(entry=>entry.id===this.activeTurn);
    const next=clamp((index<0?0:index)+delta,0,this.entries.length-1);
    this.jump(this.entries[next]);this.activeTurn=this.entries[next].id;
  }

  onKey(event) {
    const row=event.target.closest('[data-entry]');
    if(!row)return;
    const index=this.entries.findIndex(entry=>entry.id===row.dataset.entry);
    let next=index;
    if(event.key==='ArrowDown')next=Math.min(this.entries.length-1,index+1);
    else if(event.key==='ArrowUp')next=Math.max(0,index-1);
    else if(event.key==='Home')next=0;
    else if(event.key==='End')next=this.entries.length-1;
    else return;
    event.preventDefault();
    this.list.querySelectorAll('.ast-nav-jump')[next]?.focus();
  }

  async rename(entry) {
    const result=await this.app.dialogs.open({title:'重命名目录条目',description:'只修改工具箱中的显示名称，不会更改原站消息。留空恢复原提问。',fields:[{name:'title',label:'目录名称',value:this.labels.get(entry.message).title||''}],accept:'保存'});
    if(result===null)return;
    this.labels.set(entry.message,{title:result.title.trim()});this.signature='';this.refresh();
  }

  destroy(){clearTimeout(this.searchTimer);this.life.destroy();this.root=this.list=null;this.rows.clear();this.signature='';this.activeTurn=null;}
}

class PromptLibraryStore {
  constructor(){this.items=this.normalize(readJSON(KEY.prompts,[]));}
  normalize(value){
    if(!Array.isArray(value))return [];
    const ids=new Set();
    return value.filter(item=>item&&typeof item.content==='string').slice(0,10000).map((item,index)=>{
      let id=String(item.id||uid());if(ids.has(id))id=uid();ids.add(id);
      return {id,title:String(item.title||'未命名').slice(0,200),category:String(item.category||'未分类').slice(0,100),content:item.content.slice(0,500000),pinned:!!item.pinned,order:finite(item.order,index),usage:Math.max(0,finite(item.usage,0)),updatedAt:finite(item.updatedAt,Date.now()),createdAt:finite(item.createdAt,Date.now())};
    });
  }
  persist(){if(!writeJSON(KEY.prompts,this.items))throw Error('提示词保存失败，请先导出备份并检查浏览器存储空间');}
  sorted(){return [...this.items].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||a.order-b.order||b.updatedAt-a.updatedAt);}
  save(draft){const index=this.items.findIndex(item=>item.id===draft.id);const previous=this.items[index];const item={id:draft.id||uid(),title:draft.title.trim()||'未命名',category:draft.category.trim()||'未分类',content:draft.content,pinned:!!draft.pinned,order:previous?.order??this.items.length,usage:previous?.usage||0,createdAt:previous?.createdAt||Date.now(),updatedAt:Date.now()};if(index>=0)this.items[index]=item;else this.items.push(item);this.persist();return item;}
  remove(id){this.items=this.items.filter(item=>item.id!==id);this.persist();}
  togglePin(id){const item=this.items.find(item=>item.id===id);if(item){item.pinned=!item.pinned;this.persist();}}
  move(id,targetId,after=false){const ordered=[...this.items].sort((a,b)=>a.order-b.order),from=ordered.findIndex(item=>item.id===id);if(from<0||id===targetId)return;const [item]=ordered.splice(from,1);const at=ordered.findIndex(entry=>entry.id===targetId);if(at<0)return;ordered.splice(at+(after?1:0),0,item);ordered.forEach((entry,index)=>entry.order=index);this.persist();}
  replace(value){this.items=this.normalize(value);this.persist();}
  merge(value){const imported=this.normalize(value);const signatures=new Set(this.items.map(item=>item.title+'\u0000'+item.content));let count=0;for(const item of imported){const signature=item.title+'\u0000'+item.content;if(signatures.has(signature))continue;item.id=uid();item.order=this.items.length;this.items.push(item);signatures.add(signature);count++;}this.persist();return count;}
}

class PromptLibraryView {
  constructor(app){this.app=app;this.store=new PromptLibraryStore();this.root=null;this.search='';this.category='';this.draft=null;this.dragged=null;this.signature='';}

  mount(root){
    this.root=root;root.replaceChildren();
    const toolbar=text('div',undefined,'ast-prompt-toolbar');
    const search=document.createElement('input');search.type='search';search.placeholder='搜索提示词';search.setAttribute('aria-label','搜索提示词');search.value=this.search;
    this.categoryInput=document.createElement('select');this.categoryInput.setAttribute('aria-label','提示词分类');
    toolbar.append(search,this.categoryInput,actionButton('plus','新建',()=>this.edit()));
    const actions=text('div',undefined,'ast-view-toolbar');actions.append(actionButton('import','导入',()=>this.import()),actionButton('export','导出',()=>this.export()));
    root.append(toolbar,actions);this.list=text('div',undefined,'ast-prompt-list');root.append(this.list);
    search.addEventListener('input',()=>{this.search=search.value;this.render();});
    this.categoryInput.addEventListener('change',()=>{this.category=this.categoryInput.value;this.render();});
    this.refreshCategories();this.render();
  }

  refreshCategories(){if(!this.categoryInput)return;const categories=[...new Set(this.store.items.map(item=>item.category))].sort((a,b)=>a.localeCompare(b,'zh-CN'));this.categoryInput.replaceChildren();for(const value of ['',...categories]){const option=document.createElement('option');option.value=value;option.textContent=value||'全部分类';this.categoryInput.append(option);}this.categoryInput.value=this.category;}

  render(){
    if(!this.list?.isConnected)return;
    const query=this.search.trim().toLocaleLowerCase();
    const items=this.store.sorted().filter(item=>(!this.category||item.category===this.category)&&(!query||`${item.title} ${item.category} ${item.content}`.toLocaleLowerCase().includes(query)));
    this.list.replaceChildren();
    for(const item of items)this.list.append(this.card(item));
    if(!items.length)this.list.append(emptyState('还没有匹配的提示词','新建提示词后，可以填入、排队、置顶或拖动排序。','book'));
  }

  card(item){
    const card=text('article',undefined,'ast-card');card.dataset.promptId=item.id;card.draggable=true;
    const header=text('div',undefined,'ast-row');header.append(icon(item.pinned?'pin':'book',15),text('strong',item.title,'ast-card-title'),text('span',item.category,'ast-tag'));
    const preview=text('p',item.content.slice(0,220),'ast-card-preview');
    const actions=text('div',undefined,'ast-card-actions');
    actions.append(actionButton('edit','填入',()=>this.use(item)),actionButton('queue','排队',()=>this.enqueue(item)),actionButton('copy','复制',async()=>this.app.toast(await copyText(item.content)?'已复制提示词':'复制失败')),actionButton('pin',item.pinned?'取消置顶':'置顶',()=>{this.store.togglePin(item.id);this.render();}),actionButton('edit','编辑',()=>this.edit(item)),actionButton('trash','删除',()=>this.remove(item)));
    const order=text('div',undefined,'ast-row');order.append(text('small',item.usage?`已使用 ${item.usage} 次`:'拖动卡片调整顺序','ast-muted'),text('span',undefined,'ast-spacer'),actionButton('up','上移提示词',()=>this.moveBy(item,-1),{iconOnly:true}),actionButton('down','下移提示词',()=>this.moveBy(item,1),{iconOnly:true}));
    card.append(header,preview,actions,order);
    card.addEventListener('dragstart',event=>{if(event.target.closest('button,input,textarea')){event.preventDefault();return;}this.dragged=item.id;card.dataset.dragging='';event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',item.id);});
    card.addEventListener('dragover',event=>{if(!this.dragged||this.dragged===item.id)return;event.preventDefault();const rect=card.getBoundingClientRect();card.dataset.drop=event.clientY>rect.top+rect.height/2?'after':'before';});
    card.addEventListener('dragleave',()=>delete card.dataset.drop);
    card.addEventListener('drop',event=>{if(!this.dragged)return;event.preventDefault();this.store.move(this.dragged,item.id,card.dataset.drop==='after');this.dragged=null;this.render();});
    card.addEventListener('dragend',()=>{this.dragged=null;for(const node of this.list.querySelectorAll('[data-drop],[data-dragging]')){delete node.dataset.drop;delete node.dataset.dragging;}});
    return card;
  }

  moveBy(item,delta){const ordered=this.store.sorted(),index=ordered.findIndex(entry=>entry.id===item.id),target=ordered[index+delta];if(target){this.store.move(item.id,target.id,delta>0);this.render();}}

  async resolve(content){
    const automatic={date:new Date().toLocaleDateString('zh-CN'),time:new Date().toLocaleTimeString('zh-CN'),datetime:new Date().toLocaleString('zh-CN')};
    let result=content.replace(/\{\{\s*(date|time|datetime)\s*\}\}/g,(_,name)=>automatic[name]);
    const names=[...new Set([...result.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match=>match[1]))];
    if(!names.length)return result;
    const variables=await this.app.dialogs.open({title:'填写提示词变量',description:'变量只在本次使用时替换，原提示词保持不变。',fields:names.map((name,index)=>({name:String(index),label:name,required:true})),accept:'使用提示词'});
    if(!variables)return null;
    const values=new Map(names.map((name,index)=>[name,variables[String(index)]]));
    return result.replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(_,name)=>values.get(name)??'');
  }

  async use(item){
    const value=await this.resolve(item.content);if(value===null)return;
    const editor=dom.editor();if(!editor){this.app.toast('未找到 AI Studio 输入框',true);return;}
    const existing=editor.value??editor.textContent??'';
    let mode='replace';
    if(existing.trim()){
      const choice=await this.app.dialogs.open({title:'输入框已有草稿',description:'选择“追加”保留原内容，或取消返回。',accept:'追加提示词'});
      if(!choice)return;mode='append';
    }
    if(setEditorValue(mode==='append'?existing+'\n\n'+value:value)){item.usage++;this.store.persist();this.app.toast('已填入原站输入框');}
  }

  async enqueue(item){const value=await this.resolve(item.content);if(value===null)return;if(queue.add(value,{title:item.title})){item.usage++;this.store.persist();this.app.showQueue(true);}}

  async edit(item=null){
    const draft=item?{...item}:{title:'',category:this.category||'',content:''};
    const result=await this.app.dialogs.open({title:item?'编辑提示词':'新建提示词',fields:[{name:'title',label:'名称',value:draft.title},{name:'category',label:'分类',value:draft.category},{name:'content',label:'提示词内容',type:'textarea',value:draft.content,rows:10,required:true}],description:'使用 {{变量名}} 创建填写项；{{date}}、{{time}}、{{datetime}} 自动替换。',accept:'保存提示词'});
    if(!result)return;
    try{this.store.save({...draft,...result});this.refreshCategories();this.render();this.app.toast('提示词已保存');}catch(error){this.app.toast(error.message,true);}
  }

  async remove(item){if(await this.app.dialogs.confirm('删除提示词',`删除「${item.title}」？`,true)){try{this.store.remove(item.id);this.refreshCategories();this.render();}catch(error){this.app.toast(error.message,true);}}}

  export(){download('AI Studio 提示词库.json',JSON.stringify({schema:'ai-studio-prompts/v4',exportedAt:new Date().toISOString(),prompts:this.store.items},null,2),'application/json;charset=utf-8');}

  async import(){
    const file=await this.app.chooseFile('.json,application/json');if(!file)return;
    try{
      if(file.size>10*1024*1024)throw Error('提示词文件不能超过 10 MiB');
      const value=JSON.parse(await file.text());const items=Array.isArray(value)?value:value.prompts;
      if(!Array.isArray(items))throw Error('没有找到有效的提示词数组');
      const count=this.store.merge(items);this.refreshCategories();this.render();this.app.toast(`已合并 ${count} 条提示词，重复内容已跳过`);
    }catch(error){this.app.toast('导入失败：'+error.message,true);}
  }

  destroy(){this.root=this.list=null;}
}
