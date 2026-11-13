// UI infrastructure: lifetime ownership, accessible dialogs, and floating windows.
class Lifetime {
  constructor() {
    this.disposed = false;
    this.cleanups = [];
    this.timers = new Set();
    this.frames = new Set();
  }

  own(cleanup) {
    if (this.disposed) cleanup();
    else this.cleanups.push(cleanup);
    return cleanup;
  }

  listen(target, type, listener, options) {
    target?.addEventListener(type, listener, options);
    this.own(() => target?.removeEventListener(type, listener, options));
    return listener;
  }

  timeout(callback, delay) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (!this.disposed) callback();
    }, delay);
    this.timers.add(id);
    return id;
  }

  cancelTimeout(id) {
    clearTimeout(id);
    this.timers.delete(id);
  }

  frame(callback) {
    const id = requestAnimationFrame(time => {
      this.frames.delete(id);
      if (!this.disposed) callback(time);
    });
    this.frames.add(id);
    return id;
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    for (const frame of this.frames) cancelAnimationFrame(frame);
    for (const cleanup of this.cleanups.reverse()) {
      try { cleanup(); } catch (error) { console.warn('[AI Studio cleanup]', error); }
    }
    this.timers.clear();
    this.frames.clear();
    this.cleanups.length = 0;
  }
}

const ICON_PATHS = Object.freeze({
  menu: ['M4 6h16M4 12h16M4 18h16'],
  settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'm9 3-.5 2-2 1-2-.6-2 3.4 1.5 1.5v2.4L2.5 14l2 3.4 2-.6 2 1 .5 2.2h4l.5-2.2 2-1 2 .6 2-3.4-1.5-1.3v-2.4l1.5-1.5-2-3.4-2 .6-2-1L13 3z'],
  close: ['m6 6 12 12M6 18 18 6'],
  chevron: ['m8 5 7 7-7 7'],
  down: ['m6 9 6 6 6-6'],
  up: ['m6 15 6-6 6 6'],
  search: ['M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15', 'm16 16 5 5'],
  copy: ['M8 8h12v13H8z', 'M16 8V3H3v13h5'],
  check: ['m4 12 5 5L20 6'],
  edit: ['m15 4 5 5-11 11-6 1 1-6z', 'm12 7 5 5'],
  trash: ['M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7'],
  plus: ['M12 4v16M4 12h16'],
  pin: ['m8 3 8 0-1 6 4 4H5l4-4z', 'M12 13v8'],
  star: ['m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z'],
  export: ['M12 3v12m-4-4 4 4 4-4', 'M4 15v6h16v-6'],
  import: ['M12 16V4m-4 4 4-4 4 4', 'M4 15v6h16v-6'],
  play: ['m8 4 12 8-12 8z'],
  pause: ['M8 4v16M16 4v16'],
  queue: ['M9 5h12M9 12h12M9 19h12', 'm2 3 3 2-3 2M2 12h3M2 19h3'],
  list: ['M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1'],
  book: ['M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3z', 'M12 6v15'],
  grip: ['M5 8h14M5 12h14M5 16h14'],
  reset: ['M3 10a9 9 0 1 1 1 8', 'M3 3v7h7'],
  maximize: ['M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5'],
  restore: ['M7 7h13v13H7z', 'M4 16V4h12'],
  attach: ['m8 12 7-7a4 4 0 0 1 6 6L10 22a6 6 0 0 1-8-8L13 3', 'm6 16 10-10'],
  globe: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20', 'M2 12h20M12 2c6 6 6 14 0 20-6-6-6-14 0-20'],
  clock: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20', 'M12 6v6l4 2'],
  info: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20', 'M12 11v6M12 7v.1'],
  bolt: ['m13 2-9 12h7l-1 8 10-13h-7z'],
  keyboard: ['M2 5h20v14H2z', 'M6 9h.1M10 9h.1M14 9h.1M18 9h.1M6 13h.1M10 13h.1M14 13h.1M18 13h.1M8 16h8'],
});

