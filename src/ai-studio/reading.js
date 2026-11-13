function pageAppearanceCSS(preferences, dark) {
  const css = [];
  const body = 'ms-chat-turn :is(ms-cmark-node,.very-large-text-container)';
  const add = (key, selector, property, value) => {
    if (preferences[key+'Enabled']) css.push(`${selector}{${property}:${value}!important}`);
  };
  add('thinkingFontSize','ms-chat-turn :is(ms-thought-chunk,.thought-container,.thinking-content)','font-size',`${preferences.thinkingFontSize}px`);
  add('citationFontSize','ms-chat-turn :is(ms-grounding-sources,ms-citation,.citation,.source-link,.grounding-source,.file-attachment-label)','font-size',`${preferences.citationFontSize}px`);
  add('letterSpacing',body,'letter-spacing',`${preferences.letterSpacing}px`);
  add('paragraphSpacing',`${body} p`,'margin-block',`${preferences.paragraphSpacing}em`);
  if (preferences.headingScaleEnabled) for (let level=1;level<=6;level++) {
    const scale = 1 + (preferences.headingScale-1)*(7-level)/2;
    css.push(`${body} h${level}{font-size:${scale.toFixed(3)}em!important;line-height:1.4!important}`);
  }
  if (preferences.bodyColumnLeftOffsetEnabled || preferences.bodyColumnRightOffsetEnabled) {
    const left = preferences.bodyColumnLeftOffsetEnabled ? preferences.bodyColumnLeftOffset : 0;
    const right = preferences.bodyColumnRightOffsetEnabled ? preferences.bodyColumnRightOffset : 0;
    css.push(`ms-chat-turn{margin-left:${left}px!important;margin-right:${right}px!important;max-width:max(160px,calc(100% - ${left+right}px))!important}`);
  }
  if (preferences.fontSmoothing) css.push(`${body}{-webkit-font-smoothing:${preferences.fontSmoothingMode}!important;text-rendering:${preferences.textRenderingMode}!important}`);
  if (preferences.katexLetterFont && preferences.mathFontEnabled && preferences.mathFontMode !== 'off') {
    css.push(`ms-chat-turn .katex :is(.mathnormal,.mathit,.mathrm){font-family:${cssFont(preferences.mathFont,'serif')}!important}`);
  }
  add('codeMaxHeight','ms-chat-turn pre','max-height',`${preferences.codeMaxHeight}px`);
  if (preferences.codeMaxHeightEnabled) css.push('ms-chat-turn pre{overflow:auto!important}');
  if (preferences.lazyMessages) css.push('ms-chat-turn{content-visibility:auto;contain-intrinsic-size:auto 260px}');
  css.push(`
    .ast-message-tools{position:absolute;inset-inline-end:8px;top:8px;z-index:8;display:flex;align-items:center;gap:4px;padding:3px;border-radius:10px;color:${preferences.messageCopyIconColor};background:${dark?'rgba(15,23,35,.9)':'rgba(245,248,255,.96)'};font:12px/1.4 "Segoe UI",sans-serif;box-shadow:0 3px 12px #0002;transition:opacity .15s}
    .ast-message-tools button,.ast-code-toolbar button{display:inline-flex;align-items:center;justify-content:center;gap:4px;border:0;border-radius:6px;padding:5px;background:transparent;color:inherit;cursor:pointer;font:inherit}
    .ast-message-tools button:hover,.ast-code-toolbar button:hover{background:#829ac72b}
    .ast-message-tools svg,.ast-code-toolbar svg{width:16px;height:16px;flex:none;pointer-events:none}
    .ast-message-tools button:focus-visible,.ast-code-toolbar button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
    .ast-token-chip{font:11px/1.4 "Segoe UI",sans-serif;padding:2px 6px;border-radius:6px;white-space:nowrap;color:inherit;opacity:.8}
    ms-chat-turn[data-ast-copy-host]{position:relative}
    ${preferences.messageToolsOnHover?'ms-chat-turn:not(:hover):not(:focus-within)>.ast-message-tools{opacity:0;pointer-events:none}':''}
    .ast-code-wrap{position:relative}
    .ast-code-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:8px;color:inherit;font:12px/1.4 "Segoe UI",sans-serif;padding:5px 8px;border-radius:8px;background:#8197b51a}
    .ast-repaired-formula{display:inline;cursor:copy}
    .ast-repaired-formula[data-display="true"]{display:block;overflow-x:auto;padding:4px 0}
    [data-ast-formula-copied]{outline:2px solid ${preferences.formulaCopyBorderColor}!important;outline-offset:3px;border-radius:5px}
    @media(hover:none){ms-chat-turn>.ast-message-tools{opacity:1!important;pointer-events:auto!important}}
    @media(prefers-reduced-motion:reduce){.ast-message-tools{transition:none}}
  `);
  return css.join('\n');
}

