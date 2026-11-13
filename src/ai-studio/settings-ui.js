class SettingsEditor {
  constructor(app) {
    this.app=app;
    this.controls=new Map();
    this.groups=new Map();
    this.category=app.state.settingsCategory||'fonts';
    this.query='';
    this.life=new Lifetime();
    this.fontLists=[];
    this.status=null;
    this.lastWidths={};
  }

  build() {
    const entry=this.app.createWindow('settings','工具箱设置','settings',{width:settings.settingsWidth,height:760,minWidth:340,minHeight:300,side:'center',top:64});
    this.panel=entry.panel;
    this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-modal','false');
    const search=text('div',undefined,'ast-settings-search');
    this.searchInput=document.createElement('input');this.searchInput.type='search';this.searchInput.placeholder='搜索全部设置，例如：拖动、字号、折射';this.searchInput.setAttribute('aria-label','搜索全部工具箱设置');
    search.append(icon('search'),this.searchInput,actionButton('reset','恢复窗口位置',()=>this.app.resetLayout(),{iconOnly:true}));
    entry.body.replaceWith(search);
    const shell=text('div',undefined,'ast-settings-shell ast-window-body');
    this.sidebar=text('nav',undefined,'ast-settings-sidebar');this.sidebar.setAttribute('aria-label','设置分类');
    this.main=text('div',undefined,'ast-settings-main');
    shell.append(this.sidebar,this.main);search.after(shell);
    this.addCategory('all','全部设置','settings');
    this.addCategory('layout','位置与快捷键','grip');
    this.addCategory('presets','外观预设','bolt');
    let previousSection='';
    for(const group of SETTING_GROUPS){
      if(group.section&&group.section!==previousSection){this.sidebar.append(text('div',group.section,'ast-settings-section-label'));previousSection=group.section;}
      this.addCategory(group.id,group.title,group.icon);
      this.main.append(this.buildGroup(group));
    }
    this.addCategory('backup','备份与迁移','export');
    this.addCategory('diagnostics','状态与兼容','info');
    this.main.prepend(this.layoutGroup(),this.presetsGroup());
    this.main.append(this.backupGroup(),this.diagnosticsGroup());
    const footer=text('footer',undefined,'ast-settings-footer');
    this.status=text('span',`${Object.keys(SCHEMA).length} 项设置 · 自动保存`,'ast-muted');
    footer.append(this.status,actionButton('reset','当前分类恢复默认',()=>this.resetCurrent()),actionButton('check','完成',()=>this.app.showSettings(false),{className:'ast-primary'}));
    this.panel.append(footer);
    this.life.listen(this.searchInput,'input',()=>{this.query=this.searchInput.value.trim();this.filter();});
    this.life.own(fontCatalog.subscribe(()=>this.updateFonts()));
    this.filter();this.sync();
    return this.panel;
  }

  addCategory(id,title,name) {
    const control=actionButton(name,title,()=>{
      this.category=id;this.query='';this.searchInput.value='';this.app.state.settingsCategory=id;this.app.persistState();this.filter();this.main.scrollTop=0;
    });
    control.className='ast-settings-category';control.dataset.category=id;this.sidebar.append(control);
  }

  createGroup(id,title,description='') {
    const details=document.createElement('details');details.className='ast-settings-group';details.dataset.group=id;
    const stored=this.app.state.groups?.[id];details.open=typeof stored==='boolean'?stored:true;
    const summary=text('summary');summary.append(icon('chevron',14),text('span',title));
    const count=text('span','','ast-muted');summary.append(count);details.append(summary);
    const body=text('div',undefined,'ast-settings-group-body');
    if(description)body.append(text('p',description,'ast-muted'));
    details.append(body);
    this.life.listen(details,'toggle',()=>{
      if(this.query)return;
      (this.app.state.groups??={})[id]=details.open;this.app.persistState();
    });
    this.groups.set(id,{details,body,title,count,keys:[]});
    return this.groups.get(id);
  }

  buildGroup(spec) {
    const group=this.createGroup(spec.id,spec.title,spec.description||'');group.keys=spec.keys;
    group.count.textContent=`${spec.keys.length} 项`;
    if(spec.id==='fonts')group.body.append(this.fontDetection());
    if(spec.id==='appearance')group.body.append(actionButton('import','选择本地背景图片',()=>this.chooseBackground()));
    for(const key of spec.keys)group.body.append(this.buildControl(key,spec));
    if(spec.surface&&spec.surface!=='composer')group.body.append(actionButton('copy','复制输入框玻璃参数',()=>{
      const patch={};for(const suffix of ['Mode','Style','Finish','Blur','Opacity','Strength','Thickness','Glare','Chroma','Curvature','Bend','Radius','Saturation','Brightness','TintMode','Tint'])patch[spec.surface+suffix]=settings['composer'+suffix];updateSettings(patch);this.app.toast('已复制输入框的光学参数');
    }));
    if(spec.id==='ocean'){
      this.oceanStatus=text('p','正在读取动画状态','ast-health');group.body.append(this.oceanStatus,actionButton('trash','清除海洋回放缓存',()=>{ocean.clearReplay();this.app.toast('已请求清除回放缓存');}));
      group.body.append(text('p','运动回放在后台预演并缓存轨迹，准备完成前继续实时模拟。绘制方式与运动模式可以组合。','ast-muted'));
    }
    if(spec.id==='ocean-colors')group.body.append(actionButton('reset','换一组随机颜色',()=>updateSettings({oceanColorMode:'random',oceanColorSeed:Math.floor(Math.random()*2147483645)+1})));
    if(spec.id==='formula')group.body.append(text('p','KaTeX 字体只覆盖普通字母时不会改变根号、运算符或伸缩符号。公式修复只扫描可见回答，跳过代码和你的提问。','ast-muted'));
    return group.details;
  }

  buildControl(key,group) {
    const spec=SCHEMA[key];
    if(!spec)throw Error('Unknown setting: '+key);
    const wrapper=text('div',undefined,'ast-setting');wrapper.dataset.key=key;
    const head=text('div',undefined,'ast-setting-head');
    const id='ast-setting-'+key;
    const caption=text('label',spec.label,'ast-setting-caption');caption.htmlFor=id;head.append(caption);
    let override=null;
    if(spec.override){
      override=button('','切换 '+spec.label+' 覆盖',()=>updateSettings({[key+'Enabled']:!settings[key+'Enabled']}));override.className='ast-setting-override';override.dataset.override=key;head.append(override);
    }
    const reset=actionButton('reset','恢复 '+spec.label+' 默认值',()=>{const patch={[key]:spec.default};if(spec.override)patch[key+'Enabled']=spec.overrideDefault!==false;updateSettings(patch);},{iconOnly:true});reset.classList.add('ast-setting-reset');head.append(reset);wrapper.append(head);
    const values=text('div',undefined,'ast-setting-values');
    let input,range=null,preview=null,colorText=null;
    if(spec.type==='select'){
      input=document.createElement('select');
      for(const value of spec.choices){const option=document.createElement('option');option.value=value;option.textContent=SELECT_LABELS[value]||value;input.append(option);}
    }else{
      input=document.createElement('input');input.type=spec.type==='boolean'?'checkbox':spec.type==='url'?'text':spec.type;
      if(spec.type==='number'){
        input.min=spec.min;input.max=spec.max;input.step=spec.step;input.inputMode='decimal';
        range=document.createElement('input');range.type='range';range.min=spec.min;range.max=spec.max;range.step=spec.step;range.setAttribute('aria-label',`${spec.label}滑块`);range.dataset.range=key;
      }
      if(FONT_KEYS.has(key)){
        const datalist=document.createElement('datalist');datalist.id='ast-fonts-'+key;input.setAttribute('list',datalist.id);this.fontLists.push(datalist);wrapper.append(datalist);
        preview=text('div','Aa 0123456789 汉字阅读预览','ast-font-preview');
      }
    }
    input.id=id;input.dataset.setting=key;input.setAttribute('aria-label',group.surface?`${group.title} · ${spec.label}`:spec.label);
    if(spec.type==='boolean'){values.append(input,text('span','启用','ast-muted'));}else if(range)values.append(range,input);else if(spec.type==='color'){
      colorText=document.createElement('input');colorText.type='text';colorText.maxLength=7;colorText.spellcheck=false;colorText.setAttribute('aria-label',`${spec.label}十六进制`);input.style.width='48px';input.style.flex='none';values.append(input,colorText);
    }else values.append(input);
    wrapper.append(values);if(preview)wrapper.append(preview);
    if(spec.override)wrapper.append(text('p','关闭覆盖后跟随网页，所选值会保留。','ast-setting-help'));
    const commit=control=>{
      if(spec.type==='number'&&(control.value===''||!Number.isFinite(Number(control.value))))return;
      const value=spec.type==='boolean'?input.checked:spec.type==='number'?Number(control.value):input.value;
      const patch={[key]:value};if(spec.override)patch[key+'Enabled']=true;
      if(['oceanBodyColor','oceanAccentColor','oceanFishColor','oceanWakeColor'].includes(key))patch.oceanColorMode='custom';
      updateSettings(patch);
    };
    this.life.listen(input,spec.type==='boolean'||spec.type==='select'||spec.type==='text'||spec.type==='url'?'change':'input',()=>commit(input));
    if(range)this.life.listen(range,'input',()=>{input.value=range.value;commit(range);});
    if(colorText)this.life.listen(colorText,'change',()=>{if(/^#[0-9a-f]{6}$/i.test(colorText.value)){input.value=colorText.value;commit(input);}else{colorText.value=settings[key];this.app.toast('颜色应为 # 加六位十六进制数字');}});
    this.controls.set(key,{key,spec,wrapper,input,range,colorText,override,preview,group:group.id});
    return wrapper;
  }

  fontDetection() {
    const box=text('div',undefined,'ast-stack');
    const actions=text('div',undefined,'ast-row ast-wrap');
    const detect=actionButton('search','检测常见字体',async()=>{detect.disabled=true;try{await fontCatalog.detect();this.app.toast(`已检测到 ${fontCatalog.available.size} 个常见字体`);}catch(error){this.app.toast(error.message,true);}finally{detect.disabled=false;}});
    const scan=actionButton('search','扫描全部本机字体',async()=>{scan.disabled=true;try{const result=await fontCatalog.scanAll();this.app.toast(result.partial?`浏览器未提供完整字体接口，已检测 ${result.count} 个常见字体`:`已读取 ${result.count} 个字体家族`);}catch(error){this.app.toast(error.name==='NotAllowedError'?'字体读取未获允许，仍可手动输入字体名称':error.message,true);}finally{scan.disabled=false;}});
    actions.append(detect,scan);
    this.fontStatus=text('p','可直接输入字体名称；扫描全部字体由浏览器请求权限。','ast-muted');box.append(actions,this.fontStatus);
    return box;
  }

  updateFonts() {
    const revision=fontCatalog.names.size+':'+fontCatalog.available.size+':'+fontCatalog.scanning;
    if(revision===this.fontRevision)return;
    this.fontRevision=revision;
    const families=fontCatalog.options();
    for(const list of this.fontLists){const fragment=document.createDocumentFragment();for(const family of families){const option=document.createElement('option');option.value=family;option.label=fontCatalog.available.has(family)?family+' · 已检测':family;fragment.append(option);}list.replaceChildren(fragment);}
    if(this.fontStatus)this.fontStatus.textContent=fontCatalog.scanning?'正在检测常见字体…':`${fontCatalog.available.size} 个已检测字体 · 可手动输入其他字体名称`;
  }

  filter() {
    const query=this.query.toLocaleLowerCase();let total=0;
    for(const [id,group] of this.groups){
      const categoryMatch=this.category==='all'||this.category===id;
      let matches=0;
      for(const key of group.keys){
        const control=this.controls.get(key);if(!control)continue;
        const matched=!query||`${SCHEMA[key].label} ${key} ${group.title}`.toLocaleLowerCase().includes(query);
        control.wrapper.hidden=!matched;matches+=Number(matched);
      }
      const textMatch=query&&`${group.title} ${group.body.textContent}`.toLocaleLowerCase().includes(query);
      group.details.hidden=query?group.keys.length?matches===0:!textMatch:!categoryMatch;
      if(query&&!group.details.hidden)group.details.open=true;
      else if(!query&&typeof this.app.state.groups?.[id]==='boolean')group.details.open=this.app.state.groups[id];
      if(!group.details.hidden)total+=group.keys.length?matches:1;
    }
    for(const button of this.sidebar.querySelectorAll('[data-category]'))button.toggleAttribute('data-active',!query&&button.dataset.category===this.category);
    if(!this.noResults){this.noResults=emptyState('没有匹配的设置','试试“字号”“玻璃”“海洋”或英文设置名。','search');this.main.append(this.noResults);}
    this.noResults.hidden=total>0;
    this.searchInput.setAttribute('aria-description',query?`找到 ${total} 项匹配设置`:'');
  }

  layoutGroup() {
    const group=this.createGroup('layout','位置与快捷键','按住窗口标题栏或入口的握柄，可把整个工具箱拖到屏幕上的其他位置。位置与尺寸会在松手后保存。');
    group.body.append(actionButton('reset','恢复所有面板与入口位置',()=>this.app.resetLayout()),actionButton('maximize','最大化或恢复设置窗口',()=>this.app.windows.maximize('settings')));
    const shortcuts=text('div',undefined,'ast-shortcuts');
    for(const [key,label] of [['Alt + G','打开或关闭目录'],['Alt + S','打开工具箱设置'],['Alt + Q','打开发送队列'],['Alt + Shift + R','恢复所有窗口位置'],['Esc','关闭最上层工具箱窗口'],['方向键','聚焦标题栏后移动窗口'],['Shift + 方向键','标题栏大步移动'],['双击标题栏','最大化或恢复窗口']])shortcuts.append(text('kbd',key),text('span',label));
    group.body.append(shortcuts,text('p','入口中始终保留独立设置按钮。即使关闭目录、拖动窗口或改变页面尺寸，也可重新找到设置。','ast-muted'));
    return group.details;
  }

  presetsGroup() {
    const group=this.createGroup('presets','外观预设','预设只调整其描述的显示与性能选项，不删除提示词、队列或书签。');
    for(const preset of Object.values(APPEARANCE_PRESETS)){
      const card=text('div',undefined,'ast-preset');const description=text('div');description.append(text('strong',preset.label),text('p',preset.description));card.append(description,actionButton('check','应用',()=>{updateSettings(preset.values);this.app.toast('已应用'+preset.label+'预设');}));group.body.append(card);
    }
    group.body.append(actionButton('reset','全部跟随网页外观',()=>{
      const patch={};for(const [key,spec] of Object.entries(SCHEMA))if(spec.override)patch[key+'Enabled']=false;
      for(const key of [...GLASS_SURFACES.map(surface=>surface.id+'Glass'),'ocean','pageBackground','panelBackground','customAccent','fontSmoothing','wrapCode','lazyMessages','katexLetterFont'])patch[key]=false;
      updateSettings(patch);this.app.toast('已恢复跟随网页外观，工具箱功能仍可使用');
    }));
    return group.details;
  }

  backupGroup() {
    const group=this.createGroup('backup','备份与迁移','统一备份设置、提示词、队列、附件、窗口位置与当前会话标签。');
    group.body.append(actionButton('export','导出完整工具箱备份',()=>this.app.exportBackup()),actionButton('import','导入完整工具箱备份',()=>this.app.importBackup()),actionButton('import','迁移最早版本排版设置',()=>this.migrateLegacy()),actionButton('reset','恢复全部显示设置默认值',async()=>{if(await this.app.dialogs.confirm('恢复显示设置','显示设置将恢复默认。提示词、队列、附件和书签保留。')){updateSettings({...DEFAULTS});this.app.toast('已恢复显示设置默认值');}}));
    return group.details;
  }

  diagnosticsGroup() {
    const group=this.createGroup('diagnostics','状态与兼容');
    this.health=text('div',undefined,'ast-stack');group.body.append(this.health,actionButton('copy','复制诊断信息',async()=>{const value=this.app.diagnostics();this.app.toast(await copyText(JSON.stringify(value,null,2))?'诊断信息已复制':'复制失败');}),text('p','诊断内容包括版本、DOM 适配状态、后台绘制方式和本地计数，不包含对话正文或账号资料。','ast-muted'));
    return group.details;
  }

  async chooseBackground() {
    const file=await this.app.chooseFile('image/png,image/jpeg,image/webp,image/gif');if(!file)return;
    try{
      if(file.size>2*1024*1024)throw Error('本地背景不能超过 2 MiB；大图可使用 https 图片地址');
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});
      if(!imageURL(data))throw Error('不支持的图片类型');
      updateSettings({backgroundImage:data,pageBackground:true});this.app.toast('本地图片已设为背景');
    }catch(error){this.app.toast(error.message,true);}
  }

  migrateLegacy(){
    const mapping={aiStudioFontSize:'fontSize',aiStudioFontFamily:'chineseFont',aiStudioTextColor:'normalColor',aiStudioBoldColor:'boldColor',aiStudioCodeFontFamily:'codeFont',aiStudioCodeFontSize:'codeFontSize',aiStudioMathFontFamily:'mathFont',aiStudioMathFontSize:'formulaFontSize'};
    const patch={};let count=0;
    for(const [legacy,key] of Object.entries(mapping)){
      let raw;try{raw=localStorage.getItem(legacy);}catch(_){continue;}
      if(raw===null||raw===''||raw==='inherit')continue;
      const spec=SCHEMA[key],value=spec.type==='number'?parseFloat(raw):raw;
      if(spec.type==='number'&&!Number.isFinite(value))continue;
      if(spec.type==='color'&&!/^#[0-9a-f]{6}$/i.test(value))continue;
      patch[key]=value;if(spec.override)patch[key+'Enabled']=true;count++;
    }
    if(count){updateSettings(patch);this.app.toast(`已迁移 ${count} 项；旧数据保留`);}else this.app.toast('没有找到可迁移的旧排版设置');
  }

  async resetCurrent(){
    const selected=this.category==='all'?[...this.controls.keys()]:this.groups.get(this.category)?.keys||[];
    if(!selected.length){this.app.toast('该分类没有可恢复的显示参数');return;}
    if(!await this.app.dialogs.confirm('恢复当前分类默认值',`将恢复 ${selected.length} 项参数。其他分类保持不变。`))return;
    const patch={};for(const key of selected){patch[key]=SCHEMA[key].default;if(SCHEMA[key].override)patch[key+'Enabled']=SCHEMA[key].overrideDefault!==false;}updateSettings(patch);
  }

  sync(){
    for(const {key,spec,wrapper,input,range,colorText,override,preview} of this.controls.values()){
      if(spec.type==='boolean')input.checked=!!settings[key];
      else if(this.app.shadow.activeElement!==input)input.value=settings[key];
      if(range&&this.app.shadow.activeElement!==range)range.value=settings[key];
      if(colorText&&this.app.shadow.activeElement!==colorText)colorText.value=settings[key];
      if(override){const enabled=!!settings[key+'Enabled'];override.textContent=enabled?'覆盖':'跟随';override.setAttribute('aria-pressed',String(enabled));wrapper.toggleAttribute('data-disabled',!enabled);}
      if(preview)preview.style.fontFamily=cssFont(settings[key],'serif');
    }
    this.updateFonts();
    if(this.oceanStatus)this.oceanStatus.textContent=this.app.oceanStatus||ocean.getStatus();
    if(this.health){
      const state=this.app.diagnostics();this.health.replaceChildren();
      for(const [label,value] of [['脚本',VERSION],['原站输入框',state.editor?'已找到':'当前页面没有输入框'],['运行按钮',state.runButton?'已找到':'当前页面没有运行按钮'],['公式渲染',state.mathLoaded?'内置 KaTeX 已初始化':state.math?'内置 KaTeX · 按需初始化':'KaTeX 暂不可用'],['动画后台',state.ocean.backend],['已加载消息',String(state.turns)],['窗口位置','已启用拖动、缩放和持久化']]){const row=text('div',undefined,'ast-health');row.append(text('strong',label),text('span',String(value)));this.health.append(row);}
    }
    for(const [key,id] of [['toolboxWidth','nav'],['settingsWidth','settings'],['queuePanelWidth','queue']]){
      if(this.lastWidths[key]!==undefined&&this.lastWidths[key]!==settings[key])this.app.windows.setWidth(id,settings[key]);
      this.lastWidths[key]=settings[key];
    }
  }

  focus(){this.app.windows.ensureVisible('settings');this.searchInput?.focus({preventScroll:true});}
  destroy(){this.life.destroy();this.controls.clear();this.groups.clear();this.fontLists=[];}
}