function icon(name, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({viewBox:'0 0 24 24',width:size,height:size,fill:'none',stroke:'currentColor','stroke-width':1.65,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'})) svg.setAttribute(key, String(value));
  for (const d of ICON_PATHS[name] || ICON_PATHS.info) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function actionButton(name, label, action, options = {}) {
  const control = button('', label, action);
  control.className = options.iconOnly ? 'ast-icon-button' : 'ast-action';
  control.append(icon(name, options.size || 17));
  if (!options.iconOnly) control.append(text('span', label));
  if (options.className) control.classList.add(options.className);
  return control;
}

function labeledInput(label, type = 'text', value = '') {
  const wrapper = text('label', undefined, 'ast-field');
  const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') input.type = type;
  input.value = value;
  input.setAttribute('aria-label', label);
  wrapper.append(text('span', label, 'ast-field-label'), input);
  return {wrapper, input};
}

function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / 1024 / 1024).toFixed(1)} MiB`;
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function cleanReadingText(root){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:node=>node.parentElement?.closest('[data-ast-owned],.ast-message-tools,.ast-code-toolbar,button,script,style')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  const parts=[];let node;while((node=walker.nextNode()))parts.push(node.nodeValue||'');return parts.join('');
}

function normalizeUIState(value){
  if(!value||typeof value!=='object'||Array.isArray(value))value={};
  const result={navOpen:typeof value.navOpen==='boolean'?value.navOpen:true,settingsOpen:!!value.settingsOpen,queueOpen:!!value.queueOpen,tab:['conversation','headings','search','prompts','export'].includes(value.tab)?value.tab:'conversation',settingsCategory:typeof value.settingsCategory==='string'?value.settingsCategory:'fonts',queueDraft:typeof value.queueDraft==='string'?value.queueDraft.slice(0,2000000):'',groups:{},queueDraftFiles:[]};
  if(value.groups&&typeof value.groups==='object'&&!Array.isArray(value.groups))for(const [key,open]of Object.entries(value.groups))if(typeof open==='boolean'&&key.length<120)result.groups[key]=open;
  if(Array.isArray(value.queueDraftFiles))result.queueDraftFiles=value.queueDraftFiles.filter(file=>file&&typeof file.id==='string'&&typeof file.name==='string').slice(0,100).map(file=>({id:file.id,name:file.name,size:Math.max(0,finite(file.size)),type:String(file.type||''),lastModified:finite(file.lastModified,Date.now())}));
  return result;
}

class FloatingWindows {
  constructor(host, storageKey, onLayout) {
    this.host = host;
    this.key = storageKey;
    this.onLayout = onLayout;
    this.life = new Lifetime();
    this.windows = new Map();
    this.saved = readJSON(storageKey, {});
    if (!this.saved || typeof this.saved !== 'object' || Array.isArray(this.saved)) this.saved = {};
    this.z = 10;
    this.drag = null;
    this.frame = 0;
    this.saveTimer = 0;
    this.suppressClickUntil = 0;
    this.suppressNextClick = false;
    this.life.listen(window, 'resize', () => this.fitAll());
    this.life.listen(window.visualViewport, 'resize', () => this.fitAll());
    this.life.listen(window, 'blur', () => this.finishGesture(true));
    this.life.listen(document, 'visibilitychange', () => {
      if (document.hidden) this.finishGesture(true);
    });
    this.life.listen(host, 'click', event => {
      if (this.suppressNextClick && event.detail>0 && performance.now() < this.suppressClickUntil) {
        this.suppressNextClick=false;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    this.life.listen(host,'pointerdown',()=>{this.suppressNextClick=false;},true);
  }

  bounds() {
    return {width:document.documentElement.clientWidth || innerWidth,height:innerHeight,pad:8};
  }

  defaultRect(id, defaults) {
    const {width, height, pad} = this.bounds();
    const w = Math.min(defaults.width, width - pad * 2);
    const h = Math.min(defaults.height, height - pad * 2);
    const left = defaults.side === 'left' ? 20 : defaults.side === 'center' ? (width - w) / 2 : width - w - 20;
    const top = defaults.bottom ? height - h - defaults.bottom : defaults.top ?? 76;
    return this.clampRect({left, top, width:w, height:h}, defaults);
  }

  clampRect(rect, limits = {}) {
    const b = this.bounds();
    const width = clamp(finite(rect.width, limits.width || 320), Math.min(limits.minWidth || 240, b.width - 16), b.width - 16);
    const height = clamp(finite(rect.height, limits.height || 480), Math.min(limits.minHeight || 180, b.height - 16), b.height - 16);
    return {
      left:clamp(finite(rect.left, b.pad), b.pad, Math.max(b.pad, b.width - width - b.pad)),
      top:clamp(finite(rect.top, b.pad), b.pad, Math.max(b.pad, b.height - height - b.pad)),
      width,
      height,
    };
  }

  fitRect(state,rect=state.rect){
    if(!state.collapsed)return this.clampRect(rect,state.defaults);
    const fit=this.clampRect({...rect,height:50},{...state.defaults,minHeight:50,height:50});
    return {...fit,height:clamp(rect.height,state.defaults.minHeight||180,Math.max(state.defaults.minHeight||180,this.bounds().height-16))};
  }

  normalizeSaved(id, defaults) {
    const stored = this.saved[id];
    if (!stored || typeof stored !== 'object') return this.defaultRect(id, defaults);
    const bounds = this.bounds();
    const left = finite(stored.left, NaN);
    const top = finite(stored.top, NaN);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return this.defaultRect(id, defaults);
    const previousWidth = finite(stored.viewportWidth, bounds.width);
    const previousHeight = finite(stored.viewportHeight, bounds.height);
    let x = left, y = top;
    if (previousWidth !== bounds.width) {
      const previousFree = Math.max(1, previousWidth - finite(stored.width, defaults.width) - 16);
      x = 8 + clamp((left - 8) / previousFree, 0, 1) * Math.max(0, bounds.width - finite(stored.width, defaults.width) - 16);
    }
    if (previousHeight !== bounds.height) {
      const previousFree = Math.max(1, previousHeight - finite(stored.height, defaults.height) - 16);
      y = 8 + clamp((top - 8) / previousFree, 0, 1) * Math.max(0, bounds.height - finite(stored.height, defaults.height) - 16);
    }
    return this.clampRect({left:x,top:y,width:stored.width,height:stored.height}, defaults);
  }

  register(id, node, header, defaults) {
    this.remove(id);
    const life = new Lifetime();
    const state = {id,node,header,defaults,life,rect:this.normalizeSaved(id, defaults),restore:null,collapsed:false};
    this.windows.set(id, state);
    node.dataset.window = id;
    node.style.position = 'fixed';
    node.style.right = 'auto';
    node.style.bottom = 'auto';
    header.dataset.dragHandle = id;
    header.tabIndex = 0;
    header.setAttribute('aria-label', `${defaults.label}标题栏，拖动移动，方向键微调位置`);
    header.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight');
    this.apply(state);
    life.listen(node, 'pointerdown', () => this.raise(id), {capture:true,passive:true});
    life.listen(header, 'pointerdown', event => this.beginGesture(event, state, 'move'));
    life.listen(header, 'dblclick', event => {
      if (!event.target.closest('button,input,select,textarea')) this.maximize(id);
    });
    life.listen(header, 'keydown', event => this.onHeaderKey(event, state));
    for (const direction of ['n','s','e','w','ne','nw','se','sw']) {
      const handle = text('div', undefined, `ast-resize-handle ast-resize-${direction}`);
      handle.dataset.resize = direction;
      handle.setAttribute('aria-hidden', 'true');
      node.append(handle);
      life.listen(handle, 'pointerdown', event => this.beginGesture(event, state, direction));
      life.own(() => handle.remove());
    }
    this.raise(id);
    return state;
  }

  registerLauncher(node, defaults = {}) {
    const id = 'launcher';
    const size = {width:defaults.width || 196,height:defaults.height || 42,minWidth:140,minHeight:36,side:'right',top:18,label:'工具箱入口'};
    const state = this.register(id, node, node, size);
    for (const handle of node.querySelectorAll('.ast-resize-handle')) handle.remove();
    state.launcher = true;
    return state;
  }

  raise(id) {
    const entry = this.windows.get(id);
    if (!entry) return;
    entry.node.style.zIndex = String(++this.z);
    if (this.z > 100000) {
      const ordered = [...this.windows.values()].sort((a,b) => Number(a.node.style.zIndex) - Number(b.node.style.zIndex));
      this.z = 10;
      for (const state of ordered) state.node.style.zIndex = String(++this.z);
    }
  }

  apply(state) {
    const r = state.rect;
    for (const [property,value] of Object.entries({left:r.left,top:r.top,width:r.width,height:state.collapsed?50:r.height})) state.node.style[property] = `${Math.round(value)}px`;
    state.node.toggleAttribute('data-collapsed', state.collapsed);
    state.node.toggleAttribute('data-maximized', !!state.restore);
  }

  beginGesture(event, state, mode) {
    if (event.button !== 0 || this.drag || event.isPrimary === false) return;
    if (mode === 'move' && event.target.closest('button,input,select,textarea,a,[role="button"]') && !state.launcher) return;
    // The launcher contains buttons. Their pointer sequences remain normal clicks
    // until movement passes a threshold; a completed drag consumes the click.
    const capture = event.currentTarget;
    this.drag = {
      state,mode,pointerId:event.pointerId,capture,
      startX:event.clientX,startY:event.clientY,lastX:event.clientX,lastY:event.clientY,
      origin:{...state.rect},moved:false,
    };
    state.restore = null;
    if (!state.launcher) try { capture.setPointerCapture(event.pointerId); } catch (_) { /* Document listeners remain a fallback. */ }
    const move = next => this.moveGesture(next);
    const end = next => {
      if (next.pointerId === this.drag?.pointerId) this.finishGesture(next.type === 'pointercancel');
    };
    const gestureLife = new Lifetime();
    this.drag.life = gestureLife;
    gestureLife.listen(document, 'pointermove', move, {capture:true,passive:false});
    gestureLife.listen(document, 'pointerup', end, true);
    gestureLife.listen(document, 'pointercancel', end, true);
    gestureLife.listen(capture, 'lostpointercapture', () => this.finishGesture(false));
    if (!state.launcher) event.preventDefault();
    event.stopPropagation();
  }

  moveGesture(event) {
    const gesture = this.drag;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 4) return;
    if(!gesture.moved&&gesture.state.launcher)try{gesture.capture.setPointerCapture(event.pointerId);}catch(_){}
    gesture.moved = true;
    event.preventDefault();
    this.host.setAttribute('data-window-gesture', '');
    gesture.state.node.setAttribute('data-dragging', '');
    if (!this.frame) this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.applyGesture();
    });
  }

  applyGesture() {
    const gesture = this.drag;
    if (!gesture?.moved) return;
    const {state,origin,mode} = gesture;
    const dx = gesture.lastX - gesture.startX;
    const dy = gesture.lastY - gesture.startY;
    let next = {...origin};
    if (mode === 'move') {
      next.left += dx;
      next.top += dy;
    } else {
      if (mode.includes('e')) next.width += dx;
      if (mode.includes('s')) next.height += dy;
      if (mode.includes('w')) { next.width -= dx; next.left += dx; }
      if (mode.includes('n')) { next.height -= dy; next.top += dy; }
      const b = this.bounds();
      const minWidth = Math.min(state.defaults.minWidth || 240, b.width - 16);
      const minHeight = Math.min(state.defaults.minHeight || 180, b.height - 16);
      if (next.width < minWidth && mode.includes('w')) next.left = origin.left + origin.width - minWidth;
      if (next.height < minHeight && mode.includes('n')) next.top = origin.top + origin.height - minHeight;
    }
    state.rect = this.fitRect(state,next);
    this.apply(state);
    this.onLayout?.();
  }

  finishGesture(cancelled) {
    const gesture = this.drag;
    if (!gesture) return;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (gesture.moved) this.applyGesture();
    this.drag = null;
    gesture.life.destroy();
    try {
      if (gesture.capture.hasPointerCapture(gesture.pointerId)) gesture.capture.releasePointerCapture(gesture.pointerId);
    } catch (_) { /* Capture may already have been cancelled by the browser. */ }
    if (cancelled) gesture.state.rect = gesture.origin;
    if (gesture.moved) {
      this.suppressClickUntil = performance.now() + 350;
      this.suppressNextClick = true;
      if(!cancelled)this.snap(gesture.state);
      this.persist(gesture.state);
    }
    gesture.state.node.removeAttribute('data-dragging');
    this.host.removeAttribute('data-window-gesture');
    this.apply(gesture.state);
    this.onLayout?.();
  }

  snap(state) {
    const b = this.bounds();
    const r = state.rect;
    if (Math.abs(r.left - b.pad) < 15) r.left = b.pad;
    if (Math.abs(r.top - b.pad) < 15) r.top = b.pad;
    if (Math.abs(b.width - r.left - r.width - b.pad) < 15) r.left = b.width - r.width - b.pad;
    const height=state.collapsed?50:r.height;
    if (Math.abs(b.height - r.top - height - b.pad) < 15) r.top = b.height - height - b.pad;
  }

  onHeaderKey(event, state) {
    if (event.target !== state.header) return;
    const steps = {ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]};
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const delta = event.shiftKey ? 20 : 4;
    state.rect = this.fitRect(state,{...state.rect,left:state.rect.left+step[0]*delta,top:state.rect.top+step[1]*delta});
    this.apply(state);
    this.persist(state);
    this.onLayout?.();
  }

  persist(state) {
    const b = this.bounds();
    this.saved[state.id] = {...state.rect,viewportWidth:b.width,viewportHeight:b.height};
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = 0;
      writeJSON(this.key, this.saved);
    }, 100);
  }

  fitAll() {
    if (this.drag) this.finishGesture(true);
    for (const state of this.windows.values()) {
      if (state.restore) {
        const b = this.bounds();
        state.rect = {left:b.pad,top:b.pad,width:b.width-b.pad*2,height:b.height-b.pad*2};
      } else state.rect = this.fitRect(state);
      this.apply(state);
    }
    this.onLayout?.();
  }

  ensureVisible(id) {
    const state = this.windows.get(id);
    if (!state) return;
    state.rect = this.fitRect(state);
    this.apply(state);
    this.raise(id);
  }

  maximize(id) {
    const state = this.windows.get(id);
    if (!state || state.launcher) return;
    if (state.restore) {
      state.rect = this.clampRect(state.restore, state.defaults);
      state.restore = null;
    } else {
      const b = this.bounds();
      state.restore = {...state.rect};
      state.rect = {left:b.pad,top:b.pad,width:b.width-b.pad*2,height:b.height-b.pad*2};
    }
    state.collapsed = false;
    this.apply(state);
    this.raise(id);
    this.onLayout?.();
  }

  collapse(id) {
    const state = this.windows.get(id);
    if (!state || state.launcher) return;
    state.collapsed = !state.collapsed;
    state.rect=this.fitRect(state);
    this.apply(state);
    this.onLayout?.();
  }

  setWidth(id, width) {
    const state = this.windows.get(id);
    if (!state || state.restore) return;
    state.rect = this.clampRect({...state.rect,width}, state.defaults);
    this.apply(state);
    this.persist(state);
    this.onLayout?.();
  }

  reset(id) {
    const selected = id ? [this.windows.get(id)].filter(Boolean) : [...this.windows.values()];
    for (const state of selected) {
      state.rect = this.defaultRect(state.id, state.defaults);
      state.restore = null;
      state.collapsed = false;
      delete this.saved[state.id];
      this.apply(state);
    }
    writeJSON(this.key, this.saved);
    this.onLayout?.();
  }

  remove(id) {
    const old = this.windows.get(id);
    if (!old) return;
    if (this.drag?.state === old) this.finishGesture(true);
    old.life.destroy();
    this.windows.delete(id);
  }

  flush(){clearTimeout(this.saveTimer);this.saveTimer=0;writeJSON(this.key,this.saved);}

  destroy() {
    if (this.drag) this.finishGesture(true);
    clearTimeout(this.saveTimer);
    if (this.saveTimer) writeJSON(this.key, this.saved);
    for (const id of [...this.windows.keys()]) this.remove(id);
    this.life.destroy();
  }
}

class Dialogs {
  constructor(shadow) {
    this.shadow = shadow;
    this.current = null;
  }

  async open({title, description = '', fields = [], accept = '确定', danger = false, content = null, cancel = '取消'}) {
    if (this.current) this.current.finish(null);
    const previous = this.shadow.activeElement || document.activeElement;
    const life = new Lifetime();
    const layer = text('div', undefined, 'ast-dialog-layer');
    const panel = text('section', undefined, 'ast-dialog');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', title);
    panel.tabIndex = -1;
    panel.append(text('h2', title));
    if (description) panel.append(text('p', description, 'ast-muted'));
    if (content) panel.append(content);
    const inputs = new Map();
    for (const field of fields) {
      const entry = labeledInput(field.label, field.type || 'text', field.value || '');
      entry.input.required = !!field.required;
      if (field.placeholder) entry.input.placeholder = field.placeholder;
      if (field.type === 'textarea') entry.input.rows = field.rows || 6;
      inputs.set(field.name, entry.input);
      panel.append(entry.wrapper);
    }
    const error = text('p', '', 'ast-error');
    error.hidden = true;
    error.setAttribute('role', 'alert');
    panel.append(error);
    const actions = text('div', undefined, 'ast-dialog-actions');
    const cancelButton = actionButton('close', cancel, () => finish(null));
    const acceptButton = actionButton(danger ? 'trash' : 'check', accept, () => submit(), {className:danger?'ast-danger':'ast-primary'});
    actions.append(cancelButton, acceptButton);
    panel.append(actions);
    layer.append(panel);
    this.shadow.append(layer);
    let resolve;
    const result = new Promise(done => { resolve = done; });
    const finish = value => {
      if (this.current?.layer !== layer) return;
      this.current = null;
      life.destroy();
      layer.remove();
      if (previous?.isConnected) previous.focus({preventScroll:true});
      resolve(value);
    };
    const submit = () => {
      const invalid = [...inputs.values()].find(input => input.required && !input.value.trim());
      if (invalid) {
        error.textContent = `请填写${invalid.getAttribute('aria-label')}`;
        error.hidden = false;
        invalid.focus();
        return;
      }
      finish(Object.fromEntries([...inputs].map(([name,input]) => [name,input.value])));
    };
    this.current = {layer, panel, finish};
    life.listen(layer, 'pointerdown', event => {
      if (event.target === layer) finish(null);
    });
    life.listen(panel, 'keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(null); }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); }
      if (event.key !== 'Tab') return;
      const focusable = [...panel.querySelectorAll('button,input,textarea,select,a[href]')].filter(node => !node.disabled && !node.hidden);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (this.shadow.activeElement === first || this.shadow.activeElement === panel)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && this.shadow.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    (inputs.values().next().value || acceptButton).focus({preventScroll:true});
    return result;
  }

  async confirm(title, description, danger = false) {
    return !!await this.open({title,description,danger,accept:danger?'确认删除':'继续'});
  }

  destroy() {
    this.current?.finish(null);
  }
}

class AttachmentStore {
  constructor() {
    this.name = 'ai-studio-toolbox-files-v4';
  }

  async database() {
    return new Promise((resolve,reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files', {keyPath:'id'});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error('无法打开附件存储'));
      request.onblocked = () => reject(Error('附件存储正被另一个页面占用'));
    });
  }

  async operation(mode, callback) {
    const db = await this.database();
    try {
      return await new Promise((resolve,reject) => {
        const tx = db.transaction('files', mode);
        const result = callback(tx.objectStore('files'));
        tx.oncomplete = () => resolve(result?.result);
        tx.onerror = () => reject(tx.error || Error('附件存储操作失败'));
        tx.onabort = () => reject(tx.error || Error('附件存储操作被取消'));
      });
    } finally { db.close(); }
  }

  async put(file) {
    if (!(file instanceof Blob)) throw Error('附件格式无效');
    if (file.size > 100 * 1024 * 1024) throw Error('单个队列附件不能超过 100 MiB');
    const record = {id:uid(),name:file.name || '附件',type:file.type || 'application/octet-stream',size:file.size,lastModified:file.lastModified || Date.now(),blob:file};
    await this.operation('readwrite', store => store.put(record));
    const {blob, ...metadata} = record;
    return metadata;
  }

  async get(metadata) {
    const record = await this.operation('readonly', store => store.get(metadata.id));
    if (!record?.blob) throw Error(`附件「${metadata.name}」已不可用，请重新选择`);
    return new File([record.blob], record.name, {type:record.type,lastModified:record.lastModified});
  }

  async remove(ids) {
    if (!ids.length) return;
    await this.operation('readwrite', store => { for (const id of ids) store.delete(id); });
  }

  async list() {
    return await this.operation('readonly', store => store.getAll()) || [];
  }

  async collectUnused(retained) {
    const keep = new Set(retained);
    const records = await this.list();
    const expired = records.filter(record => !keep.has(record.id) && Date.now() - record.lastModified > 86400000);
    await this.remove(expired.map(record => record.id));
  }
}

const attachmentStore = new AttachmentStore();

async function releaseAttachments(ids){
  const retained=new Set([...queue.items.flatMap(item=>item.attachments.map(file=>file.id)),...(ui.queueView?.attachments||[]).map(file=>file.id)]);
  await attachmentStore.remove(ids.filter(id=>!retained.has(id)));
}

class FontCatalog {
  constructor() {
    this.names = new Set([
      'Arial','Arial Black','Arial Narrow','Bahnschrift','Calibri','Cambria','Cambria Math','Candara','Cascadia Code','Cascadia Mono','Comic Sans MS','Consolas','Constantia','Corbel','Courier New','DengXian','FangSong','FZNewShuSong-Z10S','Georgia','Helvetica','Impact','JetBrains Mono','KaiTi','Latin Modern Math','Lora','Microsoft JhengHei','Microsoft JhengHei UI','Microsoft YaHei','Microsoft YaHei UI','MingLiU','Noto Sans','Noto Sans CJK SC','Noto Sans SC','Noto Serif','Noto Serif SC','Palatino Linotype','Segoe UI','Segoe UI Variable','SimHei','SimSun','SimSun-ExtB','Source Han Sans SC','Source Han Serif SC','STIX Two Math','STSong','Songti SC','Tahoma','Times New Roman','Trebuchet MS','Verdana','等线','方正新书宋_GBK','黑体','华文仿宋','华文楷体','华文宋体','华文中宋','楷体','宋体','微软雅黑','新宋体',
    ]);
    this.available = new Set();
    this.scanning = false;
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() { for (const listener of this.listeners) listener(); }

  async detect() {
    if (this.scanning) return;
    this.scanning = true;
    this.emit();
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      const sample = 'mmmmmmmmmmWWWWW0123456789汉字永国';
      const base = ['monospace','sans-serif','serif'].map(fallback => {
        context.font = `72px ${fallback}`;
        return context.measureText(sample).width;
      });
      let count = 0;
      for (const name of this.names) {
        const escaped = JSON.stringify(name);
        const found = ['monospace','sans-serif','serif'].some((fallback,index) => {
          context.font = `72px ${escaped},${fallback}`;
          return Math.abs(context.measureText(sample).width - base[index]) > .01;
        });
        if (found) this.available.add(name);
        if (++count % 12 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally { this.scanning = false; this.emit(); }
  }

  async scanAll() {
    const provider = typeof globalThis.queryLocalFonts === 'function' ? globalThis : typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.queryLocalFonts === 'function' ? unsafeWindow : null;
    if (!provider) {
      await this.detect();
      return {partial:true,count:this.available.size};
    }
    const fonts = await provider.queryLocalFonts();
    for (const font of fonts) if (typeof font.family === 'string' && font.family.length < 180) {
      this.names.add(font.family);
      this.available.add(font.family);
    }
    this.emit();
    return {partial:false,count:this.available.size};
  }

  options(query = '') {
    const needle = query.trim().toLocaleLowerCase();
    return [...this.names].filter(name => !needle || name.toLocaleLowerCase().includes(needle)).sort((a,b) => Number(this.available.has(b)) - Number(this.available.has(a)) || a.localeCompare(b,'zh-CN'));
  }
}

const fontCatalog = new FontCatalog();