function conversationRoute() {
  const path = location.pathname.replace(/^\/u\/\d+(?=\/)/, '').replace(/\/$/, '') || '/';
  return path;
}

function conversationTitle() {
  const field = document.querySelector('ms-playground-toolbar h1,ms-playground-toolbar h2,ms-header h1,ms-header h2');
  const value = normalized(field?.textContent || document.title || 'AI Studio 对话');
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,100) || 'AI Studio 对话';
}

function findConversationScroller() {
  for (const sample of [dom.turns().at(-1),dom.main()]) {
    for (let node=sample;node && node!==document.body;node=node.parentElement) {
      const style=getComputedStyle(node);
      if (node.scrollHeight>node.clientHeight+4 && /(auto|scroll|overlay)/.test(style.overflowY)) return node;
    }
  }
  return document.scrollingElement || document.documentElement;
}

function nativeAttachments() {
  const shell = dom.editor()?.closest('footer,ms-prompt-box') || dom.shell();
  if (!shell) return [];
  const chips = shell.querySelectorAll('ms-file-attachment,ms-image-chunk,ms-audio-chunk,ms-video-chunk,.attachment-chip,.file-chip,[data-attachment-name]');
  return [...chips].map(chip => chip.getAttribute('data-attachment-name') || chip.getAttribute('title') || normalized(chip.textContent)).filter(Boolean);
}

async function insertNativeAttachments(metadata) {
  if (!metadata?.length) return;
  if (nativeAttachments().length) throw Error('原站输入框已有附件，自动队列已暂停');
  const shell=dom.editor()?.closest('footer,ms-prompt-box') || dom.shell();
  let input=shell?.querySelector('input[type="file"]');
  if (!input) input=document.querySelector('ms-add-media-button input[type="file"],ms-prompt-box input[type="file"]');
  if (!input) throw Error('当前 AI Studio 页面未提供可用的附件选择器，请手动添加附件后发送');
  if (input.disabled) throw Error('原站附件选择器当前不可用');
  const transfer=new DataTransfer();
  for(const attachment of metadata) transfer.items.add(await attachmentStore.get(attachment));
  input.files=transfer.files;
  input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
}

function formulaTokens(source) {
  const tokens=[];
  let index=0,plain=0;
  const escaped=at=>{let slashes=0;for(let p=at-1;p>=0&&source[p]==='\\';p--)slashes++;return slashes%2===1;};
  while(index<source.length) {
    let opening='',closing='',display=false;
    if(source.startsWith('$$',index)&&!escaped(index)){opening=closing='$$';display=true;}
    else if(source.startsWith('\\[',index)&&!escaped(index)){opening='\\[';closing='\\]';display=true;}
    else if(source.startsWith('\\(',index)&&!escaped(index)){opening='\\(';closing='\\)';}
    else if(source[index]==='$'&&!escaped(index)){opening=closing='$';}
    if(!opening){index++;continue;}
    let end=index+opening.length;
    while(end<source.length && !(source.startsWith(closing,end)&&!escaped(end))) end++;
    if(end>=source.length){index+=opening.length;continue;}
    const latex=source.slice(index+opening.length,end).trim();
    const plausible=latex.length>0&&latex.length<12000&&(display||/\\[a-zA-Z]+|[_^{}=+*/]|^[a-zA-Zα-ωΑ-Ω]$/.test(latex))&&!(opening==='$'&&(/\n/.test(latex)||/^\d+(?:[.,]\d+)?$/.test(latex)));
    if(!plausible){index=end+closing.length;continue;}
    if(index>plain)tokens.push({text:source.slice(plain,index)});
    tokens.push({latex,display,source:source.slice(index,end+closing.length)});
    index=end+closing.length;plain=index;
  }
  if(plain<source.length)tokens.push({text:source.slice(plain)});
  return tokens;
}

class ReadingEnhancements {
  constructor() {
    this.life=new Lifetime();
    this.toolbars=new Map();
    this.codeBars=new Map();
    this.tokenCache=new WeakMap();
    this.repaired=new Set();
    this.mathSources=new WeakMap();
    this.mathQueue=new Set();
    this.mathSeen=new WeakMap();
    this.failedMathNodes=new WeakMap();
    this.mathTimer=0;
    this.active=false;
    this.onToolClick=this.onToolClick.bind(this);
  }

  start() {
    if(this.active)return;
    this.active=true;
    this.life.listen(document,'click',this.onToolClick);
    this.refresh();
  }

  renderer() {
    if(typeof getBundledKatex==='function')return getBundledKatex();
    if(typeof katex!=='undefined'&&typeof katex.renderToString==='function')return katex;
    if(typeof unsafeWindow!=='undefined'&&typeof unsafeWindow.katex?.renderToString==='function')return unsafeWindow.katex;
    return null;
  }

  installMathCss() {
    if(document.getElementById('ast-katex-style'))return;
    let css=typeof KATEX_CSS==='string'?KATEX_CSS:'';
    if(!css)return;
    css=css.replace(/url\((?:'|")?fonts\//g,'url(https://cdn.jsdelivr.net/npm/katex@0.16.44/dist/fonts/');
    const sheet=text('style',css);sheet.id='ast-katex-style';(document.head||document.documentElement).append(sheet);
    this.life.own(()=>sheet.remove());
  }

  tokens(message) {
    const value=pageIndex.source(message);
    let cached=this.tokenCache.get(message.turn);
    if(!cached||cached.value!==value){cached={value,count:countTokens(value)};this.tokenCache.set(message.turn,cached);}
    return cached.count;
  }

  statistics() {
    const all=messages();
    const users=all.filter(message=>message.role==='user');
    const assistants=all.filter(message=>message.role==='assistant');
    return {input:users.length?this.tokens(users.at(-1)):0,output:assistants.length?this.tokens(assistants.at(-1)):0,total:all.reduce((sum,message)=>sum+this.tokens(message),0),messages:all.length};
  }

  makeToolbar(message) {
    const toolbar=text('div',undefined,'ast-message-tools');
    toolbar.dataset.astOwned='';
    toolbar.setAttribute('role','toolbar');
    toolbar.setAttribute('aria-label',message.role==='assistant'?'回答工具':'提问工具');
    const make=(name,label,action)=>{
      const control=actionButton(name,label,null,{iconOnly:true});
      control.dataset.astAction=action;
      toolbar.append(control);
      return control;
    };
    if(settings.showMessageCopy)make('copy','复制此回答为 Markdown','copy-message');
    if(settings.showBookmarks)toolbar._bookmark=make('star','切换消息书签','bookmark-message');
    if(settings.showTokenStats&&settings.showTokenMessageChips){const chip=text('span','', 'ast-token-chip');chip.dataset.tokenChip='';toolbar._tokenChip=chip;toolbar.append(chip);}
    message.turn.setAttribute('data-ast-copy-host','');
    message.turn.append(toolbar);
    return toolbar;
  }

  refreshMessageTools() {
    const enabled=settings.showMessageCopy||settings.showBookmarks||(settings.showTokenStats&&settings.showTokenMessageChips);
    const all=enabled?messages():[];
    const wanted=new Set(all.map(message=>message.turn));
    const signature=[settings.showMessageCopy,settings.showBookmarks,settings.showTokenStats,settings.showTokenMessageChips].join(':');
    for(const [turn,entry] of this.toolbars){
      if(!turn.isConnected||!wanted.has(turn)||entry.signature!==signature){entry.node.remove();turn.removeAttribute('data-ast-copy-host');this.toolbars.delete(turn);}
    }
    for(const message of all){
      let entry=this.toolbars.get(message.turn);
      if(!entry||!entry.node.isConnected){entry={node:this.makeToolbar(message),signature};this.toolbars.set(message.turn,entry);}
      const chip=entry.node._tokenChip;
      if(chip){const label=`≈ ${this.tokens(message).toLocaleString()} tokens`;if(chip.textContent!==label)chip.textContent=label;}
      const bookmark=entry.node._bookmark;
      if(bookmark){const value=String(ui.isBookmarked?.(message)||false);if(bookmark.getAttribute('aria-pressed')!==value)bookmark.setAttribute('aria-pressed',value);}
    }
  }

  refreshCodeTools() {
    const enabled=settings.codeCopy||settings.codeLineNumbers;
    for(const [pre,entry] of this.codeBars)if(!pre.isConnected||!enabled){entry.remove();this.codeBars.delete(pre);}
    if(!enabled)return;
    for(const root of viewport.roots())for(const pre of root.querySelectorAll('pre')){
      let toolbar=this.codeBars.get(pre);
      if(!toolbar){
        toolbar=text('div',undefined,'ast-code-toolbar');toolbar.dataset.astOwned='';
        const label=text('span','','ast-code-meta');toolbar.append(label);
        const copy=actionButton('copy','复制代码',null);copy.dataset.astAction='copy-code';toolbar.append(copy);
        pre.before(toolbar);this.codeBars.set(pre,toolbar);
      }
      toolbar.querySelector('button').hidden=!settings.codeCopy;
      const code=pre.querySelector('code')||pre;
      const language=String(code.className||'').match(/language-([\w+-]+)/)?.[1]||'代码';
      const lines=(code.textContent||'').split('\n').length;
      const value=settings.codeLineNumbers?`${language} · ${lines} 行`:language;
      if(toolbar.firstElementChild.textContent!==value)toolbar.firstElementChild.textContent=value;
    }
  }

  async onToolClick(event) {
    const control=event.target instanceof Element?event.target.closest('[data-ast-action]'):null;
    if(!control)return;
    const action=control.dataset.astAction;
    if(!['copy-message','bookmark-message','copy-code'].includes(action))return;
    event.preventDefault();event.stopPropagation();
    if(action==='copy-code'){
      const bar=control.closest('.ast-code-toolbar');
      const pre=[...this.codeBars].find(([,node])=>node===bar)?.[0];
      const value=pre?.querySelector('code')?.textContent??pre?.textContent??'';
      ui.toast(await copyText(value)?'已复制代码':'代码复制失败');return;
    }
    const turn=control.closest('ms-chat-turn');
    const message=messages().find(item=>item.turn===turn);
    if(!message)return;
    if(action==='bookmark-message'){ui.toggleBookmark?.(message);this.refreshMessageTools();return;}
    const value=messageMarkdown(message);
    ui.toast(value&&await copyText(value)?'已复制 Markdown':'没有可复制内容');
  }

  repairRoot(root) {
    const renderer=this.renderer();
    if(!renderer||!root.isConnected)return;
    this.installMathCss();
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:node=>{
      const parent=node.parentElement;
      if(!parent||parent.closest('pre,code,textarea,input,button,script,style,math,.katex,.MathJax,mjx-container,ms-thought-chunk,.ast-repaired-formula,[data-ast-owned]'))return NodeFilter.FILTER_REJECT;
      if(this.failedMathNodes.get(node)===node.nodeValue)return NodeFilter.FILTER_REJECT;
      return /\$|\\[([]/.test(node.nodeValue||'')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
    }});
    const nodes=[];
    let current;
    while((current=walker.nextNode())&&nodes.length<300)nodes.push(current);
    let overflow=!!current&&nodes.length>=300;
    const batchStarted=performance.now();let rendered=0;
    for(const node of nodes){
      const source=node.nodeValue||'';
      const tokens=formulaTokens(source);
      if(!tokens.some(token=>token.latex)){this.failedMathNodes.set(node,source);continue;}
      const fragment=document.createDocumentFragment();
      for(let tokenIndex=0;tokenIndex<tokens.length;tokenIndex++){
        const token=tokens[tokenIndex];
        if(rendered&&performance.now()-batchStarted>5){fragment.append(document.createTextNode(tokens.slice(tokenIndex).map(entry=>entry.text??entry.source).join('')));overflow=true;break;}
        if(token.text!==undefined){fragment.append(document.createTextNode(token.text));continue;}
        try{
          const span=text('span',undefined,'ast-repaired-formula');
          span.dataset.latex=token.latex;span.dataset.display=String(token.display);
          span.setAttribute('role','math');span.setAttribute('aria-label',token.latex);
          renderer.render(token.latex,span,{displayMode:token.display,throwOnError:true,trust:false,strict:'ignore',maxSize:20,maxExpand:1000,output:'htmlAndMathml'});
          this.repaired.add(span);this.mathSources.set(span,token.source);fragment.append(span);
          rendered++;
        }catch(_){const original=document.createTextNode(token.source);this.failedMathNodes.set(original,token.source);fragment.append(original);}
      }
      node.replaceWith(fragment);
      if(rendered&&performance.now()-batchStarted>5){overflow=true;break;}
    }
    return overflow;
  }

  queueMath() {
    if(!settings.repairLatex){
      for(const span of this.repaired)if(span.isConnected)span.replaceWith(document.createTextNode(this.mathSources.get(span)||''));
      this.repaired.clear();this.mathSeen=new WeakMap();this.mathQueue.clear();return;
    }
    for(const span of this.repaired)if(!span.isConnected)this.repaired.delete(span);
    for(const root of viewport.roots()){
      const message=messages().find(item=>item.roots.includes(root));
      if(!message)continue;
      const source=pageIndex.source(message);
      if(this.mathSeen.get(root)!==source){this.mathSeen.set(root,source);if(/\$|\\[([]/.test(source))this.mathQueue.add(root);}
    }
    if(this.mathTimer||!this.mathQueue.size)return;
    this.mathTimer=this.life.timeout(()=>{
      this.mathTimer=0;
      const roots=[...this.mathQueue].slice(0,3);
      for(const root of roots){this.mathQueue.delete(root);if(settings.repairLatex&&!document.hidden&&this.repairRoot(root))this.mathQueue.add(root);}
      if(this.mathQueue.size)this.queueMath();
    },120);
  }

  refresh() {
    if(!this.active)return;
    this.refreshMessageTools();
    this.refreshCodeTools();
    this.queueMath();
  }

  destroy() {
    this.life.destroy();
    for(const [turn,entry] of this.toolbars){entry.node.remove();turn.removeAttribute('data-ast-copy-host');}
    for(const bar of this.codeBars.values())bar.remove();
    for(const span of this.repaired)if(span.isConnected)span.replaceWith(document.createTextNode(this.mathSources.get(span)||''));
    this.toolbars.clear();this.codeBars.clear();this.repaired.clear();this.mathQueue.clear();this.active=false;
  }
}

const reading = new ReadingEnhancements();
