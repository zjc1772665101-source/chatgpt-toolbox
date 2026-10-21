// ==UserScript==
// @name         ChatGPT 工具箱
// @namespace    local.codex.chatgpt.unified
// @version      1.6.81
// @description  ChatGPT 长对话工具箱；独立玻璃参数与折叠设置、GPU 海洋与轨迹回放、新版输入框与顶栏适配、272 项界面默认设置。
// @author       Codex；含 Alex S Hamilton 的 ChatGPT Lazy Chat++（GPL-3.0-or-later）
// @homepageURL  https://github.com/zjc1772665101-source/chatgpt-toolbox
// @supportURL   https://github.com/zjc1772665101-source/chatgpt-toolbox/issues
// @downloadURL  https://raw.githubusercontent.com/zjc1772665101-source/chatgpt-toolbox/main/chatgpt-toolbox.user.js
// @updateURL    https://raw.githubusercontent.com/zjc1772665101-source/chatgpt-toolbox/main/chatgpt-toolbox.user.js
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_getResourceText
// @grant        unsafeWindow
// @require      https://cdn.jsdelivr.net/npm/katex@0.16.44/dist/katex.min.js
// @resource     ophelKatexCss https://cdn.jsdelivr.net/npm/katex@0.16.44/dist/katex.min.css
// @license      GPL-3.0-or-later
// ==/UserScript==


/* SPDX-License-Identifier: GPL-3.0-or-later */

(function unifiedSurfaceScope() {
  'use strict';

  // Query parameters need not survive navigation. Identify the official host
  // as well, without accessing its cross-origin document or allowing arbitrary
  // embedded ChatGPT previews. This cannot make Tampermonkey inject a script.
  const officialSideChatOrigin = 'chrome-extension://hehggadaopoacecdllhhajmbjkdcmajg';
  const isFrame = window.self !== window.top;
  const hasSideChatSurface = new URLSearchParams(location.search).get('surface') === 'browser_side_chat';
  let isOfficialSideChatHost = false;
  if (isFrame) {
    try {
      isOfficialSideChatHost = location.ancestorOrigins?.[0] === officialSideChatOrigin;
    } catch (_) { /* Some browsers do not expose ancestorOrigins. */ }
    if (!isOfficialSideChatHost) {
      try {
        const referrer = new URL(document.referrer);
        isOfficialSideChatHost = referrer.protocol === 'chrome-extension:'
          && referrer.host === 'hehggadaopoacecdllhhajmbjkdcmajg';
      } catch (_) { /* An empty/referrer-policy-filtered referrer is normal. */ }
    }
  }
  const allowedSurface = !isFrame || hasSideChatSurface || isOfficialSideChatHost;
  let bootstrapState = allowedSurface ? 'starting' : 'skipped-frame';
  const stampBootstrap = () => {
    const root = document.documentElement;
    if (!root) return;
    root.setAttribute('data-cgpt-unified-version', '1.6.81');
    root.setAttribute('data-cgpt-unified-surface', isFrame ? (allowedSurface ? 'side-chat' : 'other-frame') : 'tab');
    root.setAttribute('data-cgpt-unified-bootstrap', bootstrapState);
  };
  stampBootstrap();
  if (!document.documentElement) document.addEventListener('DOMContentLoaded', stampBootstrap, { once: true });
  if (!allowedSurface) return;

  try {

(function coordinatorBundle() {
  'use strict';

  const RUNTIME_KEY = '__cgptUnifiedRuntimeV1';
  const NAV_ATTR = 'data-cgpt-unified-navigation-active';
  const PROMPT_STORAGE_KEY = 'cgpt-unified-prompt-library-v1';
  const runtime = globalThis[RUNTIME_KEY] || (globalThis[RUNTIME_KEY] = {});

  runtime.version = '1.6.81';
  // Shared scheduling for navigation and floating UI. Cache only during a
  // synchronous read phase; never retain DOM snapshots across frames/awaits.
  runtime.pageWork = (() => {
    let raf = 0, sequence = 0, cache = null;
    const jobs = new Map(), roots = new Map();
    const stats = { batches: 0, callbacks: 0, memoHits: 0, memoReads: 0, observerDeliveries: 0 };
    const report = error => console.warn('[ChatGPT page work]', error);
    // Glass surfaces share one ResizeObserver; subscribers still own cleanup.
    let resizeObserver = null;
    const sizeClients = new Map();
    function observeSize(element, callback) {
      if (typeof ResizeObserver !== 'function') return { disconnect() {} };
      if (!resizeObserver) resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) for (const client of [...(sizeClients.get(entry.target) || [])]) {
          try { client(entry); } catch (error) { report(error); }
        }
      });
      let clients = sizeClients.get(element);
      if (!clients) { clients = new Set(); sizeClients.set(element, clients); resizeObserver.observe(element); }
      clients.add(callback);
      let disconnected = false;
      return { disconnect() {
        if (disconnected) return; disconnected = true;
        clients.delete(callback);
        if (!clients.size) { resizeObserver.unobserve(element); sizeClients.delete(element); }
        if (!sizeClients.size) { resizeObserver.disconnect(); resizeObserver = null; }
      } };
    }

    // Native boundary/elastic scrolling can emit scroll notifications without
    // changing a DOM scroll offset. Each subscriber keeps its own history so
    // one module cannot consume an event needed by another module.
    function onScrollChange(callback) {
      const positions = new WeakMap();
      return event => {
        if (event?.type === 'scroll') {
          const target = event.target;
          let position = null;
          if (target && target === window.visualViewport) {
            position = [target.offsetLeft, target.offsetTop, target.width, target.height, target.scale].join('|');
          } else if (target === document || target === window) {
            position = [window.scrollX, window.scrollY].join('|');
          } else if (target && typeof target.scrollTop === 'number' && typeof target.scrollLeft === 'number') {
            position = [target.scrollLeft, target.scrollTop].join('|');
          }
          if (position !== null) {
            if (positions.get(target) === position) return;
            positions.set(target, position);
          }
        }
        return callback(event);
      };
    }

    function fresh() { cache = new WeakMap(); }
    function flush(timestamp) {
      raf = 0; stats.batches++;
      const batch = [...jobs.entries()];
      // Legacy navigation callbacks may write DOM. Give each its own snapshot.
      for (const [id, job] of batch.filter(([, job]) => !job.layout)) {
        if (!jobs.delete(id)) continue;
        fresh(); stats.callbacks++;
        try { job.callback(timestamp); } catch (error) { report(error); }
        finally { cache = null; }
      }
      const writes = [];
      fresh();
      try {
        for (const [id, job] of batch.filter(([, job]) => job.layout).sort((a, b) => a[1].priority - b[1].priority)) {
          if (!jobs.delete(id)) continue;
          stats.callbacks++;
          try { const write = job.callback(timestamp); if (typeof write === 'function') writes.push(write); }
          catch (error) { report(error); }
        }
      } finally { cache = null; }
      for (const write of writes) try { write(); } catch (error) { report(error); }
    }
    function request(callback, layout = false, priority = 0) {
      const id = ++sequence; jobs.set(id, { callback, layout, priority });
      if (!raf) raf = requestAnimationFrame(flush);
      return id;
    }
    function memo(root, key, read) {
      if (!cache || !root) return read();
      let values = cache.get(root); if (!values) cache.set(root, values = new Map());
      if (values.has(key)) { stats.memoHits++; return values.get(key); }
      stats.memoReads++; const value = read(); values.set(key, value); return value;
    }
    function deliver(entry, records) {
      if (!records.length) return;
      stats.observerDeliveries++;
      for (const item of [...entry.clients]) {
        const selected = records.filter(record => (item.options.subtree || record.target === entry.root) && (record.type !== 'attributes'
          ? item.options[record.type] === true
          : item.options.attributes && (!item.options.attributeFilter || item.options.attributeFilter.includes(record.attributeName))));
        if (selected.length) try { item.callback(selected); } catch (error) { report(error); }
      }
    }
    function reobserve(entry) {
      deliver(entry, entry.observer.takeRecords()); entry.observer.disconnect();
      if (!entry.clients.size) { roots.delete(entry.root); return; }
      const all = [...entry.clients].map(item => item.options);
      const options = { subtree: true, childList: all.some(o => o.childList), characterData: all.some(o => o.characterData), attributes: all.some(o => o.attributes) };
      const attrs = all.filter(o => o.attributes);
      if (attrs.length && attrs.every(o => o.attributeFilter)) options.attributeFilter = [...new Set(attrs.flatMap(o => o.attributeFilter))];
      entry.observer.observe(entry.root, options);
    }
    return {
      observeSize, onScrollChange,
      requestFrame: callback => request(callback),
      requestLayout: (callback, priority = 0) => request(callback, true, priority),
      cancelFrame(id) { jobs.delete(id); if (!jobs.size && raf) { cancelAnimationFrame(raf); raf = 0; } },
      memo,
      invalidate() { if (cache) fresh(); },
      query(root, selector) { return memo(root, 'query:' + selector, () => [...root.querySelectorAll(selector)]).slice(); },
      rect(element) { return memo(element, 'rect', () => element.getBoundingClientRect()); },
      planRect(element, rect) { if (!cache) return; let values = cache.get(element); if (!values) cache.set(element, values = new Map()); values.set('rect', rect); },
      observe(root, options, callback) {
        let entry = roots.get(root);
        if (!entry) { entry = { root, clients: new Set() }; entry.observer = new MutationObserver(records => deliver(entry, records)); roots.set(root, entry); }
        // Deliver old records before adding a new subscriber.
        deliver(entry, entry.observer.takeRecords());
        const item = { options, callback }; entry.clients.add(item); reobserve(entry);
        let disconnected = false;
        return { flush() { if (!disconnected) deliver(entry, entry.observer.takeRecords()); }, disconnect() { if (disconnected) return; disconnected = true; deliver(entry, entry.observer.takeRecords()); entry.clients.delete(item); reobserve(entry); } };
      },
      getState: () => ({ ...stats, queued: jobs.size, resizeObservers: resizeObserver ? 1 : 0, resizeTargets: sizeClients.size, observers: roots.size, subscribers: [...roots.values()].reduce((n, entry) => n + entry.clients.size, 0) }),
    };
  })();

  // Prefer semantic attributes over generated CSS class names. New ChatGPT
  // renders a user/assistant pair under data-turn-key without legacy role nodes.
  const dom = runtime.dom = Object.freeze({
    assistant: ':is([data-message-author-role="assistant"], [data-markdown-text-style="assistant-message"]:not([data-message-author-role] *))',
    user: ':is([data-message-author-role="user"], [data-user-message-bubble]:not([data-message-author-role] *))',
    message: ':is([data-message-author-role], [data-markdown-text-style="assistant-message"]:not([data-message-author-role] *), [data-user-message-bubble]:not([data-message-author-role] *))',
    content: ':is(.markdown, .prose, [data-markdown-text-style="assistant-message"], [data-markdown-text-style="user-message"])',
    turn: ':is([data-testid^="conversation-turn-"], [data-turn-key])',
    role(node) {
      return node?.getAttribute?.('data-message-author-role')
        || (node?.matches?.('[data-user-message-bubble]') ? 'user' : '')
        || (node?.matches?.('[data-markdown-text-style="assistant-message"]') ? 'assistant' : '');
    },
    isThinkingOverview(node) {
      return node instanceof Element
        && node.matches('[data-markdown-text-style="assistant-message"][data-markdown-text-tone="tertiary"]');
    },
    messageId(node) {
      return node?.closest?.('[data-message-id]')?.getAttribute('data-message-id')
        || node?.closest?.('[data-chatgpt-selection-message-id]')?.getAttribute('data-chatgpt-selection-message-id')
        || node?.closest?.('[data-chatgpt-search-message-ids]')?.getAttribute('data-chatgpt-search-message-ids')?.trim().split(/\s+/)[0]
        || (this.role(node) === 'user' ? node?.closest?.('[data-turn-key]')?.getAttribute('data-turn-key') : '')
        || '';
    },
    contentRoot(node) {
      if (!(node instanceof Element)) return null;
      return node.matches(this.content) ? node
        : node.querySelector(`${this.content}:not([data-markdown-text-tone="tertiary"]):not([data-markdown-text-tone="tertiary"] *)`)
          || node.querySelector(`${this.content}, [data-message-content], .whitespace-pre-wrap`) || node;
    },
    messageText(node) {
      const source = this.contentRoot(node);
      if (!source) return '';
      return Array.from(source.childNodes, (child) => child instanceof Element
        && child.matches('[data-cgpt-token-chip], .cgpt-unified-copy-message-md')
        ? '' : child.textContent || '').join('');
    },
    main() {
      return runtime.pageWork.memo(document, 'main', () => {
      const surfaces = [...document.querySelectorAll('main, [role="main"]')];
      const visible = surfaces.filter((node) => !node.closest('[hidden], [inert], [aria-hidden="true"]')
        && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
      return visible.find((node) => node.querySelector('#prompt-textarea, [data-chatgpt-composer]'))
        || visible.find((node) => node.querySelector(this.message)) || visible[0] || null;
      });
    },
    messages(root = this.main()) {
      if (!root) return [];
      return runtime.pageWork.memo(root, 'messages', () => {
      const nodes = [...(root.matches?.(this.message) ? [root] : []), ...root.querySelectorAll(this.message)];
      return nodes.filter((node) => ['user', 'assistant'].includes(this.role(node))
        && !node.parentElement?.closest(this.message));
      }).slice();
    },
    scrollBounds(element) {
      const extent = Math.max(0, element.scrollHeight - element.clientHeight);
      return getComputedStyle(element).flexDirection === 'column-reverse'
        ? { min: -extent, max: 0 } : { min: 0, max: extent };
    },
    clampScrollTop(element, value) {
      const { min, max } = this.scrollBounds(element);
      return Math.min(max, Math.max(min, value));
    },
  });
  runtime.topBarFix?.destroy?.();
  runtime.topBarFix = (() => {
    const style = document.createElement('style'); style.id = 'cgpt-topbar-gap-fix';
    style.textContent = `html[data-cgfc-topbar-overlap] [data-cgpt-topbar-frame]{margin-top:0!important}
      html[data-cgfc-topbar-overlap] [data-cgpt-topbar-scroll]{padding-top:calc(var(--thread-content-top-inset,32px) + var(--cgpt-topbar-height,52px))!important}
      html[data-cgfc-topbar-overlap] [data-cgpt-topbar-strip]{background:transparent!important;background-image:none!important;box-shadow:none!important}`;
    (document.head || document.documentElement).appendChild(style);
    let frame = 0, activeFrame = null, activeScroll = null, watchedHeader = null, headerObserver = null;
    let strips = new Set();
    function refresh() {
      if (frame) return;
      frame = runtime.pageWork.requestLayout(() => {
        frame = 0;
        const enabled = document.documentElement.hasAttribute('data-cgfc-topbar-overlap');
        const target = document.querySelector('main [class*="MainContentViewport-"] > [class*="MainContentFrame-"]');
        const scroll = target?.querySelector('.thread-scroll-container');
        const header = document.querySelector('header[class*="fixed"]');
        if (header !== watchedHeader) {
          headerObserver?.disconnect(); watchedHeader = header;
          headerObserver = header ? runtime.pageWork.observe(header, { childList: true, subtree: true }, refresh) : null;
        }
        const headerRect = header?.getBoundingClientRect(), height = headerRect?.height || 0;
        const eligible = enabled && target && scroll && height >= 24 && height <= 120 && (target === activeFrame || parseFloat(getComputedStyle(target).marginTop) >= 24);
        // Native toolbar gives its breadcrumb wrapper flex:1 and bg-surface.
        // Only clear that wide, growing wrapper; compact action surfaces stay.
        const nextStrips = new Set(enabled && header ? [...header.querySelectorAll('div[class~="bg-surface"],div[class~="browser:bg-surface"]')].filter(node => {
          const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
          return node.querySelector('nav') && css.visibility !== 'hidden' && parseFloat(css.flexGrow) > 0
            && rect.width >= Math.max(240, headerRect.width * .35) && rect.height >= 16 && rect.height <= height;
        }) : []);
        return () => {
          for (const node of strips) if (!nextStrips.has(node)) node.removeAttribute('data-cgpt-topbar-strip');
          for (const node of nextStrips) if (!node.hasAttribute('data-cgpt-topbar-strip')) node.setAttribute('data-cgpt-topbar-strip', '');
          strips = nextStrips;
          if (activeFrame && (!eligible || activeFrame !== target)) { activeFrame.removeAttribute('data-cgpt-topbar-frame'); activeScroll?.removeAttribute('data-cgpt-topbar-scroll'); activeScroll?.style.removeProperty('--cgpt-topbar-height'); activeFrame = activeScroll = null; }
          if (eligible) {
            activeFrame = target; activeScroll = scroll;
            if (!target.hasAttribute('data-cgpt-topbar-frame')) target.setAttribute('data-cgpt-topbar-frame', '');
            if (!scroll.hasAttribute('data-cgpt-topbar-scroll')) scroll.setAttribute('data-cgpt-topbar-scroll', '');
            if (scroll.style.getPropertyValue('--cgpt-topbar-height') !== height + 'px') scroll.style.setProperty('--cgpt-topbar-height', height + 'px');
          }
        };
      }, -10);
    }
    window.addEventListener('resize', refresh, { passive: true });
    return { refresh, destroy() { runtime.pageWork.cancelFrame(frame); headerObserver?.disconnect(); window.removeEventListener('resize', refresh); for (const node of strips) node.removeAttribute('data-cgpt-topbar-strip'); activeFrame?.removeAttribute('data-cgpt-topbar-frame'); activeScroll?.removeAttribute('data-cgpt-topbar-scroll'); activeScroll?.style.removeProperty('--cgpt-topbar-height'); style.remove(); } };
  })();


  runtime.lazy = runtime.lazy || null;
  // A disappearing stop button is only a pause, not proof that the final answer
  // finished. Thinking summaries can have their own copy button and markdown.
  // Busy-only consumers share a short-lived view of the latest turn. Queue
  // completion/signature reads below remain fresh and retain all safeguards.
  runtime.generation?.destroy?.();
  runtime.generation = (() => {
    let main = null, href = '', scope = null, scopeDirty = true, dirty = true;
    let cached = { busy: false }, readAt = -Infinity, reading = false, mainObserver = null;
    let reads = 0, hits = 0, mainSelections = 0, scopeSelections = 0;
    const visible = node => {
      if (!(node instanceof HTMLElement) || !node.isConnected) return false;
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const statusSelector = '[aria-busy="true"], [data-is-streaming="true"], [data-is-generating="true"], [role="status"], [aria-live], button, [data-testid*="thinking"], [data-testid*="reasoning"]';
    const stateSelector = '[aria-busy="true"], [data-is-streaming="true"], [data-is-generating="true"]';
    const activeLabel = /^(?:正在思考|思考中|正在搜索|搜索中|正在研究|正在处理|正在生成|正在回答|Thinking|Reasoning|Searching|Working|Generating)(?:\s*[.…]*)$/i;
    const stopLabel = /^(?:stop(?: (?:generating|streaming|response))?|停止(?:生成|回答|流式传输|输出)?|中止生成)$/i;
    function invalidateMain() { main = scope = null; scopeDirty = dirty = true; }
    let lifecycle = null;
    function bindLifecycle() {
      if (lifecycle || !document.documentElement) return;
      lifecycle = runtime.pageWork.observe(document.documentElement, { childList: true, subtree: true }, records => {
      for (const record of records) {
        if (main && !main.isConnected) { invalidateMain(); return; }
        if (record.type === 'childList' && (!main || !main.contains(record.target)) && [...record.addedNodes, ...record.removedNodes].some(node =>
          node instanceof Element && (node.matches('main,[role="main"]') || node.querySelector('main,[role="main"]')))) { invalidateMain(); return; }
      }
      });
    }
    function getMain() {
      if (href !== location.href || !main?.isConnected) {
        mainObserver?.disconnect(); mainObserver = null;
        runtime.pageWork.invalidate(); main = dom.main(); href = location.href; mainSelections++;
        scope = null; scopeDirty = dirty = true;
        if (main) mainObserver = runtime.pageWork.observe(main, { childList: true, characterData: true, subtree: true, attributes: true,
          attributeFilter: ['aria-label', 'data-testid', 'data-turn-key', 'data-message-author-role', 'data-markdown-text-style', 'disabled', 'class', 'hidden', 'aria-hidden', 'aria-busy', 'data-is-streaming', 'data-is-generating'] }, records => {
          dirty = true;
          const selector = dom.turn + ',' + dom.message;
          for (const record of records) if ((record.type === 'attributes' && ['data-testid', 'data-turn-key', 'data-message-author-role', 'data-markdown-text-style'].includes(record.attributeName) && record.target.matches(selector))
            || (record.type === 'childList' && (!scope?.isConnected || [...record.addedNodes, ...record.removedNodes].some(node =>
              node instanceof Element && (node.matches(selector) || node.querySelector(selector)))))) { scopeDirty = true; break; }
        });
      }
      return main;
    }
    function latestScope() {
      if (!scopeDirty && scope?.isConnected) return scope;
      scopeSelections++; scopeDirty = false;
      const turns = main.querySelectorAll(dom.turn);
      scope = turns[turns.length - 1] || null;
      if (scope) {
        for (let parent = scope.parentElement; parent && parent !== main; parent = parent.parentElement) if (parent.matches(dom.turn)) scope = parent;
      } else {
        const messages = main.querySelectorAll(dom.message), last = messages[messages.length - 1];
        scope = last?.closest('[data-message-id]') || last?.parentElement || main;
      }
      return scope;
    }
    function compute() {
      if ([...document.querySelectorAll('[data-testid="stop-button"], [data-testid="composer-stop-button"], [data-testid*="stop-generating"]')].some(visible)) return { busy: true };
      if (!main) return { busy: false };
      const editor = main.querySelector('#prompt-textarea, textarea[name="prompt-textarea"], .ProseMirror[contenteditable="true"], [contenteditable="true"][role="textbox"]');
      const shell = editor?.closest('form, [data-chatgpt-composer], [data-testid*="composer"]');
      if ([...shell?.querySelectorAll('button,[role="button"]') || []].some(button => stopLabel.test((button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '').trim()) && visible(button))) return { busy: true };
      const latest = latestScope();
      return { busy: Boolean(latest && ((latest.matches(stateSelector) && visible(latest)) || [...latest.querySelectorAll(statusSelector)].some(node => (
        node.matches(stateSelector) || (!node.matches('button,[role="button"],summary,[data-state="closed"],[data-state="open"]')
          && activeLabel.test((node.getAttribute('aria-label') || node.textContent || '').trim()))
      ) && visible(node)))) };
    }
    function read() {
      if (reading) { if (!main?.isConnected) return cached; scopeDirty = true; return compute(); }
      reading = true;
      try {
        bindLifecycle(); lifecycle?.flush?.(); getMain(); mainObserver?.flush?.();
        const now = performance.now();
        if (!dirty && now - readAt < 250) { hits++; return cached; }
        // Validate the cached surface at the normal read cadence. Observing all
        // document style attributes would also receive every glass pointer move.
        if (main && !visible(main)) { invalidateMain(); getMain(); }
        reads++; cached = compute(); dirty = false; readAt = now; return cached;
      } finally { reading = false; }
    }
    function routeChanged() { invalidateMain(); }
    window.addEventListener('popstate', routeChanged); window.navigation?.addEventListener('navigatesuccess', routeChanged);
    return { read, invalidate: () => { dirty = true; }, getState: () => ({ busy: cached.busy, reads, hits, mainSelections, scopeSelections }),
      destroy() { lifecycle?.disconnect(); mainObserver?.disconnect(); window.removeEventListener('popstate', routeChanged); window.navigation?.removeEventListener('navigatesuccess', routeChanged); } };
  })();

  runtime.readQueueResponseState = (options = {}) => {
    if (options.busyOnly) return runtime.generation.read();
    const main = dom.main();
    const visible = (node) => {
      if (!(node instanceof HTMLElement) || !node.isConnected) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden'
        && rect.width > 0 && rect.height > 0;
    };
    const stopSelector = '[data-testid="stop-button"], [data-testid="composer-stop-button"], [data-testid*="stop-generating"]';
    const editorSelector = '#prompt-textarea, textarea[name="prompt-textarea"], .ProseMirror[contenteditable="true"], [contenteditable="true"][role="textbox"]';
    const composer = main?.querySelector(editorSelector) || document.querySelector(editorSelector);
    const composerShell = composer?.closest('form, [data-chatgpt-composer], [data-testid*="composer"]');
    const stopLabel = /^(?:stop(?: (?:generating|streaming|response))?|停止(?:生成|回答|流式传输|输出)?|中止生成)$/i;
    let busy = Array.from(document.querySelectorAll(stopSelector)).some(visible)
      || Array.from(composerShell?.querySelectorAll('button, [role="button"]') || []).some((button) =>
        stopLabel.test((button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '').trim()) && visible(button));
    if (options.busyOnly && busy) return { busy: true };
    if (!main) return { busy, complete: false, signature: 'no-main', hasUser: false };
    const users = Array.from(main.querySelectorAll(dom.user));
    const user = users[users.length - 1];
    const after = (left, right) => Boolean(left && right && (left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING));
    const assistants = Array.from(main.querySelectorAll(dom.assistant)).filter((node) => !user || after(user, node));
    const latest = assistants[assistants.length - 1];
    // Action bars can be siblings of a nested data-turn-key wrapper. Stay in
    // the current response, but include its outer turn instead of that wrapper.
    const responseTurn = (node) => {
      let scope = node?.closest(dom.turn) || node?.closest('[data-message-id]') || node?.parentElement;
      for (let parent = scope?.parentElement; parent && parent !== main; parent = parent.parentElement) {
        if (parent.querySelectorAll(dom.user).length > (user && parent.contains(user) ? 1 : 0)) break;
        if (parent.matches(dom.turn)) scope = parent;
      }
      return scope;
    };
    const scope = responseTurn(latest) || user?.closest(dom.turn) || (() => { const turns = main.querySelectorAll(dom.turn); return turns[turns.length - 1]; })() || main;
    const overviewSelector = '[data-markdown-text-style="assistant-message"][data-markdown-text-tone="tertiary"]';
    const activeLabel = /^(?:正在思考|思考中|正在搜索|搜索中|正在研究|正在处理|正在生成|正在回答|Thinking|Reasoning|Searching|Working|Generating)(?:\s*[.…]*)$/i;
    const activeNodes = scope.querySelectorAll('[aria-busy="true"], [data-is-streaming="true"], [data-is-generating="true"], [role="status"], [aria-live], button, [data-testid*="thinking"], [data-testid*="reasoning"]');
    busy ||= (scope.matches('[aria-busy="true"], [data-is-streaming="true"], [data-is-generating="true"]') && visible(scope))
      || Array.from(activeNodes).some((node) => (
        node.matches('[aria-busy="true"], [data-is-streaming="true"], [data-is-generating="true"]')
        // A retained Thinking disclosure is a history control after completion.
        || (!node.matches('button, [role="button"], summary, [data-state="closed"], [data-state="open"]')
          && activeLabel.test((node.getAttribute('aria-label') || node.textContent || '').trim()))
      ) && visible(node));
    if (options.busyOnly) return { busy };
    const bodies = assistants.filter((node) => !dom.isThinkingOverview(node)
      && !node.closest(overviewSelector)
      // Legacy role wrappers can contain only a thinking overview.
      && !(node.querySelector(overviewSelector) && !node.matches('[data-markdown-text-style="assistant-message"]')
        && !node.querySelector('.markdown:not([data-markdown-text-tone="tertiary"]), [data-markdown-text-style="assistant-message"]:not([data-markdown-text-tone="tertiary"])')));
    const body = bodies[bodies.length - 1];
    const text = dom.messageText(body).trim();
    // Completion actions belong to the current final body. They may be hidden
    // until hover or outside a nested message wrapper; layout is not required.
    // Copy alone is still insufficient: reasoning/interim content can have it.
    const content = dom.contentRoot(body);
    const responseScope = responseTurn(body);
    const feedback = Array.from(responseScope?.querySelectorAll('button, [role="button"]') || []).filter((button) =>
      button.isConnected && !button.closest(`${overviewSelector}, details, [data-testid*="thinking"], [data-testid*="reasoning"], pre, code`)
      && (!content?.contains(button) || (content === body && !body.matches(dom.content)))
      && after(content, button));
    const hasFeedback = feedback.some((button) => {
      const testId = button.getAttribute('data-testid') || '';
      const label = (button.getAttribute('aria-label') || button.getAttribute('title') || '').trim();
      return /^(?:(?:good-response|bad-response)(?:-turn-action-button)?|thumbs-up-button|thumbs-down-button)$/.test(testId)
        || /^(?:Good response|Bad response|Like response|Dislike response|Rate (?:this )?response|评价回复|评价回答|回答不错|回答不好|好的回答|不好的回答|好的回复|不好的回复|好评|差评|喜欢|不喜欢|赞|踩)$/i.test(label)
        || /^(?:read-aloud|regenerate|retry|share)(?:-response)?(?:-turn-action)?-button$/.test(testId)
        || /^(?:Read aloud|Regenerate(?: response)?|Try again|Retry|Share(?: response)?|朗读|大声朗读|重新生成(?:回答|回复)?|重试|再试一次|分享(?:回答|回复)?)$/i.test(label);
    });
    const hasUser = Boolean(user);
    const empty = !hasUser && !assistants.length && !/\/c\//.test(location.pathname);
    const complete = !busy && (empty || Boolean(text && hasFeedback));
    const identity = dom.messageId(user) || user?.closest(dom.turn)?.getAttribute('data-turn-key') || '';
    // Historical message parking must not restart the completion quiet window.
    const responseId = dom.messageId(body) || body?.closest(dom.turn)?.getAttribute('data-turn-key') || '';
    return { busy, complete, hasUser, signature: `${identity}:${responseId}:${text.length}:${text.slice(-400)}:${hasFeedback}` };
  };
  runtime.navigationLeaseTimer = 0;
  runtime.beginNavigationLease = (duration = 3200) => {
    const root = document.documentElement;
    if (!root) return;
    root.setAttribute(NAV_ATTR, '1');
    clearTimeout(runtime.navigationLeaseTimer);
    runtime.navigationLeaseTimer = setTimeout(() => {
      document.documentElement?.removeAttribute(NAV_ATTR);
      runtime.navigationLeaseTimer = 0;
    }, Math.max(500, Number(duration) || 3200));
  };
  runtime.isNavigationLeaseActive = () =>
    document.documentElement?.hasAttribute(NAV_ATTR) === true;

  const normalizeText = (value) => String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const safeFilename = (value) => String(value || 'ChatGPT 会话')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || 'ChatGPT 会话';

  function escapeMarkdown(value) {
    return String(value ?? '').replace(/([\\`*_{}\[\]<>])/g, '\\$1');
  }

  function nodeToMarkdown(node, depth = 0) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (!(node instanceof Element)) return '';
    if (node.matches('button, script, style, svg, [aria-hidden="true"], [role="button"], [role="tooltip"], [data-cgpt-token-chip], .cgpt-unified-copy-message-md')) return '';

    const tag = node.tagName.toLowerCase();
    const children = () => Array.from(node.childNodes).map((child) => nodeToMarkdown(child, depth)).join('');
    const text = () => normalizeText(children());

    if (node.matches('.katex, math, [data-latex], [data-math-source]')) {
      const latex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()
        || node.getAttribute('data-latex')
        || node.getAttribute('data-math-source');
      const isBlock = node.matches('.katex-display, .math-block, math[display="block"], [data-math-display="true"]')
        || Boolean(node.closest('.katex-display, .math-block, [data-math-display="true"]'));
      if (latex) return isBlock ? `\n$$\n${latex}\n$$\n\n` : `$${latex}$`;
    }
    if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${text()}\n\n`;
    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n---\n\n';
    if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      return src ? `![${escapeMarkdown(node.getAttribute('alt') || '图片')}](${src})` : '';
    }
    if (tag === 'strong' || tag === 'b' || node.matches('[data-d-component="text"][data-d-default-strong], [data-d-component="text"][data-d-weight="bold"]')) return `**${text()}**`;
    if (tag === 'em' || tag === 'i') return `*${text()}*`;
    if ((tag === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre')
      || node.matches('[data-markdown-copy="inline-code"]')) {
      const value = node.textContent || '';
      const runs = value.match(/`+/g) || [];
      const fence = '`'.repeat(Math.max(0, ...runs.map((run) => run.length)) + 1);
      const pad = /^`|`$/.test(value) || (/^ .* $/.test(value) && value.trim()) ? ' ' : '';
      return `${fence}${pad}${value}${pad}${fence}`;
    }
    if (tag === 'pre') {
      const code = node.querySelector('code')?.textContent ?? node.textContent ?? '';
      const language = node.querySelector('code')?.className.match(/language-([\w+-]+)/)?.[1] || '';
      const runs = code.match(/`+/g) || [];
      const fence = '`'.repeat(Math.max(2, ...runs.map((run) => run.length)) + 1);
      return `\n${fence}${language}\n${code.replace(/\n+$/, '')}\n${fence}\n\n`;
    }
    if (tag === 'a') return `[${text() || node.getAttribute('href') || '链接'}](${node.getAttribute('href') || ''})`;
    if (tag === 'blockquote') return `${text().split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
    if (tag === 'li') {
      const parentTag = node.parentElement?.tagName.toLowerCase();
      const start = Number.parseInt(node.parentElement?.getAttribute('start'), 10);
      const siblings = Array.from(node.parentElement?.children || []).filter((child) => child.tagName.toLowerCase() === 'li');
      const step = node.parentElement?.hasAttribute('reversed') ? -1 : 1;
      let ordinal = Number.isFinite(start) ? start : step < 0 ? siblings.length : 1;
      for (const sibling of siblings) {
        const value = Number.parseInt(sibling.getAttribute('value'), 10);
        if (Number.isFinite(value)) ordinal = value;
        if (sibling === node) break;
        ordinal += step;
      }
      const prefix = parentTag === 'ol'
        ? `${ordinal}. `
        : '- ';
      return `${'  '.repeat(Math.max(0, depth))}${prefix}${text()}\n`;
    }
    if (tag === 'ul' || tag === 'ol') {
      return `${Array.from(node.children).map((child) => nodeToMarkdown(child, depth + 1)).join('')}\n`;
    }
    if (tag === 'table') {
      const rows = Array.from(node.querySelectorAll('tr')).map((row) =>
        Array.from(row.querySelectorAll(':scope > th, :scope > td')).map((cell) =>
          normalizeText(nodeToMarkdown(cell, depth)).replace(/\|/g, '\\|').replace(/\n+/g, '<br>'))
      ).filter((row) => row.length);
      if (!rows.length) return '';
      const width = Math.max(...rows.map((row) => row.length));
      const normalizedRows = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')]);
      const lines = [
        `| ${normalizedRows[0].join(' | ')} |`,
        `| ${Array(width).fill('---').join(' | ')} |`,
        ...normalizedRows.slice(1).map((row) => `| ${row.join(' | ')} |`),
      ];
      return `${lines.join('\n')}\n\n`;
    }
    if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') {
      const value = children();
      return value.trim() ? `${value.trim()}\n\n` : '';
    }
    return children();
  }

  const apiAccessSessions = new WeakMap();
  class SessionExporter {
    constructor() {
      this.apiFailureLoggedFor = '';
      this.apiFailures = new Map(); this.apiLastSuccess = new Map();
      this.apiDisposed = false; this.apiDeferredRefresh = null; this.apiInteractiveAttemptAt = -Infinity;
      this.onApiAvailability = () => this.armApiRefresh();
      document.addEventListener('visibilitychange', this.onApiAvailability);
      window.addEventListener('online', this.onApiAvailability);
      apiAccessSessions.set(this, { token: '', expiresAt: 0, promise: null, failures: 0, retryAt: 0, status: 0 });
      // 会话树仅在内存中；登录令牌只在私有 WeakMap 短时复用，不写入存储或诊断。
      // 导出与完整问答目录共用这一份缓存，避免重复请求同一会话。
      this.apiTreeCache = {
        conversationId: '',
        tree: null,
        fetchedAt: 0,
        promise: null,
      };
      this.apiOutlineCache = {
        conversationId: '',
        currentNode: '',
        items: [],
      };
      this.apiTreeDefaultMaxAgeMs = 8000;
    }

    getConversationId() {
      const match = location.pathname.match(/\/c\/([0-9a-f-]{20,})/i);
      return match?.[1] || '';
    }

    getPageFetch() {
      try {
        if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.fetch === 'function') {
          return unsafeWindow.fetch.bind(unsafeWindow);
        }
      } catch {}
      return window.fetch.bind(window);
    }

    getDomTitle() {
      return normalizeText(document.title.replace(/\s*[|·-]\s*ChatGPT.*$/i, '')) || 'ChatGPT 会话';
    }

    normalizeMessageBody(value) {
      return String(value ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .trim();
    }

    getTurnOrder(turn, fallbackIndex = 0) {
      const testId = turn?.getAttribute?.('data-testid') || '';
      const match = /conversation-turn-(\d+)/i.exec(testId);
      if (match) return Number.parseInt(match[1], 10);
      const dataTurn = turn?.getAttribute?.('data-turn') || turn?.getAttribute?.('data-turn-id') || '';
      const numeric = Number.parseInt(dataTurn, 10);
      return Number.isFinite(numeric) ? numeric : 1_000_000_000 + fallbackIndex;
    }

    getTurnNodes() {
      const bridged = runtime.lazy?.getAllTurnNodes?.();
      const turns = Array.isArray(bridged) && bridged.length
        ? bridged
        : Array.from(document.querySelectorAll(`main ${dom.turn}`));
      const seen = new Set();
      return turns
        .filter((turn) => turn instanceof Element && !seen.has(turn) && seen.add(turn))
        .map((turn, index) => ({ turn, order: this.getTurnOrder(turn, index), index }))
        .sort((a, b) => a.order - b.order || a.index - b.index)
        .map((entry) => entry.turn);
    }

    extractContent(roleNode) {
      const source = dom.contentRoot(roleNode);
      const markdown = normalizeText(nodeToMarkdown(source));
      return markdown || normalizeText(source.textContent);
    }

    collectDom() {
      const messages = [];
      const seen = new Set();
      for (const turn of this.getTurnNodes()) {
        const roleNodes = dom.messages(turn);
        for (const roleNode of roleNodes) {
          const role = dom.role(roleNode);
          if (role !== 'user' && role !== 'assistant') continue;
          if (dom.isThinkingOverview(roleNode) || dom.isThinkingOverview(dom.contentRoot(roleNode))
            || roleNode.closest('[data-markdown-text-tone="tertiary"]')) continue;
          const messageId = dom.messageId(roleNode)
            || `${turn.getAttribute('data-testid') || messages.length}:${role}`;
          if (seen.has(messageId)) continue;
          const content = this.extractContent(roleNode);
          if (!content) continue;
          seen.add(messageId);
          messages.push({ index: messages.length, id: messageId, role, content });
        }
      }
      return {
        schema: 'cgpt-unified-session-export/v1',
        source: 'dom',
        title: this.getDomTitle(),
        url: location.href,
        exportedAt: new Date().toISOString(),
        messages,
      };
    }

    getAttachmentNames(message) {
      const metadata = message?.metadata || {};
      const candidates = [
        ...(Array.isArray(metadata.attachments) ? metadata.attachments : []),
        ...(Array.isArray(metadata.files) ? metadata.files : []),
      ];
      const names = [];
      const seen = new Set();
      for (const item of candidates) {
        const name = String(
          item?.name || item?.file_name || item?.filename || item?.title || ''
        ).trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        names.push(name);
      }
      return names;
    }

    extractApiPart(part) {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';

      const kind = String(part.content_type || part.type || '').toLowerCase();
      if (/image|audio|video|asset_pointer|file/.test(kind) || part.asset_pointer) return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      if (typeof part.caption === 'string') return part.caption;
      if (Array.isArray(part.parts)) return part.parts.map((item) => this.extractApiPart(item)).filter(Boolean).join('\n');
      return '';
    }

    extractApiContent(message) {
      const content = message?.content || {};
      const type = String(content.content_type || '').toLowerCase();
      const hiddenTypes = new Set([
        'thoughts',
        'reasoning',
        'reasoning_recap',
        'model_editable_context',
        'user_editable_context',
        'system_content',
      ]);
      if (hiddenTypes.has(type)) return '';

      let body = '';
      if (Array.isArray(content.parts)) {
        body = content.parts.map((part) => this.extractApiPart(part)).filter(Boolean).join('\n\n');
      } else if (typeof content.text === 'string') {
        body = content.text;
      } else if (typeof content.result === 'string') {
        body = content.result;
      }

      if (type === 'code' && body.trim()) {
        const language = String(content.language || message?.metadata?.language || '').trim();
        body = `\`\`\`${language}\n${body.replace(/\n+$/, '')}\n\`\`\``;
      }

      const attachments = this.getAttachmentNames(message);
      if (attachments.length) {
        const marker = `> [附件：${attachments.join('、')}]`;
        body = body.trim() ? `${marker}\n\n${body}` : marker;
      }

      return this.normalizeMessageBody(body);
    }

    isApiMessageVisible(message) {
      if (!message || typeof message !== 'object') return false;
      const role = message.author?.role;
      if (role !== 'user' && role !== 'assistant') return false;

      const metadata = message.metadata || {};
      if (
        metadata.is_visually_hidden_from_conversation === true
        || metadata.is_hidden === true
        || metadata.hidden === true
        || String(metadata.channel || '').toLowerCase() === 'analysis'
      ) return false;

      const recipient = String(message.recipient || 'all');
      if (role === 'assistant' && recipient && !['all', 'assistant'].includes(recipient)) return false;
      return true;
    }

    linearizeActiveBranch(tree) {
      const mapping = tree?.mapping;
      let currentId = tree?.current_node;
      if (!mapping || typeof mapping !== 'object' || !currentId || !mapping[currentId]) return [];

      const chain = [];
      const seen = new Set();
      while (currentId && mapping[currentId] && !seen.has(currentId)) {
        seen.add(currentId);
        const node = mapping[currentId];
        chain.push(node);
        currentId = node?.parent || '';
      }
      chain.reverse();
      return chain;
    }

    messagesFromApiTree(tree) {
      const messages = [];
      for (const node of this.linearizeActiveBranch(tree)) {
        const message = node?.message;
        if (!this.isApiMessageVisible(message)) continue;
        const content = this.extractApiContent(message);
        if (!content) continue;
        const role = message.author.role;
        const id = String(message.id || node.id || `api-${messages.length}`);

        // Tool-assisted answers can contain several adjacent visible assistant
        // fragments. Merge them so the export matches the single response shown
        // in the UI instead of creating artificial extra turns.
        const previous = messages[messages.length - 1];
        if (previous?.role === role && role === 'assistant') {
          previous.content = this.normalizeMessageBody(`${previous.content}\n\n${content}`);
          previous.sourceIds = [...(previous.sourceIds || [previous.id]), id];
          continue;
        }

        messages.push({
          index: messages.length,
          id,
          role,
          content,
          ...(Number.isFinite(Number(message.create_time)) ? { createTime: Number(message.create_time) } : {}),
        });
      }
      messages.forEach((message, index) => { message.index = index; });
      return messages;
    }

    invalidateApiTreeCache(conversationId = '') {
      const currentId = this.getConversationId();
      if (conversationId && currentId && conversationId !== currentId) return;
      this.apiTreeCache = { conversationId: currentId, tree: null, fetchedAt: 0, promise: null };
      this.apiOutlineCache = { conversationId: currentId, currentNode: '', items: [] };
    }

    buildConversationOutline(tree) {
      const items = [];
      for (const node of this.linearizeActiveBranch(tree)) {
        const message = node?.message;
        if (!this.isApiMessageVisible(message) || message.author?.role !== 'user') continue;
        const fullLabel = this.extractApiContent(message);
        if (!fullLabel) continue;
        const messageId = String(message.id || node.id || `api-user-${items.length}`);
        items.push({
          logicalIndex: items.length,
          messageId,
          nodeId: String(node.id || ''),
          fullLabel,
          ...(Number.isFinite(Number(message.create_time)) ? { createTime: Number(message.create_time) } : {}),
        });
      }
      return items;
    }

    getCachedConversationOutlineSync() {
      const conversationId = this.getConversationId();
      const cache = this.apiTreeCache;
      if (!conversationId || cache.conversationId !== conversationId || !cache.tree) return null;
      const currentNode = String(cache.tree.current_node || '');
      if (
        this.apiOutlineCache.conversationId !== conversationId
        || this.apiOutlineCache.currentNode !== currentNode
      ) {
        this.apiOutlineCache = {
          conversationId,
          currentNode,
          items: this.buildConversationOutline(cache.tree),
        };
      }
      return {
        conversationId,
        currentNode,
        title: this.normalizeMessageBody(cache.tree.title) || this.getDomTitle(),
        items: this.apiOutlineCache.items,
        fetchedAt: cache.fetchedAt,
      };
    }

    getApiState() {
      const id = this.getConversationId(), state = this.apiFailures.get(id), access = apiAccessSessions.get(this);
      const retryAt = Math.max(state?.retryAt || 0, access?.retryAt || 0);
      const pending = this.apiDeferredRefresh?.conversationId === id ? this.apiDeferredRefresh : null;
      return { source: this.apiTreeCache.conversationId === id && this.apiTreeCache.tree ? 'api' : 'dom',
        state: navigator.onLine === false ? 'offline' : Date.now() < retryAt ? 'cooldown' : document.hidden ? 'paused' : pending ? 'pending' : 'ready',
        retryAt, pending: Boolean(pending), nextRefreshAt: pending?.nextAt || 0,
        failures: state?.failures || 0, status: state?.status || access?.status || 0 };
    }

    clearDeferredApiRefresh() {
      if (this.apiDeferredRefresh) window.clearTimeout(this.apiDeferredRefresh.timer);
      this.apiDeferredRefresh = null;
    }

    queueApiRefresh(conversationId, options = {}) {
      if (this.apiDisposed || this.getConversationId() !== conversationId) return;
      let pending = this.apiDeferredRefresh;
      if (pending?.conversationId !== conversationId) {
        this.clearDeferredApiRefresh();
        pending = this.apiDeferredRefresh = { conversationId, timer: 0, nextAt: 0, after: 0, reason: 'background', waiting: false };
      }
      pending.after = Math.max(pending.after, Number(options.after) || Date.now());
      if (options.refreshReason === 'generation-end') pending.reason = 'generation-end';
      this.armApiRefresh();
    }

    armApiRefresh() {
      const pending = this.apiDeferredRefresh;
      if (!pending || this.apiDisposed) return;
      if (pending.conversationId !== this.getConversationId()) { this.clearDeferredApiRefresh(); return; }
      if (document.hidden || navigator.onLine === false) {
        window.clearTimeout(pending.timer); pending.timer = 0; return;
      }
      const cache = this.apiTreeCache;
      if (cache.conversationId === pending.conversationId && cache.promise) {
        window.clearTimeout(pending.timer); pending.timer = 0;
        if (!pending.waiting) {
          pending.waiting = true;
          cache.promise.catch(() => {}).then(() => {
            pending.waiting = false;
            if (this.apiDeferredRefresh === pending) this.armApiRefresh();
          });
        }
        return;
      }
      const access = apiAccessSessions.get(this);
      const interval = pending.reason === 'generation-end' ? 2000 : 10000;
      const due = Math.max(Date.now(), pending.after,
        (this.apiLastSuccess.get(pending.conversationId) ?? -Infinity) + interval,
        this.apiFailures.get(pending.conversationId)?.retryAt || 0, access.retryAt);
      if (pending.timer && pending.nextAt === due) return;
      window.clearTimeout(pending.timer); pending.nextAt = due;
      pending.timer = window.setTimeout(async () => {
        pending.timer = 0;
        if (this.apiDeferredRefresh !== pending || this.apiDisposed) return;
        if (document.hidden || navigator.onLine === false) return;
        if (this.getConversationId() !== pending.conversationId) { this.clearDeferredApiRefresh(); return; }
        this.apiDeferredRefresh = null;
        try { await this.fetchConversationTree({ force: true, after: pending.after, refreshReason: pending.reason }); }
        catch { this.queueApiRefresh(pending.conversationId, { after: pending.after, refreshReason: pending.reason }); }
      }, Math.max(0, due - Date.now()));
    }

    destroy() {
      this.apiDisposed = true; this.clearDeferredApiRefresh();
      document.removeEventListener('visibilitychange', this.onApiAvailability);
      window.removeEventListener('online', this.onApiAvailability);
    }

    apiHttpError(response, label) {
      const error = new Error(`${label}（HTTP ${response.status}）`);
      error.status = response.status;
      const value = response.headers?.get?.('Retry-After'), seconds = value == null ? NaN : Number(value);
      const retryAt = Number.isFinite(seconds) ? Date.now() + Math.max(0, seconds) * 1000 : Date.parse(value);
      error.retryAt = Number.isFinite(retryAt) ? Math.min(Date.now() + 3600000, retryAt) : 0;
      return error;
    }

    apiFailureDelay(failures, error) {
      const base = Math.min(600000, 5000 * 2 ** Math.min(7, Math.max(0, failures - 1)));
      return Math.max(base, error?.status === 403 ? 300000 : [401, 429].includes(error?.status) ? 60000 : 0,
        Math.max(0, (error?.retryAt || 0) - Date.now()));
    }

    async getApiAccessToken(pageFetch, signal, bypassCooldown = false) {
      const access = apiAccessSessions.get(this), now = Date.now();
      if (!bypassCooldown && now < access.retryAt) throw Object.assign(new Error('登录会话请求冷却中'), { status: access.status, retryAt: access.retryAt });
      if (access.token && now < access.expiresAt) return access.token;
      if (access.promise) return access.promise;
      access.promise = (async () => {
        try {
          const response = await pageFetch('/api/auth/session', { credentials: 'include', cache: 'no-store', signal, headers: { Accept: 'application/json' } });
          if (!response.ok) throw this.apiHttpError(response, '读取登录会话失败');
          const session = await response.json();
          if (!session?.accessToken) throw Object.assign(new Error('当前登录会话没有可用 accessToken'), { status: 401 });
          const expires = Date.parse(session.expires);
          access.token = session.accessToken;
          access.expiresAt = Math.min(Date.now() + 300000, Number.isFinite(expires) ? expires - 30000 : Date.now() + 60000);
          access.failures = access.retryAt = access.status = 0;
          return access.token;
        } catch (error) {
          access.token = ''; access.expiresAt = 0; access.status = Number(error?.status) || 0;
          access.retryAt = Date.now() + this.apiFailureDelay(++access.failures, error);
          throw error;
        }
      })();
      try { return await access.promise; } finally { access.promise = null; }
    }

    async fetchConversationTree(options = {}) {
      const conversationId = this.getConversationId();
      if (!conversationId || this.apiDisposed) return null;
      const force = Boolean(options.force), interactive = options.interactive === true;
      const maxAgeMs = Math.max(0, Number(options.maxAgeMs ?? this.apiTreeDefaultMaxAgeMs) || 0);
      const cache = this.apiTreeCache, cached = cache.conversationId === conversationId && cache.tree, now = Date.now();
      const payload = () => ({ conversationId, tree: cache.tree, cached: true, requestedAt: cache.requestedAt || cache.fetchedAt,
        deferred: Boolean(this.apiDeferredRefresh?.conversationId === conversationId || cache.promise) });
      if (!force && cached && now - cache.fetchedAt <= maxAgeMs) return payload();
      if (cache.conversationId === conversationId && cache.promise) {
        if (force && !interactive) this.queueApiRefresh(conversationId, options);
        return cache.promise;
      }
      const state = this.apiFailures.get(conversationId), access = apiAccessSessions.get(this);
      const cooling = now < Math.max(state?.retryAt || 0, access.retryAt);
      // A user export may make one deliberate retry during cooldown. Repeated
      // clicks cannot turn it into an unbounded automatic retry loop.
      const manualRetry = interactive && cooling && now - this.apiInteractiveAttemptAt >= 30000;
      const interval = options.refreshReason === 'generation-end' ? 2000 : 10000;
      const deferred = navigator.onLine === false || (!interactive && document.hidden)
        || (cooling && !manualRetry)
        || (!interactive && now - (this.apiLastSuccess.get(conversationId) ?? -Infinity) < interval);
      if (deferred) {
        if (force && !interactive) this.queueApiRefresh(conversationId, options);
        return !interactive && cached ? payload() : null;
      }
      if (manualRetry) this.apiInteractiveAttemptAt = now;
      const controller = new AbortController(), requestedAt = Date.now();
      const timeout = window.setTimeout(() => controller.abort(), 20000);
      const request = (async () => {
        const pageFetch = this.getPageFetch();
        let response;
        for (let attempt = 0; attempt < 2; attempt++) {
          const token = await this.getApiAccessToken(pageFetch, controller.signal, manualRetry);
          response = await pageFetch(`/backend-api/conversation/${encodeURIComponent(conversationId)}`, {
            method: 'GET', credentials: 'include', cache: 'no-store', signal: controller.signal,
            headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
          });
          if (response.status !== 401) break;
          access.token = ''; access.expiresAt = 0;
          if (attempt === 1) break;
        }
        if (!response.ok) throw this.apiHttpError(response, '读取完整会话失败');
        const tree = await response.json();
        if (!tree?.mapping || !tree?.current_node) throw new Error('完整会话接口返回的数据结构不完整');
        this.apiFailures.delete(conversationId);
        this.apiLastSuccess.delete(conversationId); this.apiLastSuccess.set(conversationId, Date.now());
        if (this.apiLastSuccess.size > 16) this.apiLastSuccess.delete(this.apiLastSuccess.keys().next().value);
        if (!this.apiDisposed && this.getConversationId() === conversationId && this.apiTreeCache.promise === request) {
          this.apiTreeCache = { conversationId, tree, requestedAt, fetchedAt: Date.now(), promise: null };
          this.apiOutlineCache = { conversationId, currentNode: '', items: [] };
          if (this.apiDeferredRefresh?.conversationId === conversationId && requestedAt >= this.apiDeferredRefresh.after) this.clearDeferredApiRefresh();
          try { runtime.tokenStats?.scheduleRefresh(false); } catch {}
          try { runtime.answerToc?.scheduleApiConversationOutlineRefresh(0, false); } catch {}
        }
        return { conversationId, tree, cached: false, requestedAt, deferred: this.apiDeferredRefresh?.conversationId === conversationId };
      })();
      this.apiTreeCache = { conversationId, tree: cached || null, requestedAt: cached ? cache.requestedAt : 0, fetchedAt: cached ? cache.fetchedAt : 0, promise: request };
      try { return await request; }
      catch (error) {
        const failures = (state?.failures || 0) + 1;
        this.apiFailures.delete(conversationId);
        this.apiFailures.set(conversationId, { failures, status: Number(error?.status) || 0, retryAt: Date.now() + this.apiFailureDelay(failures, error) });
        if (this.apiFailures.size > 16) this.apiFailures.delete(this.apiFailures.keys().next().value);
        if (force && !interactive) this.queueApiRefresh(conversationId, options);
        throw error;
      } finally {
        window.clearTimeout(timeout);
        if (this.apiTreeCache.conversationId === conversationId && this.apiTreeCache.promise === request) this.apiTreeCache.promise = null;
        this.armApiRefresh();
      }
    }

    async getConversationOutline(options = {}) {
      const payload = await this.fetchConversationTree(options);
      if (!payload) return null;
      const { conversationId, tree } = payload;
      const items = this.buildConversationOutline(tree);
      if (this.getConversationId() === conversationId && this.apiTreeCache.tree === tree) {
        this.apiOutlineCache = {
          conversationId,
          currentNode: String(tree.current_node || ''),
          items,
        };
      }
      return {
        conversationId,
        currentNode: String(tree.current_node || ''),
        title: this.normalizeMessageBody(tree.title) || this.getDomTitle(),
        items,
        fetchedAt: this.apiTreeCache.fetchedAt,
      };
    }

    getCachedActiveMessagesSync() {
      const conversationId = this.getConversationId();
      const cache = this.apiTreeCache;
      if (!conversationId || cache.conversationId !== conversationId || !cache.tree) return null;
      return {
        conversationId,
        currentNode: String(cache.tree.current_node || ''),
        fetchedAt: cache.fetchedAt,
        messages: this.getSnapshotMessages(cache.tree),
        requestedAt: cache.requestedAt || cache.fetchedAt,
        deferred: Boolean(cache.promise || this.apiDeferredRefresh?.conversationId === conversationId),
      };
    }

    getSnapshotMessages(tree) {
      // API trees are immutable fetch snapshots. Retain only the current derived
      // list, so streaming DOM refreshes do not parse every historical answer.
      if (this.activeMessagesTree !== tree) {
        this.activeMessagesTree = tree;
        this.activeMessagesSnapshot = this.messagesFromApiTree(tree);
      }
      return this.activeMessagesSnapshot;
    }

    async getActiveMessages(options = {}) {
      const payload = await this.fetchConversationTree(options);
      if (!payload) return null;
      const { conversationId, tree } = payload;
      return {
        conversationId,
        currentNode: String(tree.current_node || ''),
        fetchedAt: this.apiTreeCache.fetchedAt,
        messages: this.getSnapshotMessages(tree),
        requestedAt: payload.requestedAt, deferred: payload.deferred,
      };
    }

    async collectApi() {
      const originUrl = location.href;
      const originTitle = this.getDomTitle();
      // 用户主动导出时优先保证“此刻完整”，不能因为目录缓存而漏掉刚发送的消息。
      const payload = await this.fetchConversationTree({ force: true, maxAgeMs: 0, interactive: true });
      if (!payload) return null;
      const { conversationId, tree } = payload;
      const messages = this.messagesFromApiTree(tree);
      if (!messages.length) throw new Error('完整会话接口没有解析出可见的用户/助手消息');

      return {
        schema: 'cgpt-unified-session-export/v1',
        source: 'api',
        conversationId,
        title: this.normalizeMessageBody(tree.title) || originTitle,
        url: originUrl,
        exportedAt: new Date().toISOString(),
        messages,
      };
    }

    async collect() {
      const conversationId = this.getConversationId();
      const fallback = this.collectDom();
      if (conversationId) {
        try {
          const apiSession = await this.collectApi();
          if (apiSession?.messages?.length) return apiSession;
        } catch (error) {
          const key = `${conversationId}:${error?.message || error}`;
          if (this.apiFailureLoggedFor !== key) {
            this.apiFailureLoggedFor = key;
            console.warn('[ChatGPT 会话导出] API 完整导出失败，回退到 DOM 快照：', error);
          }
        }
      }
      if (this.getConversationId() !== conversationId) return null;
      if (conversationId) {
        const state = this.getApiState(), seconds = Math.max(0, Math.ceil((state.retryAt - Date.now()) / 1000));
        const detail = seconds ? '接口冷却约 ' + seconds + ' 秒。' : state.state === 'offline' ? '当前处于离线状态。' : '';
        if (!window.confirm('完整会话接口暂不可用。' + detail + '\n当前页面快照可能缺少未加载的历史消息。是否仍导出或复制当前页面内容？')) return null;
      }
      return this.collectDom();
    }

    toMarkdown(session) {
      const lines = [
        `# ${session.title}`,
        '',
        `- 导出时间：${session.exportedAt}`,
        `- 来源：${session.url}`,
        `- 消息数：${session.messages.length}`,
        `- 数据源：${session.source === 'api' ? 'ChatGPT 完整会话接口（当前分支）' : '页面 DOM 快照（回退模式）'}`,
        '',
        '---',
        '',
      ];
      session.messages.forEach((message, index) => {
        lines.push(`## ${message.role === 'user' ? '用户' : 'ChatGPT'} · ${index + 1}`, '', message.content, '', '---', '');
      });
      return lines.join('\n');
    }

    toText(session) {
      return session.messages.map((message, index) =>
        `[${index + 1}] ${message.role === 'user' ? '用户' : 'ChatGPT'}\n${message.content}`
      ).join('\n\n' + '-'.repeat(72) + '\n\n');
    }

    serialize(format, session) {
      if (format === 'json') return JSON.stringify(session, null, 2);
      if (format === 'txt') return this.toText(session);
      return this.toMarkdown(session);
    }

    async download(format = 'markdown') {
      let session;
      try {
        session = await this.collect();
      } catch (error) {
        console.error('[ChatGPT 会话导出] 导出失败：', error);
        window.alert(`导出失败：${error?.message || error}`);
        return false;
      }
      if (!session) return false;
      if (!session.messages.length) {
        window.alert('暂未找到可导出的会话内容。');
        return false;
      }

      const normalized = format === 'md' ? 'markdown' : format;
      const extension = normalized === 'markdown' ? 'md' : normalized;
      const mime = normalized === 'json' ? 'application/json' : 'text/plain';
      const blob = new Blob([this.serialize(normalized, session)], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeFilename(session.title)}-${new Date().toISOString().slice(0, 10)}.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    }

    async copyMarkdown() {
      let session;
      try {
        session = await this.collect();
      } catch (error) {
        console.error('[ChatGPT 会话导出] 复制失败：', error);
        return false;
      }
      if (!session?.messages.length) return false;
      const text = this.toMarkdown(session);
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const textarea = document.createElement('textarea');
        try {
          textarea.value = text;
          document.body.appendChild(textarea);
          textarea.select();
          return document.execCommand('copy');
        } catch { return false; }
        finally { textarea.remove(); }
      }
      return true;
    }
  }

  class TokenStatsController {
    constructor(exporter) {
      this.exporter = exporter;
      this.rootId = 'cgpt-unified-token-stats';
      this.chipAttr = 'data-cgpt-token-chip';
      this.enabledAttr = 'data-cgpt-token-stats-enabled';
      this.messageChipsAttr = 'data-cgpt-token-message-chips-enabled';
      this.summaryAttr = 'data-cgpt-token-summary-enabled';
      this.summaryPositionAttr = 'data-cgpt-token-summary-position';
      this.summaryOffsetXAttr = 'data-cgpt-token-summary-offset-x';
      this.summaryOffsetYAttr = 'data-cgpt-token-summary-offset-y';
      this.summaryCompactAttr = 'data-cgpt-token-summary-compact-narrow';
      this.summaryCompactAlwaysAttr = 'data-cgpt-token-summary-compact-always';
      this.summaryAvoidQueueAttr = 'data-cgpt-token-summary-avoid-queue';
      this.apiMaxAgeMs = 60000;
      this.domDebounceMs = 240;
      this.active = false;
      this.href = location.href;
      this.observer = null;
      this.observationRoot = null;
      this.refreshTimer = 0;
      this.mutationTimer = 0;
      this.positionRaf = 0;
      this.lastGenerating = false;
      this.apiFailureKey = '';
      this.messageStatsCache = new WeakMap();
      this.apiTokenCache = new Map();
      this.statsConversationId = null;
      this.refreshEpoch = 0;
      this.refreshing = false;
      this.refreshPending = false;
      this.forceApiPending = false;
      this.needsApiReconcile = false; this.apiReconcileSince = 0; this.apiGenerationEndPending = false;
      this.onSettingsChange = () => {
        this.syncEnabledState();
        if (this.active) {
          this.syncSubfeatureVisibility();
          this.schedulePosition();
        }
      };
      this.onViewportChange = runtime.pageWork.onScrollChange(event => {
        const target = event?.target;
        const shell = this.observedShell || runtime.composerQueueDock?.observedShell;
        if (event?.type === 'scroll' && target instanceof Element && shell?.isConnected && !target.contains(shell)) return;
        this.schedulePosition();
      });
    }

    init() {
      if (this.initialized) return;
      this.initialized = true;
      document.addEventListener('cgpt-unified-ui-settings-change', this.onSettingsChange);
      this.syncEnabledState();
    }

    destroy() {
      if (!this.initialized) return;
      document.removeEventListener('cgpt-unified-ui-settings-change', this.onSettingsChange);
      this.initialized = false;
      this.stop();
    }

    isEnabled() {
      return document.documentElement?.hasAttribute(this.enabledAttr) === true;
    }

    isSubfeatureEnabled(attr) {
      return document.documentElement?.hasAttribute(attr) === true;
    }

    showMessageChips() {
      return this.isSubfeatureEnabled(this.messageChipsAttr, true);
    }

    showSummary() {
      return this.isSubfeatureEnabled(this.summaryAttr, true);
    }

    compactOnNarrow() {
      return this.isSubfeatureEnabled(this.summaryCompactAttr, true);
    }

    compactAlways() {
      return this.isSubfeatureEnabled(this.summaryCompactAlwaysAttr, false);
    }

    avoidQueue() {
      return this.isSubfeatureEnabled(this.summaryAvoidQueueAttr, true);
    }

    summaryPosition() {
      return document.documentElement?.getAttribute(this.summaryPositionAttr) || 'auto';
    }

    summaryOffset(attr) {
      const value = Number.parseFloat(document.documentElement?.getAttribute(attr) || '0');
      return Number.isFinite(value) ? value : 0;
    }

    syncSubfeatureVisibility() {
      if (!this.showMessageChips()) this.removeMessageChips();
      if (!this.showSummary()) this.removeSummary();
      else this.scheduleRefresh(false);
    }

    syncEnabledState() {
      if (this.isEnabled()) this.start();
      else this.stop();
    }

    start() {
      if (this.active) {
        this.bindObserver();
        this.syncSubfeatureVisibility();
        this.scheduleRefresh(false);
        this.schedulePosition();
        return;
      }
      this.active = true;
      this.href = location.href;
      this.bindObserver();
      window.addEventListener('resize', this.onViewportChange, { passive: true });
      window.addEventListener('scroll', this.onViewportChange, { capture: true, passive: true });
      window.visualViewport?.addEventListener('resize', this.onViewportChange, { passive: true });
      window.visualViewport?.addEventListener('scroll', this.onViewportChange, { passive: true });
      this.scheduleRefresh(true);
      this.refreshTimer = window.setInterval(() => {
        if (!this.active || document.hidden) return;
        this.bindObserver();
        const routeChanged = location.href !== this.href;
        if (routeChanged) {
          this.href = location.href;
          this.exporter.invalidateApiTreeCache();
          this.scheduleRefresh(true);
          return;
        }
        this.scheduleRefresh(false);
        this.schedulePosition();
      }, 4000);
    }

    stop() {
      this.active = false;
      this.refreshEpoch += 1;
      this.refreshPending = false;
      this.forceApiPending = false;
      this.messageStatsCache = new WeakMap();
      this.apiTokenCache.clear();
      this.statsConversationId = null;
      this.needsApiReconcile = false; this.apiGenerationEndPending = false; this.apiReconcileSince = 0;
      clearInterval(this.refreshTimer);
      clearTimeout(this.mutationTimer);
      if (this.positionRaf) runtime.pageWork.cancelFrame(this.positionRaf);
      runtime.pageWork.cancelFrame(this.refreshFrame); this.refreshFrame = 0;
      this.refreshTimer = 0;
      this.mutationTimer = 0;
      this.positionRaf = 0;
      window.removeEventListener('resize', this.onViewportChange);
      window.removeEventListener('scroll', this.onViewportChange, true);
      window.visualViewport?.removeEventListener('resize', this.onViewportChange);
      window.visualViewport?.removeEventListener('scroll', this.onViewportChange);
      this.observer?.disconnect();
      this.observer = null;
      this.observationRoot = null;
      this.removeUi();
    }

    removeSummary() {
      document.getElementById(this.rootId)?.remove();
    }

    removeMessageChips() {
      document.querySelectorAll(`[${this.chipAttr}]`).forEach((node) => node.remove());
    }

    removeUi() {
      this.removeSummary();
      this.removeMessageChips();
    }

    bindObserver() {
      if (!this.active) return;
      const target = dom.main() || document.body;
      if (!target || target === this.observationRoot) return;
      this.observer?.disconnect();
      this.observationRoot = target;
      this.messageStatsCache = new WeakMap();
      this.observer = runtime.pageWork.observe(target, { childList: true, subtree: true, characterData: true }, (records) => {
        let externalChange = false;
        for (const record of records) {
          if (this.isOwnMutation(record)) continue;
          externalChange = true;
          this.invalidateMessageStats(record);
        }
        if (!externalChange) return;
        const generating = this.isGenerating();
        const justFinished = this.lastGenerating && !generating;
        this.lastGenerating = generating;
        if (justFinished) { this.needsApiReconcile = true; this.apiGenerationEndPending = true; this.apiReconcileSince = Date.now(); }
        this.scheduleRefresh(justFinished);
      });
    }

    invalidateMessageStats(record) {
      const target = record.target?.nodeType === Node.ELEMENT_NODE
        ? record.target
        : record.target?.parentElement;
      const roleNode = target?.closest?.(dom.message);
      if (roleNode) this.markMessageStatsDirty(roleNode);
      // Restored/virtualized turns may have changed while outside the observer.
      for (const node of record.addedNodes || []) {
        if (!(node instanceof Element)) continue;
        if (node.matches(dom.message)) this.markMessageStatsDirty(node);
        for (const role of node.querySelectorAll(dom.message)) {
          this.markMessageStatsDirty(role);
        }
      }
    }

    isOwnMutation(record) {
      const target = record.target?.nodeType === Node.ELEMENT_NODE
        ? record.target
        : record.target?.parentElement;
      if (target instanceof Element && target.closest(`#${this.rootId}, [${this.chipAttr}]`)) return true;
      const changed = [...(record.addedNodes || []), ...(record.removedNodes || [])];
      return changed.length > 0 && changed.every((node) => {
        if (!(node instanceof Element)) return false;
        return node.matches(`[${this.chipAttr}]`) || Boolean(node.closest(`[${this.chipAttr}]`));
      });
    }

    formatCount(value) {
      const n = Math.max(0, Math.round(Number(value) || 0));
      if (n < 1000) return String(n);
      if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
      return `${Math.round(n / 1000)}k`;
    }

    countTokenText(text, previous = null, offset = 0) {
      let score = previous?.score || 0;
      let asciiRun = previous?.asciiRun || 0;
      const flushAscii = () => {
        if (!asciiRun) return;
        score += Math.max(1, asciiRun / 4.05);
        asciiRun = 0;
      };
      for (const ch of text.slice(offset)) {
        const cp = ch.codePointAt(0);
        if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || (cp >= 48 && cp <= 57) || cp === 95) {
          asciiRun++;
          continue;
        }
        flushAscii();
        if (/\s/.test(ch)) score += 0.06;
        else if (
          (cp >= 0x3400 && cp <= 0x4dbf)
          || (cp >= 0x4e00 && cp <= 0x9fff)
          || (cp >= 0xf900 && cp <= 0xfaff)
        ) score += 0.72;
        else if (
          (cp >= 0x3040 && cp <= 0x30ff)
          || (cp >= 0xac00 && cp <= 0xd7af)
        ) score += 0.78;
        else if (cp <= 0x7f) score += /[.,;:!?()[\]{}'"`~@#$%^&*+=<>/\\|-]/.test(ch) ? 0.55 : 0.35;
        else if (cp >= 0x1f000) score += 1.65;
        else score += 0.95;
      }
      // Keep the trailing ASCII run uncommitted: a later chunk can extend it.
      // Rounding still happens once, exactly as in a full estimate.
      const total = score + (asciiRun ? Math.max(1, asciiRun / 4.05) : 0);
      return { score, asciiRun, tokens: text ? Math.max(1, Math.round(total)) : 0 };
    }

    estimateTokens(input) {
      return this.countTokenText(normalizeText(input)).tokens;
    }

    markMessageStatsDirty(node) {
      const stats = node && this.messageStatsCache.get(node);
      if (stats) stats.dirty = true;
    }

    canAppendTokenText(previous, content) {
      if (!previous?.tokenState || !content.startsWith(previous.content)) return false;
      const offset = previous.content.length;
      const before = previous.content.charCodeAt(offset - 1), after = content.charCodeAt(offset);
      // Do not split a newly completed surrogate pair between two chunks.
      return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
    }

    withTokenCounts(messages) {
      if (this.countedMessagesSource === messages && this.countedMessagesCache === this.apiTokenCache) {
        return this.countedMessagesSnapshot;
      }
      const nextCache = new Map();
      const counted = (Array.isArray(messages) ? messages : []).map((message) => {
        const key = message.id || message;
        const cached = this.apiTokenCache.get(key);
        const stats = cached && cached.content === message.content
          ? cached
          : { content: message.content, tokens: this.estimateTokens(message.content) };
        nextCache.set(key, stats);
        return { ...message, tokens: stats.tokens };
      });
      // Drop messages from abandoned branches instead of retaining every visited turn.
      this.apiTokenCache = nextCache;
      this.countedMessagesSource = messages;
      this.countedMessagesCache = nextCache;
      this.countedMessagesSnapshot = counted;
      return counted;
    }

    getAttachedRoleNodes() {
      return dom.messages();
    }

    extractAttachedContent(roleNode) {
      // Token chips are appended as direct children of the role node. The
      // shared text reader skips them without cloning a potentially huge answer.
      return normalizeText(dom.messageText(roleNode));
    }

    getMessageStats(roleNode) {
      let stats = this.messageStatsCache.get(roleNode);
      if (!stats || stats.dirty) {
        const content = this.extractAttachedContent(roleNode);
        const append = this.canAppendTokenText(stats, content);
        const tokenState = this.countTokenText(content, append ? stats.tokenState : null, append ? stats.content.length : 0);
        stats = { content, tokens: tokenState.tokens, tokenState, dirty: false };
        this.messageStatsCache.set(roleNode, stats);
      }
      return stats;
    }

    collectAttachedMessages(roleNodes = this.getAttachedRoleNodes()) {
      return roleNodes.map((node, index) => {
        const role = dom.role(node);
        const id = dom.messageId(node)
          || `dom-${index}`;
        const stats = this.getMessageStats(node);
        return { id, role, content: stats.content, tokens: stats.tokens };
      }).filter((message) => message.content);
    }

    latestRound(messages) {
      let userIndex = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === 'user') {
          userIndex = index;
          break;
        }
      }
      if (userIndex < 0) return { input: 0, output: 0 };
      let output = 0;
      for (let index = userIndex + 1; index < messages.length; index += 1) {
        if (messages[index].role === 'user') break;
        if (messages[index].role === 'assistant') output += messages[index].tokens || 0;
      }
      return { input: messages[userIndex].tokens || 0, output };
    }

    mergeStreamingTail(apiMessages, domMessages) {
      if (!apiMessages.length) return domMessages;
      if (!domMessages.length) return apiMessages;
      let apiUser = -1;
      let domUser = -1;
      for (let index = apiMessages.length - 1; index >= 0; index -= 1) {
        if (apiMessages[index].role === 'user') { apiUser = index; break; }
      }
      for (let index = domMessages.length - 1; index >= 0; index -= 1) {
        if (domMessages[index].role === 'user') { domUser = index; break; }
      }
      if (apiUser < 0 || domUser < 0) return apiMessages;
      const liveUser = domMessages[domUser];
      const sameUser = (message) => message.role === 'user' && (
        message.id && liveUser.id ? message.id === liveUser.id : message.content === liveUser.content
      );
      const match = apiMessages.findLastIndex(sameUser);
      if (match >= 0) {
        if (match !== apiUser) return apiMessages;
        return [...apiMessages.slice(0, match), ...domMessages.slice(domUser)];
      }
      // Only append an unknown live round when DOM confirms the previous API tail.
      const confirmed = domMessages.slice(0, domUser).some(message => message.role === 'user' && (
        message.id && apiMessages[apiUser].id
          ? message.id === apiMessages[apiUser].id : message.content === apiMessages[apiUser].content
      ));
      return confirmed ? [...apiMessages, ...domMessages.slice(domUser)] : apiMessages;
    }

    ensureStyles() {
      const styleId = `${this.rootId}-style`;
      if (document.getElementById(styleId)) return;
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        #${this.rootId} {
          position: fixed; left: 10px; top: 10px;
          z-index: 2147482400; color: var(--cgfc-token-summary-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616)));
          font: 12px/1.35 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          pointer-events: none;
        }
        #${this.rootId} .cgpt-token-pill {
          display: flex; align-items: center; gap: 7px; padding: 7px 10px;
          border: 1px solid var(--cgfc-token-summary-border-color, var(--cgfc-theme-border, color-mix(in srgb, currentColor 16%, transparent))); border-radius: 999px;
          background: var(--cgfc-token-summary-background-color, color-mix(in srgb, var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #fff))) 92%, transparent)); box-shadow: var(--cgfc-theme-shadow-soft, 0 4px 16px rgba(0,0,0,.10));
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          cursor: default; user-select: none; white-space: nowrap; pointer-events: auto;
        }
        #${this.rootId} .cgpt-token-muted { opacity: .58; }
        #${this.rootId} .cgpt-token-sep { opacity: .22; }
        #${this.rootId} .cgpt-token-compact { display: none; font-variant-numeric: tabular-nums; letter-spacing: .01em; }
        #${this.rootId}[data-compact="true"] .cgpt-token-full { display: none; }
        #${this.rootId}[data-compact="true"] .cgpt-token-compact { display: inline; }
        [${this.chipAttr}] {
          display: inline-flex; align-items: center; margin-inline-start: 6px; padding: 1px 5px;
          border: 1px solid color-mix(in srgb, currentColor 13%, transparent); border-radius: 999px;
          font: 10px/1.35 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          opacity: .52; vertical-align: middle; white-space: nowrap; user-select: none;
        }
        @media (max-width: 640px) {
          #${this.rootId} { font-size: 11px; }
          #${this.rootId} .cgpt-token-pill { gap: 5px; padding: 6px 8px; }
        }
      `;
      (document.head || document.documentElement)?.appendChild(style);
    }

    ensureSummary() {
      if (!this.showSummary() || !document.body || !this.exporter.getConversationId()) return null;
      this.ensureStyles();
      let root = document.getElementById(this.rootId);
      if (root) return root;
      root = document.createElement('div');
      root.id = this.rootId;
      root.innerHTML = '<div class="cgpt-token-pill"><span class="cgpt-token-full"><span data-slot="input">输入 ≈0 tok</span><span class="cgpt-token-sep"> · </span><span data-slot="output">输出 ≈0 tok</span><span class="cgpt-token-sep"> · </span><span class="cgpt-token-muted" data-slot="context">可见上下文 ≈0 tok</span></span><span class="cgpt-token-compact" data-slot="compact">0/0/0</span></div>';
      document.body.appendChild(root);
      globalThis.__cgptUnifiedRuntimeV1?.surfaceLiquidGlass?.schedule();
      return root;
    }

    renderSummary(messages) {
      if (!this.showSummary()) {
        this.removeSummary();
        return;
      }
      const root = this.ensureSummary();
      if (!root) return;
      const round = this.latestRound(messages);
      const total = messages.reduce((sum, message) => sum + (message.tokens || 0), 0);
      const input = this.formatCount(round.input);
      const output = this.formatCount(round.output);
      const context = this.formatCount(total);
      for (const [slot, value] of Object.entries({
        input: `输入 ≈${input} tok`,
        output: `输出 ≈${output} tok`,
        context: `可见上下文 ≈${context} tok`,
        compact: `${input}/${output}/${context}`,
      })) {
        const node = root.querySelector(`[data-slot="${slot}"]`);
        if (node && node.textContent !== value) node.textContent = value;
      }
      const pill = root.querySelector('.cgpt-token-pill');
      const state = this.exporter.getApiState?.();
      const remaining = Math.max(0, Math.ceil(((state?.retryAt || 0) - Date.now()) / 1000));
      const sourceLabel = this.summarySource === 'api-dom' ? 'API + 当前页面' : this.summarySource === 'api' ? 'API' : '当前页面 DOM';
      const statusLabel = remaining ? '；接口冷却约 ' + remaining + ' 秒' : state?.pending ? '；等待接口补拉' : '';
      const title = `数据源：${sourceLabel}${statusLabel}。可见文本 Token 估算：输入 ≈${input}，输出 ≈${output}，可见上下文 ≈${context}。不包含系统指令、记忆、工具定义、隐藏推理等服务端上下文，因此不是官方 usage。`;
      if (pill && pill.getAttribute('title') !== title) pill.setAttribute('title', title);
      if (pill && pill.getAttribute('aria-label') !== title) pill.setAttribute('aria-label', title);
      const compact = this.compactAlways()
        || (this.compactOnNarrow() && (window.visualViewport?.width || window.innerWidth || 0) <= 640);
      if (root.dataset.compact !== String(compact)) root.dataset.compact = String(compact);
      this.schedulePosition();
    }

    renderMessageChips(roleNodes = this.getAttachedRoleNodes()) {
      if (!this.showMessageChips()) {
        this.removeMessageChips();
        return;
      }
      for (const roleNode of roleNodes) {
        if (dom.isThinkingOverview(roleNode)) {
          roleNode.querySelector(`:scope > [${this.chipAttr}]`)?.remove();
          continue;
        }
        const stats = this.getMessageStats(roleNode);
        if (!stats.content) {
          roleNode.querySelector(`:scope > [${this.chipAttr}]`)?.remove();
          continue;
        }
        const value = `≈${this.formatCount(stats.tokens)} tok`;
        let chip = roleNode.querySelector(`:scope > [${this.chipAttr}]`);
        if (!chip) {
          chip = document.createElement('span');
          chip.setAttribute(this.chipAttr, '1');
          chip.title = '可见文本 Token 估算值，不是官方 usage';
          roleNode.appendChild(chip);
        }
        if (chip.textContent !== value) chip.textContent = value;
      }
    }

    findComposerForSummary() {
      const fromRuntime = runtime.promptLibrary?.findComposer?.();
      if (fromRuntime instanceof Element) return fromRuntime;
      return document.querySelector([
        '#prompt-textarea',
        '.ProseMirror[contenteditable="true"]',
        '[contenteditable="true"][role="textbox"]',
        'textarea[name="prompt-textarea"]',
      ].join(', '));
    }

    resolveComposerShellForSummary(composer) {
      if (!(composer instanceof Element)) return null;
      const fromQueue = runtime.composerQueueDock?.resolveComposerShell?.(composer);
      if (fromQueue instanceof Element) return fromQueue;
      return composer.closest('form[data-type*="composer" i], form[class*="composer" i], [data-testid*="composer" i], form')
        || composer.parentElement
        || composer;
    }

    getVisibleQueueRects() {
      return Array.from(document.querySelectorAll('.cgpt-queue-capsule, .cgpt-queue-panel'))
        .filter((node) => {
          if (!(node instanceof HTMLElement) || node.hidden || !node.isConnected) return false;
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0) return false;
          const rect = runtime.pageWork.rect(node);
          return rect.width > 0 && rect.height > 0;
        })
        .map((node) => runtime.pageWork.rect(node));
    }

    rectsOverlap(a, b, padding = 6) {
      return a.left < b.right + padding
        && a.right > b.left - padding
        && a.top < b.bottom + padding
        && a.bottom > b.top - padding;
    }

    schedulePosition() {
      if (!this.active || !this.showSummary() || this.positionRaf) return;
      this.positionRaf = runtime.pageWork.requestLayout(() => {
        this.positionRaf = 0;
        return this.preparePosition();
      }, 20);
    }

    refreshPosition() { this.schedulePosition(); }

    preparePosition() {
      const root = document.getElementById(this.rootId);
      if (!(root instanceof HTMLElement) || !this.showSummary()) return;

      const visualViewport = window.visualViewport;
      const viewportLeft = Math.max(0, visualViewport?.offsetLeft || 0);
      const viewportTop = Math.max(0, visualViewport?.offsetTop || 0);
      const viewportWidth = Math.max(240, visualViewport?.width || document.documentElement.clientWidth || window.innerWidth || 320);
      const viewportHeight = Math.max(240, visualViewport?.height || document.documentElement.clientHeight || window.innerHeight || 320);
      const viewportRight = viewportLeft + viewportWidth;
      const viewportBottom = viewportTop + viewportHeight;
      const edge = 10;

      const compact = this.compactAlways() || (this.compactOnNarrow() && viewportWidth <= 640);
      if (root.dataset.compact !== String(compact)) return () => { root.dataset.compact = String(compact); this.schedulePosition(); };
      const measured = runtime.pageWork.rect(root);
      const width = Math.max(1, measured.width);
      const height = Math.max(1, measured.height);

      const composer = this.findComposerForSummary();
      const shell = this.resolveComposerShellForSummary(composer);
      const composerRect = shell instanceof Element ? runtime.pageWork.rect(shell) : null;
      const offsetX = this.summaryOffset(this.summaryOffsetXAttr);
      const offsetY = this.summaryOffset(this.summaryOffsetYAttr);

      const clampPoint = (point) => ({
        left: Math.min(viewportRight - edge - width, Math.max(viewportLeft + edge, point.left + offsetX)),
        top: Math.min(viewportBottom - edge - height, Math.max(viewportTop + edge, point.top + offsetY)),
      });
      const makeRect = (point) => ({
        left: point.left,
        top: point.top,
        right: point.left + width,
        bottom: point.top + height,
      });
      const candidate = (position) => {
        if (position === 'viewport-bottom-left') return clampPoint({ left: viewportLeft + edge, top: viewportBottom - edge - height });
        if (position === 'viewport-bottom-right') return clampPoint({ left: viewportRight - edge - width, top: viewportBottom - edge - height });
        if (!composerRect || composerRect.width <= 0 || composerRect.height <= 0) {
          return clampPoint({ left: viewportRight - edge - width, top: viewportBottom - edge - height - 70 });
        }
        const top = composerRect.top - height - 8;
        if (position === 'composer-top-left') return clampPoint({ left: composerRect.left + 8, top });
        if (position === 'composer-top-right') return clampPoint({ left: composerRect.right - width - 8, top });
        return clampPoint({ left: composerRect.left + (composerRect.width - width) / 2, top });
      };

      const requested = this.summaryPosition();
      const queueRects = this.avoidQueue() ? this.getVisibleQueueRects() : [];
      const collides = (point) => queueRects.some((queueRect) => this.rectsOverlap(makeRect(point), queueRect));
      let point;

      if (requested === 'auto') {
        const order = [
          'composer-top-center',
          'composer-top-left',
          'composer-top-right',
          'viewport-bottom-left',
          'viewport-bottom-right',
        ];
        point = order.map(candidate).find((item) => !collides(item)) || candidate('composer-top-center');
      } else {
        point = candidate(requested);
        if (queueRects.length && collides(point)) {
          const overlapping = queueRects.find((queueRect) => this.rectsOverlap(makeRect(point), queueRect));
          if (overlapping) {
            const nudged = clampPoint({ left: point.left - offsetX, top: overlapping.top - height - 8 - offsetY });
            if (!collides(nudged)) point = nudged;
          }
        }
      }

      return () => {
      if (!root.isConnected || !this.active) return;
      root.style.left = `${Math.round(point.left)}px`;
      root.style.top = `${Math.round(point.top)}px`;
      root.style.removeProperty('right');
      root.style.removeProperty('bottom');
      };
    }

    isGenerating() {
      const runtime = globalThis.__cgptUnifiedRuntimeV1;
      if (runtime?.readQueueResponseState) return runtime.readQueueResponseState({ busyOnly: true }).busy === true;
      return Array.from((dom.main() || document).querySelectorAll('[data-testid="stop-button"], button[aria-label*="Stop" i], button[aria-label*="停止"]'))
        .some(element => !element.closest('[hidden], [aria-hidden="true"]') && element.getClientRects().length > 0);
    }

    apiCoversLiveRound(apiMessages, domMessages) {
      if (!domMessages.length) return true;
      if (!apiMessages.length) return false;
      const liveUser = domMessages.findLast(message => message.role === 'user');
      if (!liveUser) return true;
      const apiUser = apiMessages.findLastIndex(message => message.role === 'user');
      if (apiUser < 0) return false;
      const knownId = id => id && !/^dom-\d+$/.test(id);
      let match = apiUser;
      if (knownId(liveUser.id) && knownId(apiMessages[apiUser].id)) {
        match = apiMessages.findLastIndex(message => message.role === 'user' && message.id === liveUser.id);
        if (match < 0) return false;
        if (match !== apiUser) return true; // The user is viewing an older round.
      }
      const liveStart = domMessages.indexOf(liveUser);
      const liveAnswers = domMessages.slice(liveStart + 1).filter(message => message.role === 'assistant');
      const apiAnswers = apiMessages.slice(match + 1).filter(message => message.role === 'assistant');
      if (liveAnswers.length && !apiAnswers.length) return false;
      for (const message of liveAnswers) if (knownId(message.id) && !apiAnswers.some(answer => answer.id === message.id || answer.sourceIds?.includes(message.id))) return false;
      const liveText = normalizeText(liveAnswers.map(message => message.content).join('\n'));
      const apiText = normalizeText(apiAnswers.map(message => message.content).join('\n'));
      // Detect a clearly truncated snapshot. Different Markdown/DOM formatting
      // is not proof of truncation and must not cause endless forced requests.
      return !(apiText && liveText.length > apiText.length && liveText.startsWith(apiText));
    }

    summaryMessages(apiMessages, domMessages, generating) {
      if (!generating && !this.needsApiReconcile) {
        this.summarySource = apiMessages.length ? 'api' : 'dom';
        return apiMessages.length ? apiMessages : domMessages;
      }
      let merged = this.mergeStreamingTail(apiMessages, domMessages);
      // With native virtualization there may be no overlapping old round to
      // prove an append. Show the current DOM estimate until reconciliation,
      // rather than presenting the old API round as the current answer.
      const liveUser = domMessages.findLast(message => message.role === 'user');
      if (this.needsApiReconcile && merged === apiMessages && liveUser
        && !apiMessages.some(message => message.role === 'user' && (message.id && liveUser.id ? message.id === liveUser.id : message.content === liveUser.content))) merged = domMessages;
      this.summarySource = merged === apiMessages ? 'api' : merged === domMessages ? 'dom' : 'api-dom';
      return merged;
    }

    async refresh({ forceApi = false } = {}) {
      if (!this.active || !this.isEnabled()) return;
      const conversationId = this.exporter.getConversationId(), epoch = this.refreshEpoch;
      if (conversationId !== this.statsConversationId) {
        this.statsConversationId = conversationId; this.messageStatsCache = new WeakMap(); this.apiTokenCache.clear();
        this.needsApiReconcile = false; this.apiGenerationEndPending = false; this.apiReconcileSince = 0;
      }
      if (!conversationId) { this.removeUi(); return; }
      const showChips = this.showMessageChips(), showSummary = this.showSummary();
      if (!showChips && !showSummary) { this.removeUi(); return; }
      const roleNodes = this.getAttachedRoleNodes();
      if (showChips) this.renderMessageChips(roleNodes); else this.removeMessageChips();
      if (!showSummary) { this.removeSummary(); return; }
      const generating = this.isGenerating();
      if (this.lastGenerating && !generating) {
        this.needsApiReconcile = true; this.apiGenerationEndPending = true; this.apiReconcileSince = Date.now();
      }
      if (forceApi && !this.needsApiReconcile) { this.needsApiReconcile = true; this.apiReconcileSince = Date.now(); }
      this.lastGenerating = generating;
      let domMessages = this.collectAttachedMessages(roleNodes);
      const cached = this.exporter.getCachedActiveMessagesSync?.() || null;
      if (cached?.deferred) this.needsApiReconcile = true;
      const initialApi = this.withTokenCounts(cached?.messages || []);
      if (!generating && cached && !this.apiCoversLiveRound(initialApi, domMessages) && !this.needsApiReconcile) {
        this.needsApiReconcile = true; this.apiGenerationEndPending = true; this.apiReconcileSince = Date.now();
      }
      if (!forceApi && cached && !cached.deferred && (cached.requestedAt || cached.fetchedAt) >= this.apiReconcileSince && this.apiCoversLiveRound(initialApi, domMessages)) {
        this.needsApiReconcile = false; this.apiGenerationEndPending = false;
      }
      this.renderSummary(this.summaryMessages(initialApi, domMessages, generating));
      if (generating && cached && !forceApi) return;
      if (cached && !forceApi && !this.needsApiReconcile) return;
      let apiMessages = initialApi;
      try {
        const pending = this.apiStatsRequest;
        if (pending?.conversationId === conversationId && pending.epoch === epoch) return;
        const request = { conversationId, epoch, promise: this.exporter.getActiveMessages({
          force: forceApi || this.needsApiReconcile,
          refreshReason: this.apiGenerationEndPending ? 'generation-end' : 'background',
          after: this.apiReconcileSince, maxAgeMs: this.apiMaxAgeMs,
        }) };
        this.apiStatsRequest = request;
        let result;
        try { result = await request.promise; }
        finally { if (this.apiStatsRequest === request) this.apiStatsRequest = null; }
        if (!this.active || !this.isEnabled() || epoch !== this.refreshEpoch || this.exporter.getConversationId() !== conversationId) return;
        apiMessages = this.withTokenCounts(result?.messages || []);
        domMessages = this.collectAttachedMessages(this.getAttachedRoleNodes());
        if (result && !result.deferred && (result.requestedAt || result.fetchedAt) >= this.apiReconcileSince) {
          this.apiGenerationEndPending = false;
          this.needsApiReconcile = !this.apiCoversLiveRound(apiMessages, domMessages);
          if (this.needsApiReconcile) this.exporter.queueApiRefresh(conversationId, { after: this.apiReconcileSince, refreshReason: 'background' });
        }
        this.apiFailureKey = '';
      } catch (error) {
        const key = String(error?.message || error);
        if (key !== this.apiFailureKey) { this.apiFailureKey = key; console.debug('[Token Stats] 完整会话暂不可用，保留当前页面统计：', error); }
      }
      if (!this.active || !this.isEnabled() || epoch !== this.refreshEpoch || this.exporter.getConversationId() !== conversationId) return;
      domMessages = this.collectAttachedMessages(this.getAttachedRoleNodes());
      this.lastGenerating = this.isGenerating();
      this.renderSummary(this.summaryMessages(apiMessages, domMessages, this.lastGenerating));
    }

    scheduleRefresh(forceApi = false) {
      if (!this.active) return;
      this.refreshPending = true;
      this.forceApiPending ||= forceApi;
      if (this.mutationTimer || this.refreshFrame) return;
      // Coalesce streaming bursts without postponing the refresh indefinitely.
      this.mutationTimer = window.setTimeout(() => {
        this.mutationTimer = 0;
        this.refreshFrame = runtime.pageWork.requestFrame(async () => {
        this.refreshFrame = 0;
        if (!this.active) return;
        const force = this.forceApiPending;
        this.refreshPending = false;
        this.forceApiPending = false;
        this.refreshing = true;
        try {
          await this.refresh({ forceApi: force });
        } catch (error) {
          console.debug('[Token Stats] refresh failed:', error);
        } finally {
          this.refreshing = false;
          if (this.active && this.refreshPending) this.scheduleRefresh();
        }
        });
      }, this.domDebounceMs);
    }
  }

  function storageRead(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
    } catch {}
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function storageWrite(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return;
      }
    } catch {}
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  // Tabler Icons (MIT): https://github.com/tabler/tabler-icons
  const PROMPT_ACTION_ICONS = Object.freeze({
    pin: [
      'M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4',
      'M9 15l-4.5 4.5',
      'M14.5 4l5.5 5.5',
    ],
    edit: [
      'M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1',
      'M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415',
      'M16 5l3 3',
    ],
    copy: [
      'M8 4h11a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1H8a1 1 0 0 1 -1 -1V5a1 1 0 0 1 1 -1',
      'M4 16a1 1 0 0 1 -1 -1V3a1 1 0 0 1 1 -1h11',
    ],
    queue: [
      'M4 6h12',
      'M4 12h9',
      'M4 18h9',
      'M18 13v8',
      'M14 17h8',
    ],
  });

  class PromptLibrary {
    constructor() {
      this.prompts = this.normalizeLibrary(storageRead(PROMPT_STORAGE_KEY, []));
      this.nav = null;
      this.shadow = null;
      this.list = null;
      this.searchInput = null;
      this.categorySelect = null;
      this.editor = null;
      this.editingId = null;
      this.onCountChange = null;
      this.draggedPromptId = null;
      this.suppressPromptClickUntil = 0;
      this.promptViews = new WeakMap();
      this.usagePersistTimer = 0;
    }

    normalizeLibrary(value) {
      if (!Array.isArray(value)) return [];
      const normalized = value.map((item, index) => ({
        id: String(item?.id || `prompt-${Date.now()}-${index}`),
        title: normalizeText(item?.title || `提示词 ${index + 1}`).slice(0, 120),
        category: normalizeText(item?.category || '未分类').slice(0, 48),
        content: String(item?.content || ''),
        pinned: Boolean(item?.pinned),
        order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
        useCount: Math.max(0, Number(item?.useCount) || 0),
        createdAt: item?.createdAt || new Date().toISOString(),
        updatedAt: item?.updatedAt || new Date().toISOString(),
        lastUsedAt: item?.lastUsedAt || null,
      })).filter((item) => item.content.trim());
      normalized.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
      return this.reindexPromptOrder(normalized);
    }

    get count() {
      return this.prompts.length;
    }

    persist() {
      storageWrite(PROMPT_STORAGE_KEY, this.prompts);
      this.onCountChange?.(this.count);
    }

    scheduleUsagePersist() {
      if (this.usagePersistTimer) return;
      // Usage metadata does not affect the cards. Save it after the composer
      // has had a chance to paint instead of blocking the click handler.
      this.usagePersistTimer = window.setTimeout(() => {
        this.usagePersistTimer = 0;
        this.persist();
      }, 120);
    }

    mount({ shadow, nav, onCountChange }) {
      if (!(shadow instanceof ShadowRoot) || !(nav instanceof HTMLElement)) return;
      this.shadow = shadow;
      this.nav = nav;
      this.onCountChange = onCountChange;
      this.installStyles();
      this.buildShell();
      this.render();
      this.onCountChange?.(this.count);
    }

    installStyles() {
      if (this.shadow.getElementById('cgpt-unified-prompt-style')) return;
      const style = document.createElement('style');
      style.id = 'cgpt-unified-prompt-style';
      style.textContent = `
        .prompt-view { min-height: 0; display: flex; flex: 1; flex-direction: column; overflow: hidden; }
        .prompt-view[hidden] { display: none !important; }
        .prompt-toolbar { display: flex; flex: none; align-items: center; gap: 4px; padding: 4px 5px; border-bottom: 1px solid var(--cgfc-theme-border, var(--border-light, rgba(0,0,0,.1))); font-size: 11px; }
        .prompt-toolbar input, .prompt-toolbar select, .prompt-editor input, .prompt-editor textarea { min-width: 0; border: 1px solid var(--cgfc-theme-border, var(--border-light, rgba(0,0,0,.16))); border-radius: 7px; background: var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #fff))); color: var(--cgfc-theme-text-primary, var(--text-primary, #161616)); font: inherit; color-scheme: var(--cgfc-color-scheme, light); }
        .prompt-toolbar input { flex: 1; width: 0; height: 26px; padding: 3px 6px; }
        .prompt-toolbar select { max-width: 86px; height: 26px; padding: 2px 3px; }
        .prompt-mini-btn { flex: none; min-height: 27px; padding: 3px 6px; border: 0; border-radius: 7px; background: var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #eee))); color: var(--cgfc-theme-text-primary, var(--text-primary, #161616)); font: inherit; cursor: pointer; white-space: nowrap; }
        .prompt-mini-btn:hover { background: color-mix(in srgb, var(--cgfc-theme-text-primary, currentColor) 8%, var(--cgfc-theme-surface-secondary, transparent)); }
        .prompt-mini-btn[hidden] { display: none !important; }
        .prompt-mini-btn.danger { margin-right: auto; background: color-mix(in srgb, #dc2626 14%, var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #eee)))); color: #dc2626; }
        .prompt-tools-menu { position: relative; flex: none; }
        .prompt-tools-menu > summary { display: grid; width: 26px; height: 26px; place-items: center; list-style: none; border-radius: 7px; background: var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, #eee)); color: inherit; cursor: pointer; }
        .prompt-tools-menu > summary::-webkit-details-marker { display: none; }
        .prompt-tools-menu > summary:hover, .prompt-tools-menu > summary:focus-visible { background: color-mix(in srgb, currentColor 10%, var(--cgfc-theme-surface-secondary, #eee)); outline: none; }
        .prompt-tools-menu > summary svg { width: 17px; height: 17px; fill: currentColor; }
        .prompt-tools-popover { position: absolute; top: calc(100% + 5px); right: 0; z-index: 10; width: 176px; max-height: min(340px, 65vh); overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; -ms-overflow-style: none; -webkit-overflow-scrolling: touch; padding: 5px; border: 1px solid var(--cgfc-theme-border, rgba(127,127,127,.25)); border-radius: 10px; background: var(--cgfc-theme-surface-primary, var(--main-surface-primary, #222)); color: var(--cgfc-theme-text-primary, var(--text-primary, #fff)); box-shadow: 0 8px 24px rgba(0,0,0,.22); }
        .prompt-tools-popover::-webkit-scrollbar { display: none; width: 0; height: 0; }
        .prompt-tools-popover[hidden] { display: none !important; }
        .prompt-tools-heading { padding: 5px 7px 3px; color: var(--cgfc-theme-text-tertiary, #888); font-size: 10px; font-weight: 600; }
        .prompt-tools-popover button { display: block; width: 100%; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
        .prompt-tools-popover button:hover, .prompt-tools-popover button:focus-visible { background: var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, #333)); outline: none; }
        .prompt-list { min-height: 0; flex: 1; overflow-y: auto; padding: 6px; }
        .prompt-list::-webkit-scrollbar { width: 9px; }
        .prompt-list::-webkit-scrollbar-track { background: transparent; border-radius: 9px; }
        .prompt-list::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 9px; background: #424242; background-clip: padding-box; }
        .prompt-list::-webkit-scrollbar-thumb:hover { background-color: #585858; }
        .prompt-list::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
        .prompt-list::-webkit-scrollbar-corner { background: transparent; }
        @supports not selector(::-webkit-scrollbar) {
          .prompt-list { scrollbar-width: thin; scrollbar-color: #424242 transparent; }
        }
        .prompt-card { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 52px; column-gap: 5px; margin-bottom: 5px; padding: 8px; border: 1px solid transparent; border-radius: 9px; background: color-mix(in srgb, var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, #eee)) 58%, transparent); cursor: grab; transition: border-color 120ms ease, opacity 120ms ease, transform 120ms ease; }
        .prompt-card[data-pinned="true"] { border-color: color-mix(in srgb, #d99b18 45%, transparent); }
        .prompt-card.dragging { opacity: .42; cursor: grabbing; }
        .prompt-card.drop-before::before, .prompt-card.drop-after::after { position: absolute; right: 5px; left: 5px; z-index: 2; height: 2px; border-radius: 99px; background: #6d5dfc; content: ''; pointer-events: none; }
        .prompt-card.drop-before::before { top: -4px; }
        .prompt-card.drop-after::after { bottom: -4px; }
        .prompt-card-main { grid-column: 1; grid-row: 1 / span 2; width: 100%; min-width: 0; padding: 0 0 5px; border: 0; background: transparent; color: inherit; text-align: start; cursor: pointer; }
        .prompt-card-title { display: flex; min-width: 0; min-height: 24px; align-items: center; font-weight: 600; }
        .prompt-card-title-text { display: block; min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .prompt-card-category { grid-column: 2; grid-row: 2; justify-self: end; align-self: end; max-width: 52px; padding: 1px 5px; overflow: hidden; border-radius: 99px; background: color-mix(in srgb, currentColor 9%, transparent); color: var(--cgfc-theme-text-tertiary, var(--text-tertiary, #777)); font-size: 10px; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
        .prompt-card-preview { display: -webkit-box; margin-top: 4px; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; color: var(--cgfc-theme-text-secondary, var(--text-secondary, #555)); font-size: 11.5px; white-space: pre-wrap; }
        .prompt-card-actions { grid-column: 2; grid-row: 1; display: grid; grid-template-columns: repeat(2, 25px); gap: 2px; align-content: start; opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(-2px); transition: opacity 120ms ease, transform 120ms ease, visibility 120ms; }
        .prompt-card:hover .prompt-card-actions, .prompt-card:focus-within .prompt-card-actions { opacity: 1; visibility: visible; pointer-events: auto; transform: translateY(0); }
        .prompt-action-btn { display: grid; width: 25px; height: 25px; padding: 0; place-items: center; border: 0; border-radius: 6px; background: color-mix(in srgb, var(--cgfc-theme-surface-primary, var(--main-surface-primary, #fff)) 72%, transparent); color: var(--cgfc-theme-text-secondary, var(--text-secondary, #666)); cursor: pointer; }
        .prompt-action-btn:hover, .prompt-action-btn:focus-visible { background: var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #fff))); color: var(--cgfc-theme-text-primary, var(--text-primary, #161616)); outline: none; }
        .prompt-action-btn.active { background: #6d5dfc; color: #fff; }
        .prompt-action-icon { display: block; width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .prompt-empty { padding: 24px 12px; color: var(--cgfc-theme-text-tertiary, var(--text-tertiary, #777)); text-align: center; font-size: 12px; }
        .toc-item[data-unloaded="true"] { color: var(--cgfc-theme-text-tertiary, var(--text-tertiary, #777)); font-style: italic; }
        .prompt-editor { width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 32px); padding: 0; overflow: hidden; border: 1px solid var(--cgfc-theme-border, var(--border-light, rgba(0,0,0,.18))); border-radius: 12px; background: var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #fff))); color: var(--cgfc-theme-text-primary, var(--text-primary, #161616)); pointer-events: auto !important; color-scheme: var(--cgfc-color-scheme, light); }
        .prompt-editor::backdrop { background: var(--cgfc-theme-overlay, rgba(0,0,0,.45)); pointer-events: auto !important; }
        .prompt-editor-form { display: flex; flex-direction: column; gap: 9px; max-height: calc(100vh - 32px); padding: 16px; overflow-y: auto; overscroll-behavior: contain; }
        .prompt-editor h3 { margin: 0 0 3px; font-size: 16px; }
        .prompt-editor label { display: grid; gap: 4px; color: var(--cgfc-theme-text-secondary, var(--text-secondary, #555)); font-size: 12px; }
        .prompt-editor input, .prompt-editor textarea { padding: 7px 9px; }
        .prompt-editor textarea { min-height: 140px; max-height: 46vh; resize: vertical; }
        .prompt-editor-actions { display: flex; gap: 7px; justify-content: flex-end; }
        @media (hover: none), (pointer: coarse) {
          .prompt-card-actions { opacity: 1; visibility: visible; pointer-events: auto; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .prompt-card, .prompt-card-actions { transition: none; }
        }
        @container (max-width: 219px) {
          .prompt-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) 26px; gap: 4px; }
          .prompt-toolbar input { grid-column: 1 / -1; width: 100%; }
          .prompt-toolbar select { grid-column: 1; width: 100%; max-width: none; }
          .prompt-tools-menu { grid-column: 2; }
          .prompt-card { padding: 6px; }
        }
      `;
      this.shadow.appendChild(style);
    }

    makeButton(label, title, handler) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'prompt-mini-btn';
      button.textContent = label;
      button.title = title || label;
      button.addEventListener('click', handler);
      return button;
    }

    makeIconButton(iconName, title, handler) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'prompt-action-btn';
      button.title = title;
      button.setAttribute('aria-label', title);
      button.draggable = false;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('prompt-action-icon');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      for (const pathData of PROMPT_ACTION_ICONS[iconName] || []) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        svg.appendChild(path);
      }
      button.appendChild(svg);
      button.addEventListener('dragstart', (event) => event.preventDefault());
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        handler(event);
      });
      return button;
    }

    buildShell() {
      this.nav.replaceChildren();
      this.nav.classList.add('prompt-view');

      const toolbar = document.createElement('div');
      toolbar.className = 'prompt-toolbar';
      this.searchInput = document.createElement('input');
      this.searchInput.type = 'search';
      this.searchInput.placeholder = '搜索提示词';
      this.searchInput.addEventListener('input', () => this.render());
      this.categorySelect = document.createElement('select');
      this.categorySelect.title = '按分类筛选';
      this.categorySelect.addEventListener('change', () => this.render());
      const toolsMenu = document.createElement('details');
      toolsMenu.className = 'prompt-tools-menu';
      const toolsTrigger = document.createElement('summary');
      toolsTrigger.title = '提示词与会话操作';
      toolsTrigger.setAttribute('aria-label', toolsTrigger.title);
      toolsTrigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>';
      const toolsPopover = document.createElement('div');
      toolsPopover.className = 'prompt-tools-popover';
      const addGroup = (heading, entries) => {
        const title = document.createElement('div');
        title.className = 'prompt-tools-heading';
        title.textContent = heading;
        toolsPopover.appendChild(title);
        for (const [label, handler] of entries) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = label;
          button.addEventListener('click', () => {
            toolsMenu.open = false;
            handler();
          });
          toolsPopover.appendChild(button);
        }
      };
      addGroup('提示词', [
        ['新建提示词', () => this.openEditor()],
        ['导入提示词 JSON', () => this.importPrompts()],
        ['导出提示词 JSON', () => this.exportPrompts()],
      ]);
      addGroup('导出会话', [
        ['下载 Markdown', () => runtime.sessionExporter.download('markdown')],
        ['下载 JSON', () => runtime.sessionExporter.download('json')],
        ['下载纯文本', () => runtime.sessionExporter.download('txt')],
        ['复制完整会话 MD', async () => {
          const ok = await runtime.sessionExporter.copyMarkdown();
          if (!ok) window.alert('暂未找到可复制的会话内容。');
        }],
      ]);
      toolsMenu.append(toolsTrigger, toolsPopover);
      toolbar.append(this.searchInput, this.categorySelect, toolsMenu);
      this.toolbarMenuAbort?.abort();
      this.toolbarMenuAbort = new AbortController();
      document.addEventListener('pointerdown', (event) => {
        if (toolsMenu.open && !event.composedPath().includes(toolsMenu)) toolsMenu.open = false;
      }, { capture: true, signal: this.toolbarMenuAbort.signal });
      toolsMenu.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          toolsMenu.open = false;
          toolsTrigger.focus();
        }
      });
      const fitToolsPopover = () => {
        if (!toolsMenu.open) return;
        const available = this.nav.getBoundingClientRect().bottom
          - toolsPopover.getBoundingClientRect().top - 6;
        toolsPopover.style.maxHeight = `${Math.max(0, Math.min(340, Math.floor(available)))}px`;
      };
      toolsMenu.addEventListener('toggle', fitToolsPopover);
      this.toolsMenuResizeObserver?.disconnect();
      if (typeof ResizeObserver === 'function') {
        this.toolsMenuResizeObserver = new ResizeObserver(fitToolsPopover);
        this.toolsMenuResizeObserver.observe(this.nav);
      }

      this.list = document.createElement('div');
      this.list.className = 'prompt-list';
      this.nav.append(toolbar, this.list);
      this.buildEditor();
    }

    buildEditor() {
      const dialog = document.createElement('dialog');
      dialog.className = 'prompt-editor';
      const form = document.createElement('form');
      form.className = 'prompt-editor-form';
      form.method = 'dialog';
      const title = document.createElement('h3');
      title.textContent = '提示词';
      const titleLabel = document.createElement('label');
      titleLabel.textContent = '名称';
      const titleInput = document.createElement('input');
      titleInput.name = 'title';
      titleInput.required = true;
      titleLabel.appendChild(titleInput);
      const categoryLabel = document.createElement('label');
      categoryLabel.textContent = '分类';
      const categoryInput = document.createElement('input');
      categoryInput.name = 'category';
      categoryInput.placeholder = '未分类';
      categoryLabel.appendChild(categoryInput);
      const contentLabel = document.createElement('label');
      contentLabel.textContent = '内容（变量写作 {{变量名}}）';
      const contentInput = document.createElement('textarea');
      contentInput.name = 'content';
      contentInput.required = true;
      contentLabel.appendChild(contentInput);
      const actions = document.createElement('div');
      actions.className = 'prompt-editor-actions';
      const remove = this.makeButton('删除提示词', '删除当前提示词', () => {
        const id = this.editingId;
        if (id && this.deletePrompt(id)) dialog.close();
      });
      remove.classList.add('danger');
      remove.hidden = true;
      const cancel = this.makeButton('取消', '取消', () => dialog.close());
      const save = this.makeButton('保存', '保存提示词', () => {
        if (!form.reportValidity()) return;
        this.saveEditor({
          title: titleInput.value,
          category: categoryInput.value,
          content: contentInput.value,
        });
        dialog.close();
      });
      actions.append(remove, cancel, save);
      form.append(title, titleLabel, categoryLabel, contentLabel, actions);
      dialog.appendChild(form);
      dialog.addEventListener('cancel', () => {
        this.editingId = null;
      });
      dialog.addEventListener('close', () => {
        this.editingId = null;
      });
      this.shadow.appendChild(dialog);
      this.editor = { dialog, form, titleInput, categoryInput, contentInput, remove };
    }

    refreshCategories() {
      const current = this.categorySelect.value;
      const categories = [...new Set(this.prompts.map((item) => item.category))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      const options = this.categorySelect.options;
      if (options.length === categories.length + 1
        && options[0].value === ''
        && categories.every((category, index) => options[index + 1].value === category)) return;
      this.categorySelect.replaceChildren(new Option('全部分类', ''));
      categories.forEach((category) => this.categorySelect.appendChild(new Option(category, category)));
      this.categorySelect.value = categories.includes(current) ? current : '';
    }

    getPromptView(item) {
      let view = this.promptViews.get(item);
      if (!view || view.title !== item.title || view.category !== item.category
        || view.content !== item.content || view.pinned !== item.pinned) {
        view = { title: item.title, category: item.category, content: item.content, pinned: item.pinned,
          searchText: null, card: null };
        this.promptViews.set(item, view);
      }
      return view;
    }

    filteredPrompts() {
      const query = normalizeText(this.searchInput?.value).toLocaleLowerCase();
      const category = this.categorySelect?.value || '';
      return this.prompts.filter((item) => {
        if (category && item.category !== category) return false;
        if (!query) return true;
        const view = this.getPromptView(item);
        view.searchText ??= `${item.title}\n${item.category}\n${item.content}`.toLocaleLowerCase();
        return view.searchText.includes(query);
      }).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN'));
    }

    orderedPrompts() {
      return [...this.prompts].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN'));
    }

    reindexPromptOrder(items = this.prompts) {
      items.forEach((item, index) => {
        item.order = index;
      });
      return items;
    }

    movePrompt(draggedId, targetId, placeAfter = false) {
      if (!draggedId || !targetId || draggedId === targetId) return false;
      const ordered = this.orderedPrompts();
      const fromIndex = ordered.findIndex((item) => item.id === draggedId);
      if (fromIndex < 0) return false;
      const [dragged] = ordered.splice(fromIndex, 1);
      const targetIndex = ordered.findIndex((item) => item.id === targetId);
      if (targetIndex < 0) return false;
      ordered.splice(targetIndex + (placeAfter ? 1 : 0), 0, dragged);
      this.prompts = this.reindexPromptOrder(ordered);
      this.persist();
      this.render();
      return true;
    }

    clearPromptDropIndicators() {
      this.list?.querySelectorAll('.drop-before, .drop-after').forEach((card) => {
        card.classList.remove('drop-before', 'drop-after');
      });
    }

    finishPromptDrag() {
      this.list?.querySelectorAll('.prompt-card.dragging').forEach((card) => {
        card.classList.remove('dragging');
        card.setAttribute('aria-grabbed', 'false');
      });
      this.clearPromptDropIndicators();
      this.draggedPromptId = null;
      this.suppressPromptClickUntil = Date.now() + 250;
    }

    handlePromptDragStart(event, item, card) {
      const target = event.target;
      if (target instanceof Element && target.closest('.prompt-action-btn')) {
        event.preventDefault();
        return;
      }
      this.draggedPromptId = item.id;
      card.classList.add('dragging');
      card.setAttribute('aria-grabbed', 'true');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.id);
      }
    }

    handlePromptDragOver(event, item, card) {
      if (!this.draggedPromptId || this.draggedPromptId === item.id) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      this.clearPromptDropIndicators();
      const rect = card.getBoundingClientRect();
      card.classList.add(event.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
    }

    handlePromptDrop(event, item, card) {
      event.preventDefault();
      const draggedId = this.draggedPromptId;
      if (!draggedId || draggedId === item.id) {
        this.finishPromptDrag();
        return;
      }
      const rect = card.getBoundingClientRect();
      const placeAfter = event.clientY >= rect.top + rect.height / 2;
      this.finishPromptDrag();
      this.movePrompt(draggedId, item.id, placeAfter);
    }

    render() {
      if (!this.list) return;
      this.refreshCategories();
      const fragment = document.createDocumentFragment();
      const items = this.filteredPrompts();
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'prompt-empty';
        empty.textContent = this.prompts.length ? '没有匹配的提示词' : '还没有提示词。点击“＋”创建。';
        fragment.appendChild(empty);
      }
      items.forEach((item) => {
        const view = this.getPromptView(item);
        view.card ||= this.renderCard(item);
        fragment.appendChild(view.card);
      });
      this.list.replaceChildren(fragment);
    }

    renderCard(item) {
      const card = document.createElement('article');
      card.className = 'prompt-card';
      card.dataset.pinned = String(item.pinned);
      card.dataset.promptId = item.id;
      card.draggable = true;
      card.setAttribute('aria-grabbed', 'false');
      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'prompt-card-main';
      main.title = `${item.title}\n点击插入；按住拖动可调整顺序`;
      const title = document.createElement('div');
      title.className = 'prompt-card-title';
      const titleText = document.createElement('span');
      titleText.className = 'prompt-card-title-text';
      titleText.textContent = `${item.pinned ? '★ ' : ''}${item.title}`;
      titleText.title = item.title;
      const category = document.createElement('span');
      category.className = 'prompt-card-category';
      category.textContent = item.category;
      title.appendChild(titleText);
      const preview = document.createElement('div');
      preview.className = 'prompt-card-preview';
      preview.textContent = item.content;
      main.append(title, preview);
      main.addEventListener('click', (event) => {
        if (Date.now() < this.suppressPromptClickUntil) {
          event.preventDefault();
          return;
        }
        this.usePrompt(item);
      });

      const actions = document.createElement('div');
      actions.className = 'prompt-card-actions';
      const pin = this.makeIconButton('pin', item.pinned ? '取消置顶' : '置顶', () => this.togglePin(item.id));
      pin.classList.toggle('active', item.pinned);
      pin.setAttribute('aria-pressed', String(item.pinned));
      actions.append(
        pin,
        this.makeIconButton('edit', '编辑', () => this.openEditor(item)),
      );
      const copy = this.makeIconButton('copy', '复制提示词原文', async () => {
        const ok = await this.copyText(item.content);
        copy.classList.toggle('active', ok);
        copy.title = ok ? '已复制' : '复制失败';
        copy.setAttribute('aria-label', copy.title);
        setTimeout(() => {
          if (!copy.isConnected) return;
          copy.classList.remove('active');
          copy.title = '复制提示词原文';
          copy.setAttribute('aria-label', copy.title);
        }, 1500);
      });
      const queue = this.makeIconButton('queue', '加入发送队列', () => this.queuePrompt(item));
      actions.append(copy, queue);
      card.append(main, actions, category);
      card.addEventListener('dragstart', (event) => this.handlePromptDragStart(event, item, card));
      card.addEventListener('dragover', (event) => this.handlePromptDragOver(event, item, card));
      card.addEventListener('dragleave', (event) => {
        if (!card.contains(event.relatedTarget)) card.classList.remove('drop-before', 'drop-after');
      });
      card.addEventListener('drop', (event) => this.handlePromptDrop(event, item, card));
      card.addEventListener('dragend', () => this.finishPromptDrag());
      return card;
    }

    openEditor(item = null) {
      if (!this.editor) return;
      this.editingId = item?.id || null;
      this.editor.titleInput.value = item?.title || '';
      this.editor.categoryInput.value = item?.category || '未分类';
      this.editor.contentInput.value = item?.content || '';
      this.editor.remove.hidden = !item;
      if (typeof this.editor.dialog.showModal === 'function') this.editor.dialog.showModal();
      else this.editor.dialog.setAttribute('open', '');
      setTimeout(() => this.editor.titleInput.focus(), 0);
    }

    saveEditor(draft) {
      const now = new Date().toISOString();
      const normalized = {
        title: normalizeText(draft.title).slice(0, 120),
        category: normalizeText(draft.category || '未分类').slice(0, 48) || '未分类',
        content: String(draft.content || '').trim(),
        updatedAt: now,
      };
      if (!normalized.title || !normalized.content) return;
      const index = this.prompts.findIndex((item) => item.id === this.editingId);
      if (index >= 0) this.prompts[index] = { ...this.prompts[index], ...normalized };
      else this.prompts.push({
        id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...normalized,
        pinned: false,
        order: this.prompts.length,
        useCount: 0,
        createdAt: now,
        lastUsedAt: null,
      });
      this.persist();
      this.render();
    }

    togglePin(id) {
      const item = this.prompts.find((prompt) => prompt.id === id);
      if (!item) return;
      item.pinned = !item.pinned;
      item.updatedAt = new Date().toISOString();
      if (item.pinned) {
        const ordered = this.orderedPrompts().filter((prompt) => prompt.id !== id);
        this.prompts = this.reindexPromptOrder([item, ...ordered]);
      }
      this.persist();
      this.render();
    }

    deletePrompt(id) {
      const item = this.prompts.find((prompt) => prompt.id === id);
      if (!item || !window.confirm(`删除提示词“${item.title}”？`)) return false;
      this.prompts = this.prompts.filter((prompt) => prompt.id !== id);
      this.reindexPromptOrder(this.prompts);
      this.persist();
      this.render();
      return true;
    }

    resolveVariables(content) {
      const names = [...new Set(Array.from(String(content).matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), (match) => match[1].trim()))];
      let resolved = String(content);
      for (const name of names) {
        const value = window.prompt(`填写变量：${name}`, '');
        if (value === null) return null;
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        resolved = resolved.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'), value);
      }
      return resolved;
    }

    findComposer() {
      const candidates = [...new Set(document.querySelectorAll([
        '#prompt-textarea',
        '.ProseMirror[contenteditable="true"]',
        '[contenteditable="true"][role="textbox"]',
        'form[class*="composer"] [contenteditable="true"]',
        'textarea[name="prompt-textarea"]',
      ].join(', ')))].filter((element) => {
        if (!element?.isConnected || element.hasAttribute('disabled')) return false;
        if (element.getAttribute('aria-disabled') === 'true' || element.getAttribute('contenteditable') === 'false') return false;
        const view = element.ownerDocument?.defaultView || window;
        const style = view.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity || 1) > 0
          && rect.width > 0
          && rect.height > 0;
      });
      if (!candidates.length) return null;

      const viewportBottom = window.visualViewport
        ? window.visualViewport.offsetTop + window.visualViewport.height
        : (document.documentElement.clientHeight || window.innerHeight || 0);
      const score = (element) => {
        const rect = element.getBoundingClientRect();
        let value = 0;
        if (element.id === 'prompt-textarea') value += 120;
        if (element.matches('textarea[name="prompt-textarea"]')) value += 80;
        if (element.closest('form[data-type*="composer" i], form[class*="composer" i], [data-testid*="composer" i], [data-chatgpt-composer]')) value += 70;
        if (element.closest(`${dom.message}, article, dialog, [role="dialog"]`)) value -= 140;
        value += Math.max(0, 70 - Math.max(0, viewportBottom - rect.bottom) / 4);
        return value;
      };
      return candidates.sort((a, b) => score(b) - score(a))[0] || null;
    }

    insertIntoComposer(text, options = {}) {
      const composer = this.findComposer();
      if (!composer || typeof composer.focus !== 'function') {
        if (!options.silent) window.alert('没有找到 ChatGPT 输入框。请先打开一个可输入的会话。');
        return false;
      }
      const ownerDocument = composer.ownerDocument || document;
      const ownerWindow = ownerDocument.defaultView || window;
      const TextareaCtor = ownerWindow.HTMLTextAreaElement;
      const InputCtor = ownerWindow.HTMLInputElement;
      const isTextControl = (TextareaCtor && composer instanceof TextareaCtor)
        || (InputCtor && composer instanceof InputCtor);
      const previousSelection = ownerWindow.getSelection();
      const hadComposerSelection = previousSelection?.rangeCount
        && composer.contains(previousSelection.anchorNode) && composer.contains(previousSelection.focusNode);
      composer.focus({ preventScroll: true });
      if (isTextControl) {
        const start = composer.selectionStart ?? composer.value.length;
        const end = composer.selectionEnd ?? start;
        composer.setRangeText(text, start, end, 'end');
        let inputEvent;
        try {
          inputEvent = new ownerWindow.InputEvent('input', {
            bubbles: true,
            composed: true,
            inputType: 'insertText',
            data: text,
          });
        } catch {
          inputEvent = new ownerWindow.Event('input', { bubbles: true, composed: true });
        }
        composer.dispatchEvent(inputEvent);
      } else if (composer.isContentEditable || composer.getAttribute('contenteditable') === 'true') {
        const selection = ownerWindow.getSelection();
        if (!selection) return false;

        const placeCaretAtEnd = () => {
          const endRange = ownerDocument.createRange();
          endRange.selectNodeContents(composer);
          endRange.collapse(false);
          selection.removeAllRanges();
          selection.addRange(endRange);
        };
        if (!hadComposerSelection || !selection.rangeCount || !composer.contains(selection.anchorNode)
          || !composer.contains(selection.focusNode)) placeCaretAtEnd();

        const beforeText = composer.textContent || '';
        let inserted = false;
        if (composer.matches('.ProseMirror') && (text.length >= 4096 || /[\r\n]/.test(text))) {
          try {
            // One native editor paste transaction instead of the browser's
            // multiline editing command. Generated HTML contains plain text
            // only; paragraph boundaries preserve blank lines and whitespace.
            const clipboardData = new ownerWindow.DataTransfer();
            const escape = line => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const html = text.split(/\r\n?|\n/).map((line, index) =>
              `<p${index === 0 ? ' data-pm-slice="1 1 []"' : ''} style="white-space: pre-wrap">${line ? escape(line) : '<br>'}</p>`).join('');
            clipboardData.setData('text/plain', text);
            clipboardData.setData('text/html', html);
            const paste = new ownerWindow.ClipboardEvent('paste', {
              clipboardData, cancelable: true, bubbles: false,
            });
            // Target the editor's handler, without bubbling into application
            // handlers that may turn a large clipboard payload into a file.
            composer.dispatchEvent(paste);
            inserted = paste.defaultPrevented || (composer.textContent || '') !== beforeText;
          } catch { inserted = (composer.textContent || '') !== beforeText; }
        }
        // Long prompts bypass the synthetic beforeinput attempt. Otherwise the
        // editor may parse the same large payload again through execCommand.
        if (!inserted && text.length < 4096) try {
          // ChatGPT 的 ProseMirror 会处理 beforeinput；先走它自己的编辑事务，
          // 可避免“DOM 看似写入后又被 React 状态还原”。
          const beforeInput = new ownerWindow.InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType: 'insertText',
            data: text,
          });
          composer.dispatchEvent(beforeInput);
          inserted = beforeInput.defaultPrevented || (composer.textContent || '') !== beforeText;
        } catch {}

        inserted ||= (composer.textContent || '') !== beforeText;
        if (!inserted) {
          if (!selection.rangeCount || !composer.contains(selection.anchorNode)) placeCaretAtEnd();
          try {
            inserted = Boolean(ownerDocument.execCommand('insertText', false, text));
          } catch {}
          inserted ||= (composer.textContent || '') !== beforeText;
        }

        if (!inserted) {
          if (!selection.rangeCount || !composer.contains(selection.anchorNode)) placeCaretAtEnd();
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const node = ownerDocument.createTextNode(text);
          range.insertNode(node);
          range.setStartAfter(node);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          let inputEvent;
          try {
            inputEvent = new ownerWindow.InputEvent('input', {
              bubbles: true,
              composed: true,
              inputType: 'insertText',
              data: text,
            });
          } catch {
            inputEvent = new ownerWindow.Event('input', { bubbles: true, composed: true });
          }
          composer.dispatchEvent(inputEvent);
        }
      } else {
        return false;
      }
      composer.focus({ preventScroll: true });
      return true;
    }

    usePrompt(item) {
      const resolved = this.resolveVariables(item.content);
      if (resolved == null || !this.insertIntoComposer(resolved)) return;
      item.useCount += 1;
      item.lastUsedAt = new Date().toISOString();
      this.scheduleUsagePersist();
    }

    queuePrompt(item) {
      const resolved = this.resolveVariables(item.content);
      if (resolved == null) return;
      const queued = runtime.messageQueue?.enqueue?.(resolved, { source: 'prompt', promptId: item.id });
      if (!queued) return;
      item.useCount += 1;
      item.lastUsedAt = new Date().toISOString();
      this.persist();
      this.renderQueue();
    }

    enqueueQueueInput() {
      const content = String(this.queueInput?.value || '').trim();
      if (!content) return;
      const queued = runtime.messageQueue?.enqueue?.(content, { source: 'manual' });
      if (!queued) return;
      this.queueInput.value = '';
      this.queueInput.focus({ preventScroll: true });
      this.renderQueue();
    }

    renderQueue() {
      if (!this.queueList) return;
      const queue = runtime.messageQueue;
      const snapshot = queue?.snapshot?.() || { items: [], isPaused: false };
      const items = snapshot.items || [];
      if (this.queueCount) this.queueCount.textContent = `发送队列 · ${items.length}`;
      if (this.queuePauseButton) {
        this.queuePauseButton.textContent = snapshot.isPaused ? '继续' : '暂停';
        this.queuePauseButton.title = snapshot.isPaused ? '继续自动发送队列' : '暂停自动发送队列';
      }

      const fragment = document.createDocumentFragment();
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'queue-empty';
        empty.textContent = snapshot.isPaused ? '队列为空 · 已暂停' : '队列为空';
        fragment.appendChild(empty);
      }
      const statusText = { pending: '等待', sending: '发送中', failed: '失败' };
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'queue-item';
        row.dataset.status = item.status;
        const text = document.createElement('div');
        text.className = 'queue-item-text';
        text.textContent = item.content.replace(/\s+/g, ' ').trim();
        text.title = item.content;
        const status = document.createElement('div');
        status.className = 'queue-item-status';
        status.textContent = item.status === 'pending' && queue?.isItemOnCurrentConversation?.(item) === false
          ? '等待原会话'
          : statusText[item.status] || item.status;
        const actions = document.createElement('div');
        actions.className = 'queue-item-actions';
        if (item.status === 'failed') {
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.textContent = '↻';
          retry.title = '重试';
          retry.addEventListener('click', () => queue?.retry?.(item.id));
          actions.appendChild(retry);
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.title = '移出队列';
        remove.addEventListener('click', () => queue?.remove?.(item.id));
        actions.appendChild(remove);
        row.append(text, status, actions);
        fragment.appendChild(row);
      }
      this.queueList.replaceChildren(fragment);
    }

    getComposerText(composer = this.findComposer()) {
      if (!composer) return '';
      const view = composer.ownerDocument?.defaultView || window;
      const TextareaCtor = view.HTMLTextAreaElement;
      const InputCtor = view.HTMLInputElement;
      if ((TextareaCtor && composer instanceof TextareaCtor) || (InputCtor && composer instanceof InputCtor)) {
        return String(composer.value || '');
      }
      return String(composer.innerText || composer.textContent || '');
    }

    hasComposerContent() {
      return this.getComposerText().replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim().length > 0;
    }

    composerContains(content) {
      const normalize = (value) => String(value || '')
        .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const editor = normalize(this.getComposerText());
      const wanted = normalize(content);
      return Boolean(editor && wanted && (editor === wanted || editor.includes(wanted) || wanted.includes(editor)));
    }

    findComposerForm(composer = this.findComposer()) {
      if (!(composer instanceof Element)) return null;
      return composer.closest('form')
        || composer.closest('[data-composer-surface]')?.closest('form')
        || null;
    }

    findUploadInput(composer = this.findComposer()) {
      const form = this.findComposerForm(composer);
      if (!form) return null;
      const local = form.querySelector([
        '#upload-files',
        'input[type="file"][data-photo-upload-enabled="true"]',
        'input[type="file"]:not([accept])',
      ].join(', '));
      if (local instanceof HTMLInputElement && local.type === 'file' && !local.disabled) return local;

      // Only fall back to ChatGPT's known native upload hooks. Avoid a global
      // generic input[type=file] lookup because the queue UI itself owns one.
      const nativeGlobal = document.querySelector('#upload-files, input[type="file"][data-photo-upload-enabled="true"]');
      if (nativeGlobal instanceof HTMLInputElement && nativeGlobal.type === 'file' && !nativeGlobal.disabled) return nativeGlobal;
      return null;
    }

    getComposerAttachmentNames(composer = this.findComposer()) {
      const form = this.findComposerForm(composer);
      if (!form) return [];
      const names = new Set();
      form.querySelectorAll('input[type="file"]').forEach((input) => {
        Array.from(input.files || []).forEach((file) => {
          if (file?.name) names.add(String(file.name));
        });
      });
      form.querySelectorAll('button[aria-label]').forEach((button) => {
        const name = this.getAttachmentRemovalName(button);
        if (name) names.add(name);
      });
      return [...names];
    }

    getAttachmentRemovalName(button) {
      const label = String(button.getAttribute('aria-label') || '');
      const quoted = label.match(/^(?:移除|remove)\s*[“"](.+)[”"]\s*$/i);
      const legacy = label.match(/(?:移除文件\s*\d*[:：]?|remove\s+file\s*\d*[:：]?)[\s]*(.+)$/i);
      return (quoted?.[1] || legacy?.[1] || '').trim();
    }

    hasComposerAttachments(composer = this.findComposer()) {
      const form = this.findComposerForm(composer);
      if (!form) return false;
      if (this.getComposerAttachmentNames(composer).length) return true;
      return Boolean(form.querySelector(
        'button[aria-label*="移除文件" i], button[aria-label*="remove file" i], [data-testid*="attachment" i]'
      ));
    }

    hasComposerPayload(composer = this.findComposer()) {
      return Boolean(
        this.getComposerText(composer).replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim()
        || this.hasComposerAttachments(composer)
      );
    }

    composerMatchesQueueItem(item, composer = this.findComposer()) {
      if (!item || !composer) return false;
      const text = String(item.content || '').trim();
      const normalize = (value) => String(value || '')
        .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const editor = normalize(this.getComposerText(composer));
      const wanted = normalize(text);
      const textMatches = !wanted || Boolean(editor && (editor === wanted || editor.includes(wanted) || wanted.includes(editor)));
      const wantedNames = (Array.isArray(item.attachments) ? item.attachments : [])
        .map((attachment) => String(attachment?.name || attachment?.file?.name || '').trim())
        .filter(Boolean);
      if (!wantedNames.length) return textMatches;
      const present = this.getComposerAttachmentNames(composer);
      const attachmentsMatch = wantedNames.every((name) => present.includes(name));
      return textMatches && attachmentsMatch;
    }

    async attachFiles(files, options = {}) {
      const normalized = Array.from(files || []).filter((file) => file instanceof File);
      if (!normalized.length) return true;
      const composer = this.findComposer();
      const input = this.findUploadInput(composer);
      if (!composer || !input || typeof DataTransfer !== 'function') return false;

      const transfer = new DataTransfer();
      for (const file of normalized) transfer.items.add(file);
      try {
        input.files = transfer.files;
      } catch {
        return false;
      }
      const eventInit = { bubbles: true, composed: true };
      input.dispatchEvent(new Event('input', eventInit));
      input.dispatchEvent(new Event('change', eventInit));

      const timeout = Math.max(5000, Number(options.timeout || 120000));
      const deadline = Date.now() + timeout;
      const wantedNames = normalized.map((file) => file.name);
      let readySince = 0;
      while (Date.now() < deadline) {
        const currentComposer = this.findComposer();
        const form = this.findComposerForm(currentComposer);
        if (!form) return false;
        const formText = String(form.innerText || form.textContent || '');
        const labels = Array.from(form.querySelectorAll('button[aria-label]'), (button) => String(button.getAttribute('aria-label') || ''));
        const visible = wantedNames.every((name) => formText.includes(name) || labels.some((label) => label.includes(name)));
        const alertText = Array.from(document.querySelectorAll('[role="alert"]'), (node) => String(node.textContent || '')).join('\n');
        const obviousFailure = /(?:上传失败|无法上传|不支持.{0,8}(?:文件|格式)|upload failed|couldn't upload|cannot upload|unsupported.{0,8}(?:file|format))/i.test(`${formText}\n${alertText}`);
        if (obviousFailure) return false;
        const sendReady = Boolean(this.findSendButton(currentComposer));
        if (visible && sendReady) {
          if (!readySince) readySince = Date.now();
          if (Date.now() - readySince >= 500) return true;
        } else {
          readySince = 0;
        }
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
      return false;
    }

    async clearComposerAttachments() {
      const composer = this.findComposer();
      const form = this.findComposerForm(composer);
      if (!form) return;
      const buttons = Array.from(form.querySelectorAll('button[aria-label]')).filter((button) =>
        this.getAttachmentRemovalName(button)
        || /(?:移除文件|remove\s+file)/i.test(button.getAttribute('aria-label') || ''));
      for (const button of buttons) {
        try { button.click(); } catch {}
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      form.querySelectorAll('input[type="file"]').forEach((input) => {
        try { input.value = ''; } catch {}
      });
    }

    findSendButton(composer = this.findComposer()) {
      const selectors = [
        '#composer-submit-button:not([data-testid="stop-button"])',
        'button[data-testid="send-button"]',
        'button[data-testid="composer-send-button"]',
        'button[aria-label*="send" i]',
        'button[aria-label*="发送" i]',
      ].join(',');
      const candidates = Array.from(document.querySelectorAll(selectors));
      return candidates.find((button) => {
        if (!(button instanceof HTMLElement) || !button.isConnected) return false;
        if (button.disabled || button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return false;
        const style = getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return false;
        if (!composer) return true;
        const form = button.closest('form');
        if (form?.contains(composer)) return true;
        const shell = button.closest('[data-testid*="composer"], [class*="composer"]');
        return Boolean(shell?.contains(composer));
      }) || null;
    }

    async submitComposer({ immediate = false } = {}) {
      const composer = this.findComposer();
      if (!composer || !this.hasComposerPayload(composer)) return false;
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      let button = null;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        if (runtime.isGenerating?.() || runtime.readQueueResponseState().busy) return false;
        button = this.findSendButton(composer);
        if (button) break;
        await wait(100);
      }

      // Recheck after uploads and React's send-button updates. Do not bypass a
      // missing/disabled send control with requestSubmit during a thinking gap.
      const response = runtime.readQueueResponseState();
      if (!button || runtime.isGenerating?.() || response.busy || (!immediate && !response.complete)) return false;
      runtime.armSendGuard?.();
      let dispatched = false;
      if (button) {
        button.click();
        dispatched = true;
      }
      if (!dispatched) return false;

      for (let attempt = 0; attempt < 30; attempt += 1) {
        await wait(100);
        if (runtime.isGenerating?.()) return true;
        if (!this.hasComposerPayload(this.findComposer())) return true;
      }
      return false;
    }

    async copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        const textarea = document.createElement('textarea');
        try {
          textarea.value = text;
          document.body.appendChild(textarea);
          textarea.select();
          return document.execCommand('copy');
        } catch { return false; }
        finally { textarea.remove(); }
      }
    }

    exportPrompts() {
      const blob = new Blob([JSON.stringify(this.prompts, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `chatgpt-prompts-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    importPrompts() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const imported = this.normalizeLibrary(JSON.parse(await file.text()));
          if (!imported.length) throw new Error('文件中没有有效提示词');
          const overwrite = window.confirm('确定：覆盖现有提示词\n取消：按 ID/标题合并');
          if (overwrite) {
            this.prompts = imported;
          } else {
            const merged = new Map(this.prompts.map((item) => [item.id, item]));
            for (const item of imported) {
              const sameTitle = [...merged.values()].find((current) => current.title === item.title);
              const existing = merged.get(item.id) || sameTitle || null;
              const id = existing?.id || item.id;
              merged.set(id, {
                ...(existing || {}),
                ...item,
                id,
                order: existing?.order ?? merged.size,
              });
            }
            this.prompts = this.reindexPromptOrder([...merged.values()].sort((a, b) => a.order - b.order));
          }
          this.persist();
          this.render();
        } catch (error) {
          window.alert(`导入失败：${error?.message || error}`);
        }
      }, { once: true });
      input.click();
    }
  }

  class MessageQueue {
    constructor(runtimeRef) {
      this.runtime = runtimeRef;
      this.items = [];
      this.isPaused = false;
      this.editingItemId = '';
      this.listeners = new Set();
      this.timer = 0;
      this.idleCount = 0;
      this.isDispatching = false;
      this.awaitingResponse = null;
      this.readySignature = '';
      this.readySince = 0;
      this.POLL_INTERVAL = 1000;
      this.IDLE_THRESHOLD = 2;
      this.POST_SUBMIT_MIN_WAIT_MS = 2500;
      this.POST_SUBMIT_QUIET_MS = 3500;
    }

    snapshot() {
      return {
        items: this.items.map((item) => ({
          ...item,
          metadata: item.metadata ? { ...item.metadata } : undefined,
          attachments: Array.isArray(item.attachments)
            ? item.attachments.map((attachment) => ({ ...attachment }))
            : [],
        })),
        isPaused: this.isPaused,
        editingItemId: this.editingItemId,
        isProcessing: this.items.some((item) => item.status === 'sending'),
        awaitingResponse: Boolean(this.awaitingResponse),
      };
    }

    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      this.listeners.add(listener);
      try { listener(this.snapshot()); } catch {}
      return () => this.listeners.delete(listener);
    }

    emit() {
      const state = this.snapshot();
      this.listeners.forEach((listener) => {
        try { listener(state); } catch (error) { console.warn('[发送队列] UI 更新失败：', error); }
      });
    }

    normalizeAttachments(values) {
      const FileCtor = globalThis.File;
      const source = Array.isArray(values) ? values : Array.from(values || []);
      const normalized = [];
      for (const value of source) {
        const file = value?.file || value;
        if (!FileCtor || !(file instanceof FileCtor)) continue;
        normalized.push({
          id: value?.id || `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          name: String(file.name || value?.name || '附件'),
          type: String(file.type || value?.type || ''),
          size: Number(file.size || value?.size || 0),
          lastModified: Number(file.lastModified || value?.lastModified || 0),
        });
      }
      return normalized;
    }

    hasPayload(content, attachments = []) {
      return Boolean(String(content || '').trim() || this.normalizeAttachments(attachments).length);
    }

    enqueue(content, metadata = undefined, attachments = undefined) {
      const text = String(content || '').trim();
      const normalizedAttachments = this.normalizeAttachments(attachments);
      if (!text && !normalizedAttachments.length) return null;
      const item = {
        id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content: text,
        attachments: normalizedAttachments,
        createdAt: Date.now(),
        status: 'pending',
        error: '',
        metadata: {
          ...(metadata && typeof metadata === 'object' ? metadata : {}),
          conversationId: metadata?.conversationId ?? this.getConversationId(),
        },
      };
      this.items.push(item);
      this.emit();
      this.start();
      return item;
    }

    enqueueMany(values) {
      const created = [];
      for (const value of Array.isArray(values) ? values : []) {
        const item = typeof value === 'string'
          ? this.enqueue(value)
          : this.enqueue(value?.content, value?.metadata, value?.attachments);
        if (item) created.push(item);
      }
      return created;
    }

    beginEdit(id) {
      const item = this.items.find((candidate) => candidate.id === id);
      if (!item || item.status === 'sending' || this.isDispatching) return false;
      this.editingItemId = id;
      this.idleCount = 0;
      this.emit();
      return true;
    }

    cancelEdit(id = this.editingItemId) {
      if (!this.editingItemId || (id && this.editingItemId !== id)) return false;
      this.editingItemId = '';
      this.idleCount = 0;
      this.emit();
      this.start();
      return true;
    }

    update(id, content, attachments = undefined) {
      const item = this.items.find((candidate) => candidate.id === id);
      if (!item || item.status === 'sending' || this.isDispatching) return false;
      const text = String(content || '').trim();
      const normalizedAttachments = this.normalizeAttachments(
        attachments === undefined ? item.attachments : attachments
      );
      if (!text && !normalizedAttachments.length) return false;
      item.content = text;
      item.attachments = normalizedAttachments;
      item.status = 'pending';
      item.error = '';
      item.submitBaseline = '';
      if (this.editingItemId === id) this.editingItemId = '';
      this.idleCount = 0;
      this.emit();
      this.start();
      return true;
    }

    remove(id) {
      const item = this.items.find((candidate) => candidate.id === id);
      if (item?.status === 'sending') return false;
      const before = this.items.length;
      this.items = this.items.filter((item) => item.id !== id);
      if (this.editingItemId === id) this.editingItemId = '';
      if (this.items.length !== before) this.emit();
      return this.items.length !== before;
    }

    clear() {
      this.items = this.items.filter((item) => item.status === 'sending');
      this.editingItemId = '';
      this.idleCount = 0;
      this.emit();
      return true;
    }

    retry(id) {
      const item = this.items.find((candidate) => candidate.id === id);
      if (!item || item.status === 'sending') return false;
      item.status = 'pending';
      item.error = '';
      item.submitBaseline = '';
      this.idleCount = 0;
      this.emit();
      this.start();
      return true;
    }

    pause() {
      if (this.isPaused) return;
      this.isPaused = true;
      this.idleCount = 0;
      this.emit();
      if (!this.awaitingResponse && !this.items.some((item) => item.status === 'sending')) this.stop();
    }

    resume() {
      if (!this.isPaused) return;
      this.isPaused = false;
      this.idleCount = 0;
      this.emit();
      this.start();
    }

    togglePause() {
      if (this.isPaused) this.resume();
      else this.pause();
    }

    start() {
      if (this.timer) return;
      if (this.isPaused && !this.awaitingResponse && !this.items.some((item) => item.status === 'sending')) return;
      this.timer = window.setInterval(() => this.tick(), this.POLL_INTERVAL);
      window.setTimeout(() => this.tick(), 80);
    }

    stop() {
      if (this.timer) window.clearInterval(this.timer);
      this.timer = 0;
      this.idleCount = 0;
    }

    getConversationId() {
      return location.pathname.match(/\/c\/([0-9a-f-]{20,})/i)?.[1] || '';
    }

    isItemOnCurrentConversation(item) {
      const bound = String(item?.metadata?.conversationId || '');
      return !bound || bound === this.getConversationId();
    }

    isGenerating() {
      if (this.runtime.readQueueResponseState?.().busy) return true;
      if (typeof this.runtime.isGenerating === 'function') {
        try { return Boolean(this.runtime.isGenerating()); } catch {}
      }
      const directStop = document.querySelector(
        '[data-testid="stop-button"], [data-testid="composer-stop-button"], [data-testid*="stop-generating"]'
      );
      if (directStop instanceof HTMLElement) {
        const rect = directStop.getBoundingClientRect();
        const style = getComputedStyle(directStop);
        if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') return true;
      }
      return false;
    }

    getConversationActivitySignature() {
      return this.runtime.readQueueResponseState().signature;
    }

    isResponseReadyToSend() {
      const response = this.runtime.readQueueResponseState();
      if (this.isGenerating() || !response.complete) {
        this.readySignature = '';
        this.readySince = 0;
        return false;
      }
      const signature = `${this.getConversationId()}:${response.signature}`;
      if (signature !== this.readySignature) {
        this.readySignature = signature;
        this.readySince = Date.now();
        return false;
      }
      return Date.now() - this.readySince >= this.POST_SUBMIT_QUIET_MS;
    }

    getLatestUserTurnSignature() {
      const users = document.querySelectorAll(`main ${dom.user}`);
      const last = users[users.length - 1];
      if (!last) return `0::`;
      const messageId = dom.messageId(last)
        || last.closest('[data-testid^="conversation-turn-"]')?.getAttribute('data-testid')
        || '';
      const text = dom.messageText(last)
        .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      // Parking/remounting older messages changes the mounted count without
      // advancing the latest user turn. Prefer the stable message identity.
      return `${messageId || `mounted-${users.length}`}:${text.length}:${text.slice(Math.max(0, text.length - 240))}`;
    }

    hasUserTurnAdvanced(item) {
      const before = String(item?.submitBaseline || '');
      return Boolean(before && this.getLatestUserTurnSignature() !== before);
    }

    completeItem(id) {
      const item = this.items.find((candidate) => candidate.id === id);
      if (item) item.status = 'sent';
      this.items = this.items.filter((candidate) => candidate.id !== id);
      this.emit();
    }

    startPostSubmitWait(userBaseline) {
      const now = Date.now();
      this.awaitingResponse = {
        sentAt: now,
        lastActivityAt: now,
        signature: this.getConversationActivitySignature(),
        userBaseline,
        conversationId: this.getConversationId(),
      };
      this.idleCount = 0;
      this.readySignature = '';
      this.readySince = 0;
    }

    updatePostSubmitWait() {
      const state = this.awaitingResponse;
      if (!state) return false;
      const now = Date.now();
      const conversationId = this.getConversationId();
      if (state.conversationId && state.conversationId !== conversationId) return true;
      if (!state.conversationId && conversationId) state.conversationId = conversationId;
      const generating = this.isGenerating();
      if (generating) {
        state.lastActivityAt = now;
      }
      const response = this.runtime.readQueueResponseState();
      const signature = response.signature;
      if (signature !== state.signature) {
        state.signature = signature;
        state.lastActivityAt = now;
      }
      const elapsed = now - state.sentAt;
      const quietFor = now - state.lastActivityAt;
      const userTurnAdvanced = Boolean(state.userBaseline
        && this.getLatestUserTurnSignature() !== state.userBaseline);
      const done = (
        elapsed >= this.POST_SUBMIT_MIN_WAIT_MS
        && quietFor >= this.POST_SUBMIT_QUIET_MS
        && !generating
        && userTurnAdvanced
        && response.complete
      );
      if (done) {
        this.awaitingResponse = null;
        this.idleCount = 0;
        this.emit();
      }
      return true;
    }

    async tick() {
      if (this.isDispatching) return;
      if (this.updatePostSubmitWait()) return;
      if (this.editingItemId) {
        this.idleCount = 0;
        return;
      }
      if (this.isPaused) {
        this.idleCount = 0;
        return;
      }

      const sending = this.items.find((item) => item.status === 'sending');
      if (sending) {
        await this.recoverSendingItem(sending);
        return;
      }
      const pending = this.items.find((item) => item.status === 'pending');
      if (!pending) {
        this.idleCount = 0;
        if (!this.awaitingResponse && !this.items.some((item) => item.status === 'sending' || item.status === 'pending')) {
          this.stop();
        }
        return;
      }

      const promptLibrary = this.runtime.promptLibrary;
      if (!this.isItemOnCurrentConversation(pending)) {
        this.idleCount = 0;
        return;
      }
      if (!promptLibrary?.findComposer?.()) {
        this.idleCount = 0;
        return;
      }
      if (promptLibrary.hasComposerPayload?.()) {
        this.idleCount = 0;
        return;
      }
      if (!this.isResponseReadyToSend()) {
        this.idleCount = 0;
        return;
      }
      this.idleCount += 1;
      if (this.idleCount < this.IDLE_THRESHOLD) return;
      this.idleCount = 0;
      await this.dispatchNext(pending);
    }

    async sendNow(id) {
      const item = this.items.find((candidate) => candidate.id === id);
      if (!item || item.status === 'sending' || this.isDispatching) return false;
      const reject = (message) => {
        item.error = message;
        this.emit();
        return false;
      };
      if (this.editingItemId) return reject('请先保存或取消正在编辑的消息');
      if (!this.isItemOnCurrentConversation(item)) return reject('请返回这条消息所属的会话后发送');
      const promptLibrary = this.runtime.promptLibrary;
      if (!promptLibrary?.findComposer?.()) return reject('未找到当前会话输入框');
      if (promptLibrary.hasComposerPayload?.()) return reject('输入框已有文字或附件，请先处理草稿');
      if (this.items.some((candidate) => candidate.status === 'sending')) return reject('已有队列消息正在提交，请稍后再试');
      if (this.isGenerating()) return reject('当前正在生成回答，请稍后再试');
      item.status = 'pending';
      this.idleCount = 0;
      await this.dispatchNext(item, { immediate: true });
      this.start();
      return item.status === 'sent' || item.status === 'sending';
    }

    async dispatchNext(item, { immediate = false } = {}) {
      if (!item || this.isDispatching || item.status !== 'pending') return;
      const promptLibrary = this.runtime.promptLibrary;
      if (!promptLibrary) return;
      this.isDispatching = true;
      item.status = 'sending';
      item.error = '';
      this.emit();
      try {
        if ((immediate ? this.isGenerating() : !this.isResponseReadyToSend())
          || !this.isItemOnCurrentConversation(item) || promptLibrary.hasComposerPayload()) {
          item.status = 'pending';
          return;
        }

        const queuedAttachments = Array.isArray(item.attachments) ? item.attachments : [];
        const attachmentFiles = queuedAttachments
          .map((attachment) => attachment?.file)
          .filter((file) => file instanceof File);
        if (queuedAttachments.length && attachmentFiles.length !== queuedAttachments.length) {
          item.status = 'failed';
          item.error = '附件对象已失效，请编辑此消息并重新选择附件';
          return;
        }
        if (attachmentFiles.length) {
          const attached = await promptLibrary.attachFiles(attachmentFiles);
          if (!attached) {
            await promptLibrary.clearComposerAttachments?.();
            item.status = 'failed';
            item.error = '附件上传未完成';
            return;
          }
        }

        const text = String(item.content || '').trim();
        const inserted = !text || promptLibrary.insertIntoComposer(text, { silent: true });
        if (!inserted) {
          await promptLibrary.clearComposerAttachments?.();
          item.status = 'failed';
          item.error = '无法写入输入框';
          return;
        }
        item.submitBaseline = this.getLatestUserTurnSignature();
        const submitted = await promptLibrary.submitComposer({ immediate });
        if (submitted || this.hasUserTurnAdvanced(item) || !promptLibrary.composerMatchesQueueItem(item)) {
          this.completeItem(item.id);
          this.startPostSubmitWait(item.submitBaseline);
        } else {
          // Keep the item in "sending" instead of immediately retrying. The
          // recovery path waits for another confirmed idle window first.
          item.status = 'sending';
        }
      } catch (error) {
        console.error('[发送队列] 发送失败：', error);
        item.error = String(error?.message || error || '发送失败');
        item.status = promptLibrary.composerMatchesQueueItem(item) ? 'sending' : 'failed';
      } finally {
        this.isDispatching = false;
        this.emit();
      }
    }

    async recoverSendingItem(item) {
      if (!item || this.isDispatching) return;
      const promptLibrary = this.runtime.promptLibrary;
      if (!promptLibrary) return;
      if (!this.isItemOnCurrentConversation(item)) {
        this.idleCount = 0;
        return;
      }
      if (this.isGenerating()) {
        this.idleCount = 0;
        return;
      }
      if (this.hasUserTurnAdvanced(item) || !promptLibrary.composerMatchesQueueItem(item)) {
        this.completeItem(item.id);
        this.startPostSubmitWait(item.submitBaseline);
        return;
      }
      if (!this.isResponseReadyToSend()) {
        this.idleCount = 0;
        return;
      }
      this.idleCount += 1;
      if (this.idleCount < this.IDLE_THRESHOLD) return;
      this.idleCount = 0;
      this.isDispatching = true;
      try {
        if (!item.submitBaseline) item.submitBaseline = this.getLatestUserTurnSignature();
        const submitted = await promptLibrary.submitComposer();
        if (submitted || this.hasUserTurnAdvanced(item) || !promptLibrary.composerMatchesQueueItem(item)) {
          this.completeItem(item.id);
          this.startPostSubmitWait(item.submitBaseline);
        }
      } catch (error) {
        console.error('[发送队列] 重试发送失败：', error);
        item.error = String(error?.message || error || '重试失败');
      } finally {
        this.isDispatching = false;
        this.emit();
      }
    }
  }

  class ComposerQueueDock {
    constructor(runtimeRef) {
      this.runtime = runtimeRef;
      this.root = null;
      this.capsule = null;
      this.capsuleLabel = null;
      this.capsuleBadge = null;
      this.panel = null;
      this.countLabel = null;
      this.pauseButton = null;
      this.clearButton = null;
      this.list = null;
      this.input = null;
      this.draftAttachmentList = null;
      this.enqueueButton = null;
      this.status = null;
      this.draftAttachments = [];
      this.editDraft = null;
      this.isOpen = false;
      this.unsubscribe = null;
      this.observer = null;
      this.resizeObserver = null;
      this.observedShell = null;
      this.neumorphicShell = null;
      this.positionRaf = 0;
      this.glassRefreshPending = true;
      this.mutationPositionTimer = 0;
      this.heartbeat = 0;
      this.started = false;
      this.onViewportChange = runtime.pageWork.onScrollChange(event => {
        const target = event?.target;
        const shell = this.observedShell || runtime.composerQueueDock?.observedShell;
        if (event?.type === 'scroll' && target instanceof Element && shell?.isConnected && !target.contains(shell)) return;
        this.schedulePosition();
      });
      this.onUiSettingsChange = () => {
        this.render();
        this.schedulePosition(true);
      };
      this.onDocumentPointerDown = (event) => {
        if (!this.isOpen || !this.root || this.root.contains(event.target)) return;
        this.close();
      };
    }

    start() {
      if (this.started) return;
      this.started = true;
      this.installStyles();
      this.unsubscribe = this.runtime.messageQueue?.subscribe?.(() => {
        this.render();
        this.schedulePosition();
      }) || null;
      window.addEventListener('resize', this.onViewportChange, { passive: true });
      window.addEventListener('scroll', this.onViewportChange, { capture: true, passive: true });
      window.visualViewport?.addEventListener('resize', this.onViewportChange, { passive: true });
      window.visualViewport?.addEventListener('scroll', this.onViewportChange, { passive: true });
      document.addEventListener('cgpt-unified-ui-settings-change', this.onUiSettingsChange);
      document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
      const observe = () => {
        if (this.observer || !document.documentElement) return;
        this.observer = new MutationObserver((records) => this.scheduleMutationPosition(records));
        this.observer.observe(document.documentElement, { childList: true, subtree: true });
      };
      observe();
      // ResizeObserver + DOM mutations handle normal movement; this is only a
      // low-frequency fallback for route/layout changes that do not emit either.
      this.heartbeat = window.setInterval(() => this.schedulePosition(true), 3000);
      window.setTimeout(() => {
        this.ensureRoot();
        this.render();
        this.schedulePosition();
      }, 0);
    }

    installStyles() {
      if (document.getElementById('cgpt-unified-composer-queue-style')) return;
      const style = document.createElement('style');
      style.id = 'cgpt-unified-composer-queue-style';
      style.textContent = `
        #cgpt-unified-queue-dock { position: static; width: 0; height: 0; }
        #cgpt-unified-queue-dock[hidden] { display: none !important; }
        .cgpt-queue-capsule,
        .cgpt-queue-panel { position: fixed; z-index: 2147482500; font-family: var(--cgfc-queue-font, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif); }
        .cgpt-queue-capsule { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 5px 10px; border: 1px solid var(--cgfc-theme-border, color-mix(in srgb, currentColor 14%, transparent)); border-radius: 999px; background: var(--cgfc-queue-panel-background, color-mix(in srgb, var(--cgfc-theme-surface-primary, var(--main-surface-primary, #fff)) 92%, transparent)); color: var(--cgfc-queue-text-color, var(--cgfc-theme-text-secondary, var(--text-secondary, #555))); box-shadow: var(--cgfc-theme-shadow-soft, 0 4px 16px rgba(0,0,0,.10)); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); cursor: pointer; font-size: var(--cgfc-queue-font-size, 12px); font-weight: 600; line-height: var(--cgfc-queue-line-height, 1.4); user-select: none; transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease; color-scheme: var(--cgfc-color-scheme, light); }
        .cgpt-queue-capsule:hover { transform: translateY(-1px); background: var(--cgfc-queue-panel-background, var(--cgfc-theme-surface-primary, var(--main-surface-primary, #fff))); color: var(--cgfc-queue-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616))); box-shadow: var(--cgfc-theme-shadow-soft, 0 7px 20px rgba(0,0,0,.13)); }
        .cgpt-queue-capsule svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        .cgpt-queue-capsule-badge { display: inline-flex; min-width: 17px; height: 17px; padding: 0 5px; align-items: center; justify-content: center; border-radius: 999px; background: var(--cgfc-queue-accent-color, #6d5dfc); color: #fff; font-size: .833em; font-weight: 700; }
        .cgpt-queue-capsule-badge[hidden] { display: none !important; }
        .cgpt-queue-panel { display: flex; width: var(--cgfc-queue-panel-width, 420px); max-width: calc(100vw - 20px); flex-direction: column; overflow: hidden; border: 1px solid var(--cgfc-theme-border, var(--border-light, rgba(0,0,0,.14))); border-radius: 18px; background: var(--cgfc-queue-panel-background, var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #fff)))); color: var(--cgfc-queue-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616))); box-shadow: var(--cgfc-theme-shadow-strong, 0 18px 48px rgba(0,0,0,.18)); font-size: var(--cgfc-queue-font-size, 12px); line-height: var(--cgfc-queue-line-height, 1.4); color-scheme: var(--cgfc-color-scheme, light); }
        .cgpt-queue-panel[hidden] { display: none !important; }
        .cgpt-queue-panel-header { display: flex; min-height: 48px; padding: 9px 11px 9px 14px; align-items: center; gap: 8px; border-bottom: 1px solid color-mix(in srgb, var(--cgfc-theme-border, var(--border-light, rgba(0,0,0,.1))) 76%, transparent); }
        .cgpt-queue-panel-title { margin-right: auto; font-size: 1.083em; font-weight: 700; }
        .cgpt-queue-panel-actions { display: flex; gap: 4px; align-items: center; }
        .cgpt-queue-icon-btn { display: inline-grid; min-width: 30px; height: 30px; padding: 0 8px; place-items: center; border: 1px solid transparent; border-radius: 9px; background: transparent; color: var(--cgfc-queue-text-color, var(--cgfc-theme-text-secondary, var(--text-secondary, #666))); cursor: pointer; font: inherit; font-size: .917em; transition: background 120ms ease, color 120ms ease, border-color 120ms ease, transform 120ms ease; }
        .cgpt-queue-icon-btn[data-icon-only="true"] { width: 30px; min-width: 30px; padding: 0; }
        .cgpt-queue-icon-btn svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        .cgpt-queue-icon-btn:hover { background: var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #eee))); color: var(--cgfc-theme-text-primary, var(--text-primary, #161616)); }
        .cgpt-queue-icon-btn:active { transform: scale(.97); }
        .cgpt-queue-icon-btn:disabled { opacity: .35; cursor: default; }
        .cgpt-queue-list { min-height: 42px; max-height: 270px; overflow-y: auto; padding: 9px 10px 7px; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, currentColor 18%, transparent) transparent; }
        .cgpt-queue-list::-webkit-scrollbar { width: 6px; }
        .cgpt-queue-list::-webkit-scrollbar-track { background: transparent; }
        .cgpt-queue-list::-webkit-scrollbar-thumb { border-radius: 999px; background: color-mix(in srgb, currentColor 16%, transparent); }
        .cgpt-queue-empty { padding: 18px 10px; color: var(--cgfc-queue-muted-color, var(--cgfc-theme-text-tertiary, var(--text-tertiary, #888))); font-size: .95em; text-align: center; }
        .cgpt-queue-row { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 8px; align-items: start; margin-bottom: 6px; padding: 9px; border: 1px solid transparent; border-radius: 12px; background: color-mix(in srgb, var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, #eee)) 42%, transparent); transition: background 120ms ease, border-color 120ms ease; }
        .cgpt-queue-row[data-status="sending"] { outline: 1px solid color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 42%, transparent); }
        .cgpt-queue-row[data-status="failed"] { outline: 1px solid color-mix(in srgb, #dc2626 40%, transparent); }
        .cgpt-queue-index { display: grid; width: 21px; height: 21px; place-items: center; border-radius: 999px; background: color-mix(in srgb, var(--cgfc-theme-surface-primary, var(--main-surface-primary, #fff)) 88%, transparent); color: var(--cgfc-queue-muted-color, var(--cgfc-theme-text-secondary, var(--text-secondary, #666))); font-size: .78em; font-weight: 700; }
        .cgpt-queue-main { min-width: 0; }
        .cgpt-queue-text { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; color: var(--cgfc-queue-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616))); font-size: 1em; line-height: 1.45; overflow-wrap: anywhere; white-space: normal; }
        .cgpt-queue-attachments { display: flex; min-width: 0; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
        .cgpt-queue-attachments:empty { display: none; }
        .cgpt-queue-attachment { display: inline-flex; min-width: 0; max-width: 100%; height: 25px; padding: 0 8px; align-items: center; gap: 5px; border: 1px solid color-mix(in srgb, var(--cgfc-theme-border, rgba(127,127,127,.25)) 58%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--cgfc-theme-surface-primary, #fff) 82%, transparent); color: var(--cgfc-queue-muted-color, var(--cgfc-theme-text-secondary, var(--text-secondary, #666))); font-size: .81em; }
        .cgpt-queue-attachment-icon { display: inline-grid; width: 14px; height: 14px; flex: none; place-items: center; }
        .cgpt-queue-attachment-icon svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        .cgpt-queue-attachment-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cgpt-queue-attachment-remove { display: inline-grid; width: 16px; height: 16px; padding: 0; flex: none; place-items: center; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; font: inherit; }
        .cgpt-queue-attachment-remove svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; }
        .cgpt-queue-attachment-remove:hover { background: color-mix(in srgb, currentColor 12%, transparent); }
        .cgpt-queue-item-status { display: inline-flex; margin-top: 4px; color: var(--cgfc-queue-muted-color, var(--cgfc-theme-text-tertiary, var(--text-tertiary, #888))); font-size: .79em; }
        .cgpt-queue-row[data-status="failed"] .cgpt-queue-item-status { color: color-mix(in srgb, #ef4444 76%, currentColor 24%); }
        .cgpt-queue-row[data-status="sending"] .cgpt-queue-item-status { color: color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 72%, currentColor 28%); }
        .cgpt-queue-row-actions { display: flex; gap: 2px; align-items: center; }
        .cgpt-queue-row-actions button { display: inline-grid; width: 27px; height: 27px; padding: 0; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--cgfc-theme-text-tertiary, var(--text-tertiary, #777)); cursor: pointer; transition: background 120ms ease, color 120ms ease, transform 120ms ease; }
        .cgpt-queue-row-actions button:hover { background: var(--cgfc-theme-surface-primary, var(--main-surface-primary, #fff)); color: var(--cgfc-theme-text-primary, var(--text-primary, #161616)); }
        .cgpt-queue-row-actions button:active { transform: scale(.94); }
        .cgpt-queue-row-actions button:disabled { opacity: .28; cursor: default; }
        .cgpt-queue-row-actions button.cgpt-queue-send-now { width: auto; min-width: 27px; padding: 0 6px; display: inline-flex; gap: 4px; align-items: center; font: inherit; font-size: .8em; white-space: nowrap; color: var(--cgfc-queue-accent-color, #6d5dfc); }
        .cgpt-queue-row-actions svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
        .cgpt-queue-edit-text { box-sizing: border-box; width: 100%; min-height: 48px; max-height: 140px; padding: 9px 10px; resize: none; overflow-y: hidden; scrollbar-width: none; border: 1px solid var(--cgfc-theme-border, var(--border-light, rgba(0,0,0,.15))); border-radius: 10px; background: var(--cgfc-theme-surface-primary, var(--main-surface-primary, #fff)); color: var(--cgfc-queue-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616))); font: inherit; line-height: 1.45; outline: none; }
        .cgpt-queue-edit-text::-webkit-scrollbar { display: none; }
        .cgpt-queue-edit-tools { display: flex; gap: 5px; margin-top: 6px; align-items: center; }
        .cgpt-queue-mini-btn { min-height: 25px; padding: 3px 7px; border: 1px solid var(--cgfc-theme-border, rgba(127,127,127,.22)); border-radius: 7px; background: transparent; color: var(--cgfc-queue-muted-color, var(--cgfc-theme-text-secondary, #666)); cursor: pointer; font: inherit; font-size: .833em; }
        .cgpt-queue-mini-btn:hover { background: var(--cgfc-theme-surface-primary, var(--main-surface-primary, #fff)); color: var(--cgfc-theme-text-primary, var(--text-primary, #161616)); }
        .cgpt-queue-compose { display: flex; flex-direction: column; gap: 7px; padding: 10px 10px 8px; border-top: 1px solid color-mix(in srgb, var(--cgfc-theme-border, var(--border-light, rgba(0,0,0,.1))) 76%, transparent); }
        .cgpt-queue-compose-row { display: flex; min-height: 48px; gap: 7px; padding: 5px 5px 5px 12px; align-items: flex-end; border: 1px solid color-mix(in srgb, var(--cgfc-theme-border, var(--border-light, rgba(0,0,0,.15))) 82%, transparent); border-radius: 18px; background: color-mix(in srgb, var(--cgfc-theme-surface-primary, var(--main-surface-primary, #fff)) 96%, transparent); box-shadow: inset 0 1px 0 rgba(255,255,255,.025); transition: border-color 140ms ease, box-shadow 160ms ease, background 160ms ease; }
        .cgpt-queue-compose-row:focus-within { border-color: color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 24%, var(--cgfc-theme-border, rgba(127,127,127,.22))); box-shadow: 0 0 0 2px color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 7%, transparent), inset 0 1px 0 rgba(255,255,255,.03); }
        .cgpt-queue-compose-row.cgpt-queue-file-dragover { border-color: color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 58%, white 10%); background: color-mix(in srgb, var(--cgfc-theme-surface-primary, #212121) 93%, var(--cgfc-queue-accent-color, #6d5dfc) 7%); box-shadow: 0 0 0 3px color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 11%, transparent); }
        .cgpt-queue-draft-attachments { display: flex; flex-wrap: wrap; gap: 4px; }
        .cgpt-queue-draft-attachments:empty { display: none; }
        .cgpt-queue-compose textarea { box-sizing: border-box; min-width: 0; min-height: 28px; max-height: 112px; height: 28px; flex: 1; padding: 4px 2px 5px; resize: none; overflow-y: hidden; scrollbar-width: none; border: 0; border-radius: 0; background: transparent; color: var(--cgfc-queue-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616))); box-shadow: none !important; font: inherit; font-size: 1em; line-height: 1.45; outline: none; color-scheme: var(--cgfc-color-scheme, light); }
        .cgpt-queue-compose textarea::-webkit-scrollbar { display: none; }
        .cgpt-queue-compose textarea::placeholder { color: var(--cgfc-queue-muted-color, var(--cgfc-theme-text-tertiary, var(--text-tertiary, #888))); opacity: .86; }
        .cgpt-queue-edit-text.cgpt-queue-file-dragover { border-color: color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 52%, white 12%); background: color-mix(in srgb, var(--cgfc-theme-surface-primary, #212121) 93%, var(--cgfc-queue-accent-color, #6d5dfc) 7%); box-shadow: 0 0 0 3px color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 11%, transparent); }
        .cgpt-queue-enqueue { display: inline-grid; width: 36px; height: 36px; padding: 0; flex: none; place-items: center; border: 0; border-radius: 50%; background: var(--cgfc-queue-accent-color, #6d5dfc); color: #fff; box-shadow: inset 0 1px 0 rgba(255,255,255,.22), 0 3px 9px color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 16%, transparent); cursor: pointer; line-height: 1; transition: transform 140ms ease, box-shadow 160ms ease, filter 160ms ease, opacity 160ms ease; }
        .cgpt-queue-enqueue svg { width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-width: 2.35; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
        .cgpt-queue-enqueue:not(:disabled):hover { transform: translateY(-1px); filter: brightness(1.045); box-shadow: 0 5px 13px color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 22%, transparent), inset 0 1px 0 rgba(255,255,255,.26); }
        .cgpt-queue-enqueue:not(:disabled):active { transform: translateY(0) scale(.975); filter: brightness(.98); box-shadow: 0 2px 7px color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 18%, transparent), inset 0 2px 5px rgba(0,0,0,.20), inset 0 -1px 0 rgba(255,255,255,.10); }
        .cgpt-queue-enqueue:focus-visible { outline: 2px solid color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 60%, white 40%); outline-offset: 3px; }
        .cgpt-queue-enqueue:disabled { background: color-mix(in srgb, var(--cgfc-theme-surface-secondary, #2f2f2f) 84%, transparent); color: color-mix(in srgb, var(--cgfc-theme-text-tertiary, #888) 66%, transparent); box-shadow: inset 0 1px 0 rgba(255,255,255,.025); opacity: .78; cursor: default; }
        .cgpt-queue-footer { display: flex; min-height: 26px; padding: 0 12px 9px; align-items: center; gap: 7px; color: var(--cgfc-queue-muted-color, var(--cgfc-theme-text-tertiary, var(--text-tertiary, #888))); font-size: .79em; }
        .cgpt-queue-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; }
        .cgpt-queue-dot[data-state="paused"] { background: #f59e0b; }
        .cgpt-queue-dot[data-state="busy"] { background: var(--cgfc-queue-accent-color, #6d5dfc); }
        @media (max-width: 640px) {
          .cgpt-queue-capsule { min-height: 32px; padding: 5px 9px; }
          .cgpt-queue-panel { width: calc(100vw - 20px); max-height: calc(100dvh - 20px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .cgpt-queue-capsule,
          .cgpt-queue-icon-btn,
          .cgpt-queue-row,
          .cgpt-queue-row-actions button,
          .cgpt-queue-compose-row,
          .cgpt-queue-enqueue { transition: none !important; }
        }
      `;
      (document.head || document.documentElement)?.appendChild(style);
    }

    ensureRoot() {
      if (!document.body) return false;
      if (this.root?.isConnected) return true;
      const existing = document.getElementById('cgpt-unified-queue-dock');
      if (existing) existing.remove();

      const root = document.createElement('div');
      root.id = 'cgpt-unified-queue-dock';
      root.hidden = true;

      const capsule = document.createElement('button');
      capsule.type = 'button';
      capsule.className = 'cgpt-queue-capsule';
      capsule.title = '发送队列';
      capsule.setAttribute('aria-label', '打开发送队列');
      capsule.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 12h9M5 18h6M17 15v6M14 18h6"/></svg>';
      const capsuleLabel = document.createElement('span');
      capsuleLabel.textContent = '发送队列';
      const badge = document.createElement('span');
      badge.className = 'cgpt-queue-capsule-badge';
      badge.hidden = true;
      capsule.append(capsuleLabel, badge);
      capsule.addEventListener('click', () => this.open());

      const panel = document.createElement('section');
      panel.className = 'cgpt-queue-panel';
      panel.hidden = true;
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', '发送队列');

      const header = document.createElement('div');
      header.className = 'cgpt-queue-panel-header';
      const title = document.createElement('div');
      title.className = 'cgpt-queue-panel-title';
      title.textContent = '发送队列 · 0';
      const headerActions = document.createElement('div');
      headerActions.className = 'cgpt-queue-panel-actions';
      const pause = this.makeButton('暂停', '暂停自动发送');
      const clear = this.makeButton('清空', '清空待发送消息');
      const close = this.makeButton('×', '关闭发送队列');
      close.dataset.iconOnly = 'true';
      close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      pause.addEventListener('click', () => this.runtime.messageQueue?.togglePause?.());
      clear.addEventListener('click', () => {
        const items = this.runtime.messageQueue?.snapshot?.().items || [];
        const count = items.filter((item) => item.status !== 'sending').length;
        if (!count || window.confirm(`清空 ${count} 条待发送消息？`)) this.runtime.messageQueue?.clear?.();
      });
      close.addEventListener('click', () => this.close());
      headerActions.append(pause, clear, close);
      header.append(title, headerActions);

      const list = document.createElement('div');
      list.className = 'cgpt-queue-list';

      const compose = document.createElement('div');
      compose.className = 'cgpt-queue-compose';
      const draftAttachmentList = document.createElement('div');
      draftAttachmentList.className = 'cgpt-queue-draft-attachments';
      const composeRow = document.createElement('div');
      composeRow.className = 'cgpt-queue-compose-row';
      const input = document.createElement('textarea');
      input.rows = 1;
      input.placeholder = '输入待发送消息';
      input.setAttribute('aria-label', '发送队列输入框');
      const enqueue = document.createElement('button');
      enqueue.type = 'button';
      enqueue.className = 'cgpt-queue-enqueue';
      enqueue.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m0 0-5.25 5.25M12 5l5.25 5.25"/></svg>';
      enqueue.title = '加入发送队列';
      enqueue.setAttribute('aria-label', '加入发送队列');
      enqueue.disabled = true;
      const syncEnqueueDisabled = () => {
        enqueue.disabled = !String(input.value || '').trim() && !this.draftAttachments.length;
      };
      input.addEventListener('input', () => {
        syncEnqueueDisabled();
        this.syncTextareaHeight(input, 28, 112);
      });
      input.addEventListener('paste', (event) => {
        const files = this.extractClipboardFiles(event);
        if (!files.length) return;
        this.mergeDraftFiles(files);
        syncEnqueueDisabled();
        this.renderDraftAttachments();
        // Do not preventDefault: when clipboard also contains plain text, keep
        // the textarea's native paste behavior while capturing file payloads.
      });
      composeRow.addEventListener('dragover', (event) => {
        if (!this.hasFileTransfer(event.dataTransfer)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        composeRow.classList.add('cgpt-queue-file-dragover');
      });
      composeRow.addEventListener('dragleave', (event) => {
        if (!composeRow.contains(event.relatedTarget)) composeRow.classList.remove('cgpt-queue-file-dragover');
      });
      composeRow.addEventListener('drop', (event) => {
        if (!this.hasFileTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        const files = this.extractDataTransferFiles(event.dataTransfer);
        composeRow.classList.remove('cgpt-queue-file-dragover');
        if (!files.length) return;
        this.mergeDraftFiles(files);
        syncEnqueueDisabled();
        this.renderDraftAttachments();
        input.focus({ preventScroll: true });
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          this.close();
          return;
        }
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
        event.preventDefault();
        this.enqueueInput();
      });
      enqueue.addEventListener('click', () => this.enqueueInput());
      composeRow.append(input, enqueue);
      compose.append(draftAttachmentList, composeRow);

      const footer = document.createElement('div');
      footer.className = 'cgpt-queue-footer';
      const dot = document.createElement('span');
      dot.className = 'cgpt-queue-dot';
      const status = document.createElement('span');
      status.textContent = 'Enter 入队 · Shift+Enter 换行 · 拖入/粘贴附件';
      footer.append(dot, status);

      panel.append(header, list, compose, footer);
      root.append(capsule, panel);
      document.body.appendChild(root);

      this.root = root;
      this.capsule = capsule;
      this.capsuleLabel = capsuleLabel;
      this.capsuleBadge = badge;
      this.panel = panel;
      this.countLabel = title;
      this.pauseButton = pause;
      this.clearButton = clear;
      this.list = list;
      this.input = input;
      this.draftAttachmentList = draftAttachmentList;
      this.enqueueButton = enqueue;
      this.status = status;
      this.statusDot = dot;
      this.capsule.hidden = this.isOpen;
      this.panel.hidden = !this.isOpen;
      this.renderDraftAttachments();
      this.syncTextareaHeight(input, 28, 112);
      return true;
    }

    makeButton(text, title) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cgpt-queue-icon-btn';
      button.textContent = text;
      button.title = title;
      button.setAttribute('aria-label', title || text);
      return button;
    }

    syncTextareaHeight(textarea, minHeight = 28, maxHeight = 112) {
      if (!(textarea instanceof HTMLTextAreaElement)) return;
      textarea.style.height = '0px';
      const scrollHeight = Math.max(minHeight, textarea.scrollHeight || minHeight);
      const height = Math.min(maxHeight, scrollHeight);
      textarea.style.height = `${height}px`;
      textarea.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
    }

    refreshEditingView(editor, forceFocus = false) {
      const hadFocus = forceFocus || document.activeElement === editor;
      const selectionStart = editor instanceof HTMLTextAreaElement ? editor.selectionStart : null;
      const selectionEnd = editor instanceof HTMLTextAreaElement ? editor.selectionEnd : null;
      this.render();
      const next = this.list?.querySelector?.('.cgpt-queue-edit-text');
      if (!(next instanceof HTMLTextAreaElement)) return;
      this.syncTextareaHeight(next, 48, 140);
      if (!hadFocus) return;
      next.focus({ preventScroll: true });
      if (Number.isInteger(selectionStart) && Number.isInteger(selectionEnd)) {
        const length = next.value.length;
        try { next.setSelectionRange(Math.min(selectionStart, length), Math.min(selectionEnd, length)); } catch {}
      }
    }

    makeRowActionButton(svgPath, title, ariaLabel = title) {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = title;
      button.setAttribute('aria-label', ariaLabel);
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${svgPath}"/></svg>`;
      return button;
    }

    hasFileTransfer(dataTransfer) {
      if (!dataTransfer) return false;
      if (Array.from(dataTransfer.files || []).length) return true;
      if (Array.from(dataTransfer.items || []).some((item) => item?.kind === 'file')) return true;
      return Array.from(dataTransfer.types || []).some((type) => String(type).toLowerCase() === 'files');
    }

    extractDataTransferFiles(dataTransfer) {
      if (!dataTransfer) return [];
      const files = [];
      const seen = new Set();
      const add = (file) => {
        if (!(file instanceof File)) return;
        const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
        if (seen.has(key)) return;
        seen.add(key);
        files.push(file);
      };
      Array.from(dataTransfer.files || []).forEach(add);
      Array.from(dataTransfer.items || []).forEach((item) => {
        if (item?.kind !== 'file') return;
        try { add(item.getAsFile?.()); } catch {}
      });
      return files;
    }

    extractClipboardFiles(event) {
      return this.extractDataTransferFiles(event?.clipboardData);
    }

    mergeDraftFiles(files) {
      const existing = new Set(this.draftAttachments.map((file) => `${file.name}:${file.size}:${file.type}:${file.lastModified}`));
      for (const file of files) {
        const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
        if (existing.has(key)) continue;
        this.draftAttachments.push(file);
        existing.add(key);
      }
    }

    mergeEditFiles(files) {
      if (!this.editDraft) return;
      const existing = new Set(this.editDraft.attachments.map((attachment) => {
        const file = attachment?.file || attachment;
        return `${file?.name || ''}:${file?.size || 0}:${file?.type || ''}:${file?.lastModified || 0}`;
      }));
      for (const file of files) {
        const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
        if (existing.has(key)) continue;
        this.editDraft.attachments.push({
          file,
          name: file.name,
          type: file.type,
          size: file.size,
          lastModified: file.lastModified,
        });
        existing.add(key);
      }
    }

    enqueueInput() {
      const content = String(this.input?.value || '').trim();
      const attachments = [...this.draftAttachments];
      if (!content && !attachments.length) return;
      const item = this.runtime.messageQueue?.enqueue?.(content, { source: 'composer-dock' }, attachments);
      if (!item) return;
      this.input.value = '';
      this.draftAttachments = [];
      if (this.enqueueButton) this.enqueueButton.disabled = true;
      this.renderDraftAttachments();
      this.syncTextareaHeight(this.input, 28, 112);
      this.input.focus({ preventScroll: true });
      this.render();
      // Some synthetic/IME key paths can apply a trailing line break after
      // keydown even though it was prevented. Clean only whitespace so a real
      // user keystroke can never be erased.
      window.setTimeout(() => {
        if (this.input && !String(this.input.value || '').trim()) {
          this.input.value = '';
          this.syncTextareaHeight(this.input, 28, 112);
        }
      }, 0);
    }

    formatFileSize(bytes) {
      const value = Math.max(0, Number(bytes || 0));
      if (value < 1024) return `${value} B`;
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
      return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
    }

    makeAttachmentChip(attachment, onRemove = null) {
      const file = attachment?.file || attachment;
      const name = String(attachment?.name || file?.name || '附件');
      const size = Number(attachment?.size ?? file?.size ?? 0);
      const chip = document.createElement('span');
      chip.className = 'cgpt-queue-attachment';
      chip.title = size ? `${name} · ${this.formatFileSize(size)}` : name;
      const icon = document.createElement('span');
      icon.className = 'cgpt-queue-attachment-icon';
      const isImage = String(attachment?.type || file?.type || '').startsWith('image/');
      icon.innerHTML = isImage
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="m6.5 16 3.6-3.8 2.8 2.7 2.2-2.2 2.9 3.3M9 9h.01"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h6l4 4V20H7zM13 3.5V8h4M9.5 12h5M9.5 15.5h5"/></svg>';
      const label = document.createElement('span');
      label.className = 'cgpt-queue-attachment-name';
      label.textContent = name;
      chip.append(icon, label);
      if (typeof onRemove === 'function') {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'cgpt-queue-attachment-remove';
        remove.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7m0-7-7 7"/></svg>';
        remove.title = `移除 ${name}`;
        remove.setAttribute('aria-label', `移除 ${name}`);
        remove.addEventListener('click', (event) => {
          event.stopPropagation();
          onRemove();
        });
        chip.appendChild(remove);
      }
      return chip;
    }

    renderDraftAttachments() {
      if (!this.draftAttachmentList) return;
      const fragment = document.createDocumentFragment();
      this.draftAttachments.forEach((file, index) => {
        fragment.appendChild(this.makeAttachmentChip(file, () => {
          this.draftAttachments.splice(index, 1);
          if (this.enqueueButton) {
            this.enqueueButton.disabled = !String(this.input?.value || '').trim() && !this.draftAttachments.length;
          }
          this.renderDraftAttachments();
        }));
      });
      this.draftAttachmentList.replaceChildren(fragment);
    }

    startEditItem(item) {
      if (!item || item.status === 'sending') return;
      this.editDraft = {
        id: item.id,
        content: String(item.content || ''),
        attachments: (Array.isArray(item.attachments) ? item.attachments : []).map((attachment) => ({ ...attachment })),
      };
      const started = this.runtime.messageQueue?.beginEdit?.(item.id);
      if (!started) {
        this.editDraft = null;
        return;
      }
      window.setTimeout(() => {
        const editor = this.list?.querySelector?.('.cgpt-queue-edit-text');
        if (editor instanceof HTMLTextAreaElement) editor.focus({ preventScroll: true });
      }, 0);
    }

    saveEditItem(id) {
      if (!this.editDraft || this.editDraft.id !== id) return;
      const content = String(this.editDraft.content || '').trim();
      const attachments = [...this.editDraft.attachments];
      if (!content && !attachments.length) {
        window.alert('队列消息不能同时没有文字和附件。');
        return;
      }
      const saved = this.runtime.messageQueue?.update?.(id, content, attachments);
      if (!saved) return;
      this.editDraft = null;
      this.render();
    }

    cancelEditItem(id) {
      this.editDraft = null;
      this.runtime.messageQueue?.cancelEdit?.(id);
      this.render();
    }

    open() {
      if (!this.ensureRoot()) return;
      this.isOpen = true;
      this.capsule.hidden = true;
      this.panel.hidden = false;
      this.render();
      this.schedulePosition();
      window.setTimeout(() => {
        this.syncTextareaHeight(this.input, 28, 112);
        this.input?.focus({ preventScroll: true });
      }, 0);
    }

    close() {
      if (!this.root) return;
      const editingId = this.runtime.messageQueue?.snapshot?.().editingItemId;
      if (editingId) {
        this.editDraft = null;
        this.runtime.messageQueue?.cancelEdit?.(editingId);
      }
      this.isOpen = false;
      this.panel.hidden = true;
      this.capsule.hidden = false;
      this.schedulePosition();
    }

    render() {
      if (!this.ensureRoot()) return;
      const queue = this.runtime.messageQueue;
      const snapshot = queue?.snapshot?.() || { items: [], isPaused: false };
      const items = snapshot.items || [];
      const count = items.length;
      this.capsuleLabel.textContent = count ? '队列' : '发送队列';
      this.capsuleBadge.textContent = String(count);
      this.capsuleBadge.hidden = count === 0;
      this.countLabel.textContent = `发送队列 · ${count}`;
      this.pauseButton.textContent = snapshot.isPaused ? '继续' : '暂停';
      this.pauseButton.title = snapshot.isPaused ? '继续自动发送' : '暂停自动发送';
      this.clearButton.disabled = !items.some((item) => item.status !== 'sending');
      this.clearButton.title = items.some((item) => item.status === 'sending')
        ? '清空待发送消息（发送中的消息会保留）'
        : '清空待发送消息';
      if (!snapshot.editingItemId && this.editDraft) this.editDraft = null;

      const fragment = document.createDocumentFragment();
      if (!count) {
        const empty = document.createElement('div');
        empty.className = 'cgpt-queue-empty';
        empty.textContent = snapshot.isPaused ? '队列为空，当前已暂停' : '队列为空';
        fragment.appendChild(empty);
      }
      const labels = { pending: '等待', sending: '发送中', failed: '失败' };
      items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'cgpt-queue-row';
        row.dataset.status = item.status || 'pending';
        const idx = document.createElement('span');
        idx.className = 'cgpt-queue-index';
        idx.textContent = String(index + 1);
        const main = document.createElement('div');
        main.className = 'cgpt-queue-main';
        const isEditing = snapshot.editingItemId === item.id;
        if (isEditing) {
          if (!this.editDraft || this.editDraft.id !== item.id) {
            this.editDraft = {
              id: item.id,
              content: String(item.content || ''),
              attachments: (Array.isArray(item.attachments) ? item.attachments : []).map((attachment) => ({ ...attachment })),
            };
          }
          const editor = document.createElement('textarea');
          editor.className = 'cgpt-queue-edit-text';
          editor.value = this.editDraft.content;
          editor.setAttribute('aria-label', `编辑队列消息 ${index + 1}`);
          editor.addEventListener('input', () => {
            this.editDraft.content = editor.value;
            this.syncTextareaHeight(editor, 48, 140);
          });
          editor.addEventListener('paste', (event) => {
            const files = this.extractClipboardFiles(event);
            if (!files.length) return;
            this.mergeEditFiles(files);
            // Keep native text paste, then re-render attachment chips after the
            // textarea input event has synchronized editDraft.content.
            window.setTimeout(() => this.refreshEditingView(editor, true), 0);
          });
          editor.addEventListener('dragover', (event) => {
            if (!this.hasFileTransfer(event.dataTransfer)) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
            editor.classList.add('cgpt-queue-file-dragover');
          });
          editor.addEventListener('dragleave', () => {
            editor.classList.remove('cgpt-queue-file-dragover');
          });
          editor.addEventListener('drop', (event) => {
            if (!this.hasFileTransfer(event.dataTransfer)) return;
            event.preventDefault();
            event.stopPropagation();
            const files = this.extractDataTransferFiles(event.dataTransfer);
            editor.classList.remove('cgpt-queue-file-dragover');
            if (!files.length) return;
            this.mergeEditFiles(files);
            this.refreshEditingView(editor, true);
          });
          editor.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              this.cancelEditItem(item.id);
            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              this.saveEditItem(item.id);
            }
          });
          main.appendChild(editor);
          window.setTimeout(() => {
            if (editor.isConnected) this.syncTextareaHeight(editor, 48, 140);
          }, 0);

          const editAttachments = document.createElement('div');
          editAttachments.className = 'cgpt-queue-attachments';
          this.editDraft.attachments.forEach((attachment, attachmentIndex) => {
            editAttachments.appendChild(this.makeAttachmentChip(attachment, () => {
              if (!this.editDraft || this.editDraft.id !== item.id) return;
              this.editDraft.attachments.splice(attachmentIndex, 1);
              this.render();
            }));
          });
          main.appendChild(editAttachments);

          const editTools = document.createElement('div');
          editTools.className = 'cgpt-queue-edit-tools';
          const save = document.createElement('button');
          save.type = 'button';
          save.className = 'cgpt-queue-mini-btn';
          save.textContent = '保存';
          save.title = '保存修改（Ctrl/⌘ + Enter）';
          save.addEventListener('click', () => this.saveEditItem(item.id));
          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.className = 'cgpt-queue-mini-btn';
          cancel.textContent = '取消';
          cancel.addEventListener('click', () => this.cancelEditItem(item.id));
          editTools.append(save, cancel);
          main.appendChild(editTools);
        } else {
          const text = document.createElement('div');
          text.className = 'cgpt-queue-text';
          const normalizedText = String(item.content || '').replace(/\s+/g, ' ').trim();
          text.textContent = normalizedText || '（仅附件）';
          text.title = String(item.content || '');
          main.appendChild(text);

          const attachments = document.createElement('div');
          attachments.className = 'cgpt-queue-attachments';
          (Array.isArray(item.attachments) ? item.attachments : []).forEach((attachment) => {
            attachments.appendChild(this.makeAttachmentChip(attachment));
          });
          main.appendChild(attachments);
        }
        const itemStatus = document.createElement('div');
        itemStatus.className = 'cgpt-queue-item-status';
        itemStatus.textContent = item.error
          ? `${labels[item.status] || item.status || '失败'} · ${item.error}`
          : item.status === 'pending' && queue?.isItemOnCurrentConversation?.(item) === false
          ? '等待原会话'
          : labels[item.status] || item.status || '等待';
        main.appendChild(itemStatus);
        const actions = document.createElement('div');
        actions.className = 'cgpt-queue-row-actions';
        const sendNow = this.makeRowActionButton(
          'M22 2 9 15M22 2l-7 20-4-9-9-4z',
          '立即发送这条消息，跳过自动队列等待',
          `立即发送队列消息 ${index + 1}`
        );
        sendNow.className = 'cgpt-queue-send-now';
        const sendNowLabel = document.createElement('span');
        sendNowLabel.textContent = '立即发送';
        sendNow.appendChild(sendNowLabel);
        sendNow.disabled = Boolean(snapshot.editingItemId) || snapshot.isProcessing || item.status === 'sending';
        sendNow.addEventListener('click', () => queue?.sendNow?.(item.id));
        actions.appendChild(sendNow);
        if (!isEditing && item.status !== 'sending') {
          const edit = this.makeRowActionButton(
            'M4.5 19.5 8 18.8 18.2 8.6a2.1 2.1 0 0 0-3-3L4.8 15.8zM13.8 7l3 3',
            '编辑消息和附件',
            `编辑队列消息 ${index + 1}`
          );
          edit.addEventListener('click', () => this.startEditItem(item));
          actions.appendChild(edit);
        }
        if (!isEditing && item.status === 'failed') {
          const retry = this.makeRowActionButton(
            'M20 11a8 8 0 1 1-2.34-5.66L20 7.7M20 3.5v4.2h-4.2',
            '重试'
          );
          retry.addEventListener('click', () => queue?.retry?.(item.id));
          actions.appendChild(retry);
        }
        const removeTitle = isEditing ? '编辑中，请先保存或取消' : item.status === 'sending' ? '发送中，暂不能移出' : '移出队列';
        const remove = this.makeRowActionButton('M6 6l12 12M18 6 6 18', removeTitle);
        remove.disabled = isEditing || item.status === 'sending';
        remove.addEventListener('click', () => queue?.remove?.(item.id));
        actions.appendChild(remove);
        row.append(idx, main, actions);
        fragment.appendChild(row);
      });
      this.list.replaceChildren(fragment);

      const generating = Boolean(this.runtime.isGenerating?.());
      this.statusDot.dataset.state = snapshot.editingItemId || snapshot.isPaused ? 'paused' : generating ? 'busy' : 'idle';
      if (snapshot.editingItemId) this.status.textContent = '正在编辑队列消息，自动发送暂缓';
      else if (snapshot.isPaused) this.status.textContent = '已暂停自动发送';
      else if (generating) this.status.textContent = count ? '等待当前回答完成后继续' : '当前正在生成回答';
      else if (count) this.status.textContent = '等待空闲后自动发送下一条';
      else this.status.textContent = 'Enter 入队 · Shift+Enter 换行 · 拖入/粘贴附件';
    }

    resolveComposerShell(composer) {
      if (!(composer instanceof Element)) return null;
      // The native surface owns attachments and the expanded editor as well.
      // A short draft may occupy only a few lines inside a viewport-sized card;
      // never reject this explicit owner based on the draft's text height.
      const explicitSurface = composer.closest('[data-composer-surface="true"], [data-composer-surface-variant]')
        || composer.closest('[class*="ComposerLayoutRoot-"][data-composer-layout]');
      if (explicitSurface instanceof Element) {
        const rect = explicitSurface.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return explicitSurface;
      }

      const sendButton = this.runtime.promptLibrary?.findSendButton?.(composer) || null;
      const composerRect = composer.getBoundingClientRect();
      const maxShellHeight = Math.max(180, composerRect.height * 4.5);
      const maxTopDrift = Math.max(120, composerRect.height * 3);
      const candidates = [];
      let node = composer.parentElement;

      for (let depth = 0; node && node !== document.body && depth < 12; depth += 1, node = node.parentElement) {
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const coversComposer = rect.left <= composerRect.left + 2
          && rect.right >= composerRect.right - 2
          && rect.top <= composerRect.top + 2
          && rect.bottom >= composerRect.bottom - 2;
        if (!coversComposer) continue;

        const topDrift = Math.max(0, composerRect.top - rect.top);
        if (rect.height > maxShellHeight || topDrift > maxTopDrift) continue;

        const radius = Number.parseFloat(getComputedStyle(node).borderRadius || '0') || 0;
        const explicit = node.matches('[data-composer-surface="true"], [data-composer-surface-variant]');
        const semantic = node.matches('form[data-type*="composer" i], form[class*="composer" i], [data-testid*="composer" i], [data-chatgpt-composer]');
        const genericForm = node.tagName === 'FORM';
        const containsSend = Boolean(sendButton && node.contains(sendButton));
        const widthGain = Math.max(0, rect.width - composerRect.width);
        let score = 0;
        if (explicit) score += 20;
        if (containsSend) score += 10;
        if (semantic) score += 8;
        else if (genericForm) score += 5;
        if (radius >= 12) score += 4;
        // 真正的 composer 外壳通常比文本编辑区更宽，因为右侧还包含模型、语音/发送等控件。
        // 在高度已受约束的前提下，适度奖励横向扩展，避免空输入框时锚到窄内层。
        score += Math.min(7, widthGain / 55);
        score -= Math.min(4, topDrift / 40);
        score -= Math.min(3, Math.max(0, rect.height - composerRect.height) / 60);
        candidates.push({ node, score, depth });
      }

      candidates.sort((a, b) => b.score - a.score || a.depth - b.depth);
      return candidates[0]?.node || composer;
    }

    scheduleMutationPosition(records) {
      const ownUi = '#cgpt-unified-queue-dock, #cgpt-unified-token-stats, [data-cgpt-token-chip]';
      const composerSelector = '#prompt-textarea, .ProseMirror[contenteditable="true"], textarea[name="prompt-textarea"], [contenteditable="true"][role="textbox"]';
      const composerChanged = records.some((record) => {
        const target = record.target?.nodeType === Node.ELEMENT_NODE
          ? record.target : record.target?.parentElement;
        if (target?.closest?.(ownUi)) return false;
        if (this.observedShell && (target === this.observedShell || this.observedShell.contains(target))) return true;
        const changed = [...record.addedNodes, ...record.removedNodes];
        return changed.some((node) => node instanceof Element && (
          node.matches(`${composerSelector}, ${GLASS_SCROLL_SELECTOR}`) || node.querySelector(`${composerSelector}, ${GLASS_SCROLL_SELECTOR}`)
        ));
      });
      if (!composerChanged || this.mutationPositionTimer) return;
      // Streamed answer DOM can change every frame. Scroll/resize still use rAF directly.
      this.mutationPositionTimer = window.setTimeout(() => {
        this.mutationPositionTimer = 0;
        this.schedulePosition(true);
      }, 120);
    }

    observeShell(shell) {
      if (this.observedShell === shell && this.observedQueueRoot === this.root) return;
      this.observedQueueRoot = this.root;
      this.resizeObserver?.disconnect?.();
      this.resizeObserver = null;
      this.observedShell = shell;
      if (!(shell instanceof Element) || typeof ResizeObserver !== 'function') return;
      this.resizeObserver = new ResizeObserver(() => this.schedulePosition());
      // Async fonts, badge text and opening the panel can change the floating
      // controls without changing the composer. Observe all three size owners.
      for (const target of [shell, this.capsule, this.panel]) {
        if (target instanceof Element) this.resizeObserver.observe(target);
      }
    }

    schedulePosition(refreshGlass = false) {
      this.glassRefreshPending ||= refreshGlass;
      if (this.positionRaf) return;
      this.positionRaf = this.runtime.pageWork.requestLayout(() => {
        this.positionRaf = 0;
        return this.preparePosition();
      });
    }

    refreshPosition() { this.schedulePosition(); }

    preparePosition() {
      if (!this.ensureRoot()) return;
      const refreshGlass = this.glassRefreshPending;
      this.glassRefreshPending = false;
      const composer = this.runtime.promptLibrary?.findComposer?.();
      if (!composer) {
        this.runtime.composerLiquidGlass?.attach(null);
        this.runtime.surfaceLiquidGlass?.refresh(null);
        this.root.hidden = true;
        return;
      }
      const shell = this.resolveComposerShell(composer);
      if (!(shell instanceof Element) || !shell.isConnected) {
        this.runtime.composerLiquidGlass?.attach(null);
        this.runtime.surfaceLiquidGlass?.refresh(null);
        this.root.hidden = true;
        return;
      }
      if (this.neumorphicShell !== shell) {
        if (this.neumorphicShell instanceof Element && this.neumorphicShell.isConnected) {
          this.neumorphicShell.removeAttribute('data-cgfc-neumorphic-composer');
        }
        this.neumorphicShell = shell;
      }
      if (shell.getAttribute('data-cgfc-neumorphic-composer') !== 'true') {
        shell.setAttribute('data-cgfc-neumorphic-composer', 'true');
      }
      if (this.runtime.composerLiquidGlass?.candidate !== shell) this.runtime.composerLiquidGlass?.attach(shell);
      if (refreshGlass || this.runtime.surfaceLiquidGlass?.composerShell !== shell) {
        this.runtime.surfaceLiquidGlass?.refresh(shell);
        this.runtime.pageWork.invalidate();
      }
      const rect = this.runtime.pageWork.rect(shell);
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
        this.root.hidden = true;
        return;
      }
      this.observeShell(shell);
      this.root.hidden = false;

      const visualViewport = window.visualViewport;
      const viewportLeft = Math.max(0, visualViewport?.offsetLeft || 0);
      const viewportTop = Math.max(0, visualViewport?.offsetTop || 0);
      const viewportWidth = Math.max(240, visualViewport?.width || document.documentElement.clientWidth || window.innerWidth || 320);
      const viewportHeight = Math.max(240, visualViewport?.height || document.documentElement.clientHeight || window.innerHeight || 320);
      const viewportRight = viewportLeft + viewportWidth;
      const viewportBottom = viewportTop + viewportHeight;
      const edge = 10;
      const rootStyles = getComputedStyle(document.documentElement);
      const preferredPanelWidth = Number.parseFloat(rootStyles.getPropertyValue('--cgfc-queue-panel-width')) || 420;
      const panelWidth = Math.round(Math.min(Math.max(280, preferredPanelWidth), viewportWidth - edge * 2) * 100) / 100;
      const availableAbove = Math.max(120, rect.top - viewportTop - edge - 6);
      const panelHeight = Math.round(Math.min(440, viewportHeight - edge * 2, availableAbove) * 100) / 100;
      const writes = [];
      if (this.panel.style.width !== panelWidth + 'px' || this.panel.style.maxHeight !== panelHeight + 'px') writes.push(() => {
        this.panel.style.width = panelWidth + 'px'; this.panel.style.maxHeight = panelHeight + 'px'; this.schedulePosition(); this.runtime.tokenStats?.schedulePosition();
      });

      const positionAboveComposer = (element, width) => {
        if (element.hidden) return;
        const elementRect = this.runtime.pageWork.rect(element);
        const safeWidth = Math.max(1, width || elementRect.width || 1);
        const safeHeight = Math.max(1, Math.min(elementRect.height || 1, element === this.panel ? panelHeight : Infinity));
        const left = Math.round(Math.min(
          viewportRight - edge - safeWidth,
          Math.max(viewportLeft + edge, rect.right - safeWidth - 10),
        ) * 100) / 100;
        const top = Math.round(Math.min(
          viewportBottom - edge - safeHeight,
          Math.max(viewportTop + edge, rect.top - safeHeight - 6),
        ) * 100) / 100;
        this.runtime.pageWork.planRect(element, new DOMRect(left, top, safeWidth, safeHeight));
        const moved = element.style.left !== left + 'px' || element.style.top !== top + 'px';
        if (!moved && !element.style.right && !element.style.bottom) return;
        writes.push(() => {
        if (element.style.right) element.style.removeProperty('right');
        if (element.style.bottom) element.style.removeProperty('bottom');
        if (element.style.left !== `${left}px`) element.style.left = `${left}px`;
        if (element.style.top !== `${top}px`) element.style.top = `${top}px`;
        if (moved) this.runtime.tokenStats?.schedulePosition();
        });
      };

      if (!this.capsule.hidden) positionAboveComposer(this.capsule, this.runtime.pageWork.rect(this.capsule).width);
      positionAboveComposer(this.panel, panelWidth);
      if (writes.length) return () => { if (!this.root?.isConnected) return; for (const write of writes) write(); };
    }
  }


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
      --cgfc-glass-tint: 26,29,33;
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
        try { worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
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
  window.addEventListener('pagehide', () => glassMapService.stop());

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
        renderMode: document.documentElement.getAttribute(this.options.kind ? 'data-cgfc-' + this.options.kind + '-glass-render-mode' : 'data-cgfc-glass-render-mode') || 'balanced' };
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
      const rawRadius = this.options.kind === 'message' ? parsedRadius : parsedRadius || 26;
      const radius = Math.min(width / 2, height / 2, rawRadius);
      if (!this.options.direct) for (const key of ['effect', 'tint', 'rim', 'sheen']) {
        if (this[key]?.style.getPropertyValue('border-radius') !== radius + 'px') this[key]?.style.setProperty('border-radius', radius + 'px', 'important');
      }
      this.blurPx = optics.blur;
      if (shell.getAttribute('data-cgfc-glass-finish') !== optics.finish) shell.setAttribute('data-cgfc-glass-finish', optics.finish);
      const dark = document.documentElement.matches('html.dark:not([data-cgfc-theme="light"]),html[data-cgfc-theme="dark"]');
      this.setSurfaceStyle('--cgfc-glass-fill', String(optics.opacity));
      // Message cards already have their own explicit brightness/saturation
      // controls. Other surfaces derive these from their own clear/soft style.
      if (this.options.kind !== 'message') {
        this.setSurfaceStyle('--cgfc-glass-saturation', optics.soft ? '1.12' : '1.08');
        this.setSurfaceStyle('--cgfc-glass-luminance', String(dark ? (optics.soft ? .96 : .98) : 1));
      }
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
      const svg = make('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' });
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

  const GLASS_SCROLL_SELECTOR = [
    'button[class~="group/scroll-to-bottom"]', 'button[data-testid="scroll-to-bottom"]', 'button[data-testid="scroll-to-top"]',
    'button[aria-label="滚动到底部"]', 'button[aria-label="滚动到顶部"]',
    'button[aria-label="Scroll to bottom" i]', 'button[aria-label="Scroll to top" i]', 'button[aria-label="Jump to bottom" i]',
  ].join(',');
  // Additional surfaces share the material but retain independent enable flags.
  // Direct backdrop painting stays pinned when a settings panel scrolls and
  // does not insert unmanaged children into React-owned native buttons.
  // The browser may serialize a native color as rgb(), color(srgb), oklch(),
  // etc. Keep that CSS color intact. Only classification needs an sRGB sample;
  // normal RGB colors take a fast path, and other colors use one cached pixel
  // when a native button state changes, never a conversation snapshot/frame loop.
  const nativeGlassTint = (() => {
    const cache = new Map(); let context = null;
    return color => {
      if (!color || !CSS.supports('color', color)) return null;
      if (cache.has(color)) return cache.get(color);
      let channels = null;
      const rgb = color.match(/^rgba?\(([^)]+)\)$/i);
      if (rgb && !rgb[1].includes('%')) {
        const values = rgb[1].trim().split(/[,\s/]+/).map(Number);
        if (values.length >= 3 && values.every(Number.isFinite)) channels = [...values.slice(0, 3), values[3] ?? 1];
      }
      if (!channels) {
        try {
          if (!context) { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' }); }
          if (context) {
            context.clearRect(0, 0, 1, 1); context.fillStyle = 'rgba(0,0,0,0)'; context.fillStyle = color; context.fillRect(0, 0, 1, 1);
            const pixel = context.getImageData(0, 0, 1, 1).data;
            channels = [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
          }
        } catch (_) { /* A neutral tint remains available when sampling is unavailable. */ }
      }
      const result = channels && channels[3] > 0 && Math.max(...channels.slice(0, 3)) - Math.min(...channels.slice(0, 3)) > 12 ? color : null;
      if (cache.size >= 32) cache.delete(cache.keys().next().value);
      cache.set(color, result); return result;
    };
  })();

  function nativeGlassPaintKey(node) {
    if (!(node instanceof Element)) return '';
    const properties = Array.from(node.style).filter(name => /^(?:background(?:-color|-image)?|color)$/.test(name)
      || (name.startsWith('--') && !/^--cg(?:fc|pt)-/.test(name) && /color|background|surface|accent|primary/.test(name)));
    return String(node.className) + ';' + properties.sort().map(name => name + ':' + node.style.getPropertyValue(name)).join(';');
  }

  function nativeGlassButtonState(button, shell) {
    if (!button) return '';
    const parts = [button.getAttribute('aria-label'), button.getAttribute('data-testid'), document.documentElement.className, document.documentElement.getAttribute('data-cgfc-theme')];
    for (let node = button, depth = 0; node instanceof Element && depth < 10; node = node.parentElement, depth++) {
      parts.push(nativeGlassPaintKey(node));
      if (node === shell) break;
    }
    return parts.join('|');
  }

  function readNativeGlassTint(button) {
    const marker = button.getAttribute('data-cgfc-liquid-surface');
    // Unmask only our paint rule for the native-color read. Keep the SVG/filter
    // and geometry cache alive across send/voice/stop and native color changes.
    if (marker !== null) button.removeAttribute('data-cgfc-liquid-surface');
    try { return nativeGlassTint(getComputedStyle(button).backgroundColor); }
    finally { if (marker !== null) button.setAttribute('data-cgfc-liquid-surface', marker); }
  }

  class SupplementaryLiquidGlass {
    constructor(runtime) {
      this.runtime = runtime; this.raf = 0; this.composerShell = null;
      this.shadowStyles = new Map(); this.controllers = new Map(); this.scrollControllers = new Map();
      this.nativePaintStamps = new WeakMap();
      const specs = [
        ['toolboxPanel', 'toolbox', 'data-cgfc-toolbox-liquid-glass'],
        ['toolboxLauncher', 'toolbox', 'data-cgfc-toolbox-liquid-glass'],
        ['settings', 'settings', 'data-cgfc-settings-liquid-glass'],
        ['queuePanel', 'queue', 'data-cgfc-queue-liquid-glass'],
        ['queueCapsule', 'queue', 'data-cgfc-queue-liquid-glass'],
        ['send', 'send', 'data-cgfc-send-liquid-glass'],
        ['composerTools', 'tools', 'data-cgfc-composer-tools-liquid-glass'],
        ['stats', 'stats', 'data-cgfc-token-liquid-glass'],
        ['toggle', 'toggle', 'data-cgfc-toggle-liquid-glass'],
      ];
      for (const [name, kind, enabledAttribute] of specs) {
        this.controllers.set(name, new ComposerLiquidGlass(runtime, { kind, enabledAttribute, direct: true, sharedStyle: true, managed: true }));
      }
      this.onSettings = () => { glassOpticsFrameValue = null; this.schedule(); for (const controller of this.allControllers()) controller.schedule(); };
      this.onVisibility = () => {
        for (const controller of [this.runtime.composerLiquidGlass, ...this.allControllers()]) {
          if (document.hidden) controller?.pause(); else controller?.schedule();
        }
      };
      document.addEventListener('cgpt-unified-ui-settings-change', this.onSettings);
      document.addEventListener('DOMContentLoaded', this.onSettings, { once: true });
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('resize', this.onSettings, { passive: true });
      this.schedule();
    }

    schedule() {
      if (this.raf) return;
      this.raf = this.runtime.pageWork.requestFrame(() => { this.raf = 0; this.refresh(); });
    }

    allControllers() { return [...this.controllers.values(), ...this.scrollControllers.values()]; }

    bind(name, target, suppliedController) {
      const controller = suppliedController || this.controllers.get(name);
      const next = target instanceof Element && target.isConnected ? target : null;
      const enabled = document.documentElement.hasAttribute(controller.options.enabledAttribute);
      const nativeState = name === 'send' && next ? nativeGlassButtonState(next, this.composerShell) : '';
      const sameTarget = controller.candidate === next && controller.shell === (enabled ? next : null);
      if (sameTarget && (name !== 'send' || controller.nativeState === nativeState)) return;
      controller.nativeState = nativeState;
      if (next?.hasAttribute('data-cgfc-liquid-surface') && controller.shell !== next) {
        // A framework clone can carry our old marker and filter URL. Read its
        // native colour only after removing those inherited decorations.
        next.removeAttribute('data-cgfc-liquid-surface');
        next.removeAttribute(controller.modeAttribute);
        next.style.removeProperty('--cgfc-glass-filter');
        next.style.removeProperty('--cgfc-glass-send-color');
      }
      const sendColor = name === 'send' && next && enabled ? readNativeGlassTint(next) : null;
      controller.attach(next);
      if (name === 'send' && controller.shell) {
        if (sendColor) next.style.setProperty('--cgfc-glass-send-color', sendColor);
        else next.style.removeProperty('--cgfc-glass-send-color');
      }
    }

    refresh(shell) {
      if (shell !== undefined) this.composerShell = shell?.isConnected ? shell : null;
      else if (!this.composerShell?.isConnected) this.composerShell = this.runtime.composerQueueDock?.neumorphicShell || null;
      const host = document.getElementById('cgpt-answer-toc-host');
      const shadow = host?.shadowRoot;
      if (shadow && !this.shadowStyles.has(shadow)) {
        const style = document.createElement('style');
        style.setAttribute('data-cgfc-shared-glass-style', '');
        // Theme variables inherit from html; html selectors cannot match inside
        // this shadow tree. Preserve the host's normal isolation when disabled.
        const start = GLASS_STYLE.indexOf('    :is([data-cgfc-liquid-composer]');
        style.textContent = GLASS_STYLE.slice(start) + `
          :host([data-cgfc-toolbox-glass]) { isolation: auto !important; }
          :host([data-cgfc-toolbox-glass]) .panel-header,
          :host([data-cgfc-toolbox-glass]) .view-tabs { border-color: transparent; }
        `;
        shadow.appendChild(style); this.shadowStyles.set(shadow, style);
      }
      for (const [tree, style] of this.shadowStyles) if (!tree.host.isConnected) { style.remove(); this.shadowStyles.delete(tree); }
      host?.toggleAttribute('data-cgfc-toolbox-glass', document.documentElement.hasAttribute('data-cgfc-toolbox-liquid-glass'));
      this.bind('toolboxPanel', shadow?.getElementById('panel'));
      this.bind('toolboxLauncher', shadow?.getElementById('launcher'));
      this.bind('settings', document.getElementById('cgfc-panel'));
      this.bind('queuePanel', this.runtime.composerQueueDock?.panel);
      this.bind('queueCapsule', this.runtime.composerQueueDock?.capsule);
      this.bind('stats', document.querySelector('#cgpt-unified-token-stats .cgpt-token-pill'));
      this.bind('toggle', document.getElementById('cgfc-toggle'));
      const scrollButtons = document.documentElement.hasAttribute('data-cgfc-scroll-liquid-glass')
        ? new Set(document.querySelectorAll(GLASS_SCROLL_SELECTOR)) : new Set();
      for (const [node, controller] of this.scrollControllers) if (!scrollButtons.has(node)) {
        controller.destroy(); this.scrollControllers.delete(node);
      }
      for (const node of scrollButtons) {
        let controller = this.scrollControllers.get(node);
        if (!controller) {
          controller = new ComposerLiquidGlass(this.runtime, { kind: 'scroll', enabledAttribute: 'data-cgfc-scroll-liquid-glass', direct: true, sharedStyle: true, managed: true });
          this.scrollControllers.set(node, controller);
        }
        this.bind('scroll', node, controller);
      }
      // Material applies to the native primary action in every state. The
      // queue's findSendButton remains send-only: a voice/stop click is never
      // treated as submitting a queued message.
      const button = this.composerShell?.querySelector([
        'button#composer-submit-button', 'button[data-testid="send-button"]',
        'button[data-testid="composer-send-button"]', 'button[data-testid="stop-button"]',
        'button[data-testid="composer-stop-button"]', 'button[data-testid*="stop-generating"]',
        'button[aria-label="停止流式传输"]', 'button[aria-label="停止回答"]', 'button[aria-label="停止输出"]',
        'button[aria-label="Stop streaming" i]', 'button[aria-label="Stop response" i]', 'button[aria-label="Stop" i]', 'button[aria-label="停止"]',
        'button[aria-label="开始语音"]', 'button[aria-label="Start voice" i]',
        'button[aria-label="Use voice mode" i]', 'button[aria-label="停止生成"]',
        'button[aria-label="Stop generating" i]', 'button[aria-label*="send" i]:not([aria-label*="feedback" i])',
        'button[aria-label*="发送"]:not([aria-label*="队列"])',
      ].join(','));
      const tools = this.composerShell?.querySelector('[class*="ComposerLayoutFooter-"] [class*="bg-(--composer-layout-surface-background)"]');
      this.bind('composerTools', tools);
      this.bind('send', button);
      const observe = document.documentElement.hasAttribute('data-cgfc-send-liquid-glass') || document.documentElement.hasAttribute('data-cgfc-composer-tools-liquid-glass') ? this.composerShell : null;
      if (observe !== this.observedShell) {
        this.buttonObserver?.disconnect(); this.buttonObserver = null; this.observedShell = observe;
        if (observe) {
          this.buttonObserver = new MutationObserver(records => {
            const changed = records.some(record => {
              if (record.type !== 'attributes' || record.attributeName !== 'style') return true;
              const node = record.target;
              // Our --cgfc-* style writes must never drive a refresh feedback loop.
              const stamp = nativeGlassPaintKey(node), previous = this.nativePaintStamps.get(node);
              this.nativePaintStamps.set(node, stamp);
              return previous !== stamp;
            });
            if (changed) this.schedule();
          });
          this.buttonObserver.observe(observe, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-testid', 'aria-label', 'disabled', 'aria-disabled', 'class', 'style'] });
        }
      }
    }

    destroy() {
      if (this.raf) this.runtime.pageWork.cancelFrame(this.raf);
      this.buttonObserver?.disconnect();
      document.removeEventListener('cgpt-unified-ui-settings-change', this.onSettings);
      document.removeEventListener('DOMContentLoaded', this.onSettings);
      document.removeEventListener('visibilitychange', this.onVisibility);
      window.removeEventListener('resize', this.onSettings);
      for (const controller of this.allControllers()) controller.destroy();
      for (const style of this.shadowStyles.values()) style.remove();
      document.getElementById('cgpt-answer-toc-host')?.removeAttribute('data-cgfc-toolbox-glass');
      this.shadowStyles.clear(); this.controllers.clear(); this.scrollControllers.clear();
    }
  }

  runtime.composerLiquidGlass?.destroy?.();
  runtime.composerLiquidGlass = new ComposerLiquidGlass(runtime);
  runtime.surfaceLiquidGlass?.destroy?.();
  runtime.surfaceLiquidGlass = new SupplementaryLiquidGlass(runtime);
  runtime.tokenStats?.destroy?.();
  runtime.sessionExporter?.destroy?.();
  runtime.sessionExporter = new SessionExporter();
  runtime.tokenStats = new TokenStatsController(runtime.sessionExporter);
  runtime.tokenStats.init();
  runtime.promptLibrary = runtime.promptLibrary || new PromptLibrary();
  runtime.messageQueue = runtime.messageQueue || new MessageQueue(runtime);
  runtime.messageQueue.start();
  runtime.composerQueueDock = runtime.composerQueueDock || new ComposerQueueDock(runtime);
  runtime.composerQueueDock.start();

  function startMessageMarkdownCopy() {
    const selector = `main ${dom.assistant}`;
    const className = 'cgpt-unified-copy-message-md';
    const pendingPlacement = new WeakSet();
    const placeButtonAtEnd = (answer, button) => {
      if (button === answer.lastElementChild || pendingPlacement.has(answer)) return;
      pendingPlacement.add(answer);
      queueMicrotask(() => {
        pendingPlacement.delete(answer);
        if (button.parentElement === answer && button !== answer.lastElementChild) answer.appendChild(button);
      });
    };
    const style = document.createElement('style');
    style.textContent = `
      .${className} { display: inline-grid; width: 32px; height: 32px; margin: 7px 0 3px;
        padding: 0; place-items: center; border: 0; border-radius: 8px;
        background: transparent; color: var(--cgfc-message-copy-icon-color, currentColor); cursor: pointer; }
      .${className}:hover, .${className}:focus-visible {
        background: var(--main-surface-secondary, rgba(127,127,127,.16)); outline: none; }
      .${className}[data-copied="true"] { color: var(--cgfc-message-copy-icon-color, #6d5dfc);
        background: color-mix(in srgb, currentColor 12%, transparent); }
      .${className} svg { width: 20px; height: 20px; fill: none; stroke: currentColor;
        stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
    `;
    const addButton = (answer) => {
      if (!(answer instanceof Element)) return;
      if (dom.isThinkingOverview(answer)) {
        answer.querySelectorAll(`.${className}`).forEach((button) => button.remove());
        return;
      }
      const existing = answer.querySelector(`:scope > .${className}`);
      if (existing) {
        placeButtonAtEnd(answer, existing);
        return;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.title = '复制这条回答的 Markdown，保留公式 LaTeX';
      button.setAttribute('aria-label', button.title);
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('aria-hidden', 'true');
      const back = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      back.setAttribute('d', 'M8 4h11a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1H8a1 1 0 0 1 -1 -1V5a1 1 0 0 1 1 -1');
      const front = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      front.setAttribute('d', 'M4 16a1 1 0 0 1 -1 -1V3a1 1 0 0 1 1 -1h11');
      icon.append(back, front);
      button.appendChild(icon);
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const markdown = runtime.sessionExporter.extractContent(answer);
        const ok = Boolean(markdown) && await runtime.promptLibrary.copyText(markdown);
        button.dataset.copied = String(ok);
        button.title = ok ? '已复制 Markdown' : '复制失败';
        button.setAttribute('aria-label', button.title);
        setTimeout(() => {
          if (!button.isConnected) return;
          delete button.dataset.copied;
          button.title = '复制这条回答的 Markdown，保留公式 LaTeX';
          button.setAttribute('aria-label', button.title);
        }, 1600);
      });
      answer.appendChild(button);
    };
    const scan = (root) => {
      if (!(root instanceof Element)) return;
      if (root.matches(selector)) addButton(root);
      root.querySelectorAll(selector).forEach(addButton);
    };
    const start = () => {
      (document.head || document.documentElement).appendChild(style);
      scan(document.documentElement);
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          const answer = record.target instanceof Element
            ? record.target.closest(selector) : record.target.parentElement?.closest(selector);
          if (answer) addButton(answer);
          for (const node of record.addedNodes) if (node instanceof Element) scan(node);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
  startMessageMarkdownCopy();
})();

/* ===== Module 1: long-chat performance + adaptive navigation ===== */

(() => {
  'use strict';

  const dom = globalThis.__cgptUnifiedRuntimeV1.dom;

  const CONFIG = Object.freeze({
    // 单条回答本身非常长时再开启。默认关闭，兼容性更稳。
    optimizeBlocksInsideLongAnswers: false,

    // 仅当“正在输入的提示词本身也很长”时尝试开启。
    disableEditorSpellcheck: false,

    // 隐藏选中文字后出现的“询问 ChatGPT / 开始写作”浮层。
    hideSelectionActions: true,

    // 启用当前 Assistant 回答内部的自适应章节目录。
    enableAnswerToc: true,

    // “章节”只描述当前回答内部结构；完整读取 H1-H6，再按需补充回答内的派生小节。
    answerTocHeadingSelector: 'h1, h2, h3, h4, h5, h6',

    answerTocDerivedOutline: true,
    answerTocDerivedMaxItems: 18,
    answerTocDerivedMinTextLength: 8,

    // 自动补全保留：只读 API、DOM 与原生标题，不在后台点击导航。
    conversationTocAutoHydrateLabels: true,
    conversationTocHydrateBatchSize: 3,
    conversationTocHydrateDelayMs: 360,
    conversationTocHydrateTimeoutMs: 900,

    // 第一次使用时是否默认收起；之后会记住手动选择。
    answerTocInitiallyCollapsed: false,
    answerTocRememberCollapsedState: true,

    // 目录跳转动画。系统开启“减少动态效果”时会自动禁用动画。
    answerTocSmoothScroll: true,

    // 以视口从上往下 28% 的位置作为“当前章节 / 当前回答”阅读指针。
    answerTocActiveLineRatio: 0.28,

    // 章节切换迟滞区，避免标题在阅读指针附近来回抖动。
    answerTocActiveHysteresisPx: 38,

    // 点击章节后，将标题放在视口约 22% 高度，而不是紧贴顶部。
    answerTocJumpLineRatio: 0.22,

    // 用户正在手动浏览章节列表时，暂停目录自身的自动卷回。
    answerTocManualBrowseHoldMs: 1500,

    // 自动派生章节的常规质量门槛；不足时仅按分布补少量兜底章节。
    answerTocDerivedMinScore: 60,

    // 为官方右侧问答导航预留的最小空间。
    answerTocFallbackInlineEndPx: 68,
    answerTocOfficialNavGapPx: 12,

    // 始终保留入口；窄屏/手机通过下方响应式布局避开输入框和安全区。
    answerTocMinViewportWidth: 0,

    // 目录条目的最大文本长度；完整标题仍会放在 title 提示中。
    answerTocMaxLabelLength: 180,

    // 目录与折叠按钮的背景透明度，范围 0～1。
    answerTocPanelOpacity: 0.72,
    answerTocLauncherOpacity: 0.68,

    // 半透明背景后的模糊强度。默认关闭，避免固定模糊层增加绘制开销。
    answerTocBackdropBlurPx: 0,

    // 折叠按钮悬停多久后临时展开；光标离开整个面板后多久自动收起。
    answerTocHoverExpandDelayMs: 180,
    answerTocHoverCollapseDelayMs: 220,

    // 一级目录：整段对话中的用户提问；二级目录：当前回答里的 H1/H2。
    enableConversationToc: true,
    hideOfficialConversationToc: true,
    answerTocInitialView: 'headings', // 可选：'conversation' 或 'headings'
    answerTocRememberView: true,
    // 问答预览最多显示 3 行；完整提问仍保留在鼠标悬停提示中。
    // 设为 0 可取消按行限制。
    conversationTocPreviewMaxLines: 3,

    // 超长提问最多保留 240 个字符；设为 0 可取消按字符限制。
    conversationTocMaxLabelLength: 240,

    // 问答跳转后，目标提问与滚动视口顶部之间保留的距离。
    conversationTocScrollOffsetPx: 88,

    // 隐藏官方问答导航后，自定义目录距页面右侧的默认距离。
    answerTocStandaloneInlineEndPx: 20,

    // 拖动后是否记住位置，以及控件与视口边缘的最小距离。
    answerTocRememberPosition: true,
    answerTocDragViewportMarginPx: 8,

    // 面板四角缩放范围及尺寸持久化。缩放会自动转为手动定位。
    answerTocRememberSize: true,
    answerTocMinWidthPx: 160,
    answerTocMaxWidthPx: 560,
    answerTocMinHeightPx: 170,
    answerTocMaxHeightPx: 760,
  });

  const TURN_SELECTOR = `main ${dom.turn}`;
  const ASSISTANT_SELECTOR = `main ${dom.assistant}`;
  const USER_SELECTOR = `main ${dom.user}`;

  const LONG_ANSWER_BLOCK_SELECTOR = ['p', 'pre', 'blockquote', 'ul', 'ol', 'table', 'h1', 'h2', 'h3', 'h4', 'div']
    .map((tag) => `${ASSISTANT_SELECTOR} ${dom.content} > ${tag}, main [data-markdown-text-style="assistant-message"] > ${tag}`)
    .join(',\n');

  const css = [];

  // 自适应性能模块测量真实高度后再启用外层轮次优化，避免固定估算高度。

  if (CONFIG.optimizeBlocksInsideLongAnswers) {
    css.push(`
      @supports (content-visibility: auto) {
        /* 仅用于“一条回答本身就非常长”的情况。 */
        ${LONG_ANSWER_BLOCK_SELECTOR} {
          content-visibility: auto !important;
          contain-intrinsic-size: auto 128px !important;
          contain-intrinsic-size: auto none auto 128px !important;
        }
      }
    `);
  }

  if (CONFIG.hideSelectionActions) {
    css.push(`
      [popover="manual"][style*="--targeted-action-selection"] {
        display: none !important;
        pointer-events: none !important;
      }
    `);
  }

  if (CONFIG.hideOfficialConversationToc) {
    css.push(`
      /*
       * 只在视觉和指针层面隐藏官方问答导航，不使用 display:none。
       * 这样仍可调用其原生点击逻辑处理尚未挂载的远端历史轮次。
       */
      [data-cgpt-native-conversation-toc-hidden] {
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `);
  }

  if (CONFIG.enableAnswerToc) {
    css.push(`
      /* 让目录跳转后的标题与页面顶部保留适当间距。 */
      ${ASSISTANT_SELECTOR} :is(h1, h2, h3, h4, h5, h6) {
        scroll-margin-block-start: 88px;
      }

      /*
       * 远距离跳转时临时完整布局目标轮次，减少 content-visibility
       * 使用估算高度而导致的落点偏差。脚本会在定位稳定后移除此属性。
       */
      [data-cgpt-conversation-jump-target] {
        content-visibility: visible !important;
        contain-intrinsic-size: none !important;
      }
    `);
  }

  css.push(`
    @media print {
      ${TURN_SELECTOR},
      ${ASSISTANT_SELECTOR}${CONFIG.optimizeBlocksInsideLongAnswers ? `,\n${LONG_ANSWER_BLOCK_SELECTOR}` : ''} {
        content-visibility: visible !important;
        contain-intrinsic-size: none !important;
      }

      #cgpt-answer-toc-host {
        display: none !important;
      }
    }
  `);

  GM_addStyle(css.join('\n'));

  if (CONFIG.disableEditorSpellcheck) {
    const EDITOR_SELECTOR = [
      '#prompt-textarea[contenteditable="true"]',
      'textarea[name="prompt-textarea"]',
    ].join(',');

    const tuneEditor = (element) => {
      if (!(element instanceof HTMLElement)) return;
      element.setAttribute('spellcheck', 'false');
      element.setAttribute('autocorrect', 'off');
      element.setAttribute('autocapitalize', 'off');
    };

    document.addEventListener(
      'focusin',
      (event) => {
        const target = event.target;
        if (target instanceof Element && target.matches(EDITOR_SELECTOR)) {
          tuneEditor(target);
        }
      },
      true,
    );
  }

  if (!CONFIG.enableAnswerToc) return;

  class AnswerTocController {
    constructor(config) {
      this.config = config;

      this.host = null;
      this.shadow = null;
      this.launcher = null;
      this.panel = null;
      this.list = null;
      this.tocNav = null;
      this.conversationList = null;
      this.conversationNav = null;
      this.headingEmptyState = null;
      this.conversationEmptyState = null;
      this.countLabel = null;
      this.launcherCount = null;
      this.launcherMode = null;
      this.panelHeader = null;
      this.collapseButton = null;
      this.viewConversationButton = null;
      this.viewHeadingsButton = null;
      this.viewPromptsButton = null;
      this.viewConversationCount = null;
      this.viewHeadingsCount = null;
      this.viewPromptsCount = null;
      this.promptNav = null;
      this.promptLibrary = globalThis.__cgptUnifiedRuntimeV1?.promptLibrary || null;
      this.resizeHandles = [];

      this.currentAnswer = null;
      this.currentContentRoot = null;
      this.currentScrollRoot = null;
      this.headings = [];
      this.itemButtons = [];
      this.activeIndex = -1;
      this.pendingHeadingIndex = -1;
      this.pendingHeadingUntil = 0;
      this.pendingHeadingTimer = 0;
      this.headingJumpToken = 0;
      this.headingJumpSettleTimer = 0;
      this.headingJumpScrollTarget = null;
      this.headingJumpScrollEndHandler = null;
      this.headingNavPointerInside = false;
      this.headingNavUserActiveUntil = 0;

      this.conversationItems = [];
      this.conversationItemButtons = [];
      this.lastRenderedConversationModel = null;
      this.activeConversationIndex = -1;
      this.lastConversationSignature = '';
      this.lastConversationDataSignature = '';
      this.userPromptTextCache = new WeakMap();
      this.userPromptTextRevision = 0;
      this.conversationRecordLookups = new WeakMap();
      this.apiOutlineLookups = new WeakMap();
      this.pendingApiOutline = null;
      this.resolvedApiOutline = null;
      this.officialNavContainer = null;
      this.conversationLabelCache = new Map();
      this.conversationCacheIdentityByIndex = new Map();
      this.conversationCacheIndexByIdentity = new Map();
      this.maxObservedOfficialLogicalIndex = -1;
      this.pendingConversationLogicalIndex = -1;
      this.pendingConversationUntil = 0;
      this.conversationJumpToken = 0;
      this.conversationJumpTimers = new Set();
      this.conversationJumpRevealElement = null;
      this.conversationJumpRevealTimer = 0;
      this.conversationLabelHydrationTimer = 0;
      this.conversationLabelHydrationToken = 0;
      this.conversationLabelHydrating = false;
      this.conversationLabelHydrationContext = null;
      this.conversationLabelHydrationAttempts = new Map();

      // API-first 完整问答目录。只缓存当前会话当前分支的 user 节点；
      // 页面 DOM 可以继续按性能策略卸载，不影响目录总数和标题。
      this.apiConversationOutline = null;
      this.apiConversationRefreshTimer = 0;
      this.apiConversationRefreshForce = false;
      this.apiConversationRefreshToken = 0;
      this.apiConversationRefreshInFlight = false;
      this.apiConversationLastErrorKey = '';

      this.mainElement = null;
      this.mainObserver = null;
      this.answerObserver = null;
      this.headingTextObserver = null;

      this.frameId = 0;
      this.forceAnswerDetection = false;
      this.lastAnswerDetectionAt = 0;
      this.answerDetectionTimer = 0;
      this.lastScrollTop = 0;
      this.rebuildTimer = 0;
      this.conversationRebuildTimer = 0;
      this.rebindTimer = 0;
      this.healthTimer = 0;
      this.lastUrl = location.href;
      this.lastConversationRouteKey = this.getConversationRouteKey(this.lastUrl);
      this.restoreConversationLabelSnapshot();

      this.hoverExpandTimer = 0;
      this.hoverCollapseTimer = 0;
      this.launcherHovered = false;
      this.transientHoverOpen = false;

      /*
       * 悬浮展开时，面板右上角的“收起”按钮可能正好覆盖折叠启动器原位置。
       * 记录启动器矩形，才能把用户在原位置的第一次点击识别为“固定展开”，
       * 而不是误触面板里的收起按钮。
       */
      this.transientHoverOriginRect = null;
      this.suppressTransientOriginClick = false;
      this.suppressTransientOriginClickRect = null;
      this.suppressTransientOriginClickTimer = 0;

      this.dragState = null;
      this.dragFrameId = 0;
      this.pendingDragPoint = null;
      this.suppressNextLauncherClick = false;
      this.rootStyleBeforeDrag = null;

      this.resizeState = null;
      this.resizeFrameId = 0;
      this.pendingResizePoint = null;
      this.rootStyleBeforeResize = null;

      this.savedPosition = this.readPositionState();
      this.positionMode = this.savedPosition ? 'manual' : 'auto';
      this.savedSize = this.readSizeState();
      this.sizeMode = this.savedSize ? 'manual' : 'auto';
      this.collapsed = this.readCollapsedState();
      this.activeView = this.readViewState();
      this.lastPanelWidthOverride = null;

      this.onScroll = globalThis.__cgptUnifiedRuntimeV1.pageWork.onScrollChange(this.onScroll.bind(this));
      this.onResize = this.onResize.bind(this);
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onVisibilityChange = this.onVisibilityChange.bind(this);
      this.onRouteSignal = this.onRouteSignal.bind(this);
      this.onMainMutations = this.onMainMutations.bind(this);
      this.onAnswerMutations = this.onAnswerMutations.bind(this);
      this.onLauncherPointerEnter = this.onLauncherPointerEnter.bind(this);
      this.onLauncherPointerLeave = this.onLauncherPointerLeave.bind(this);
      this.onPanelPointerEnter = this.onPanelPointerEnter.bind(this);
      this.onPanelPointerLeave = this.onPanelPointerLeave.bind(this);
      this.onPanelClickCapture = this.onPanelClickCapture.bind(this);
      this.onDocumentPointerDown = this.onDocumentPointerDown.bind(this);
      this.onDocumentClick = this.onDocumentClick.bind(this);
      this.onDragPointerMove = this.onDragPointerMove.bind(this);
      this.onDragPointerEnd = this.onDragPointerEnd.bind(this);
      this.onDragPointerCancel = this.onDragPointerCancel.bind(this);
      this.onResizePointerMove = this.onResizePointerMove.bind(this);
      this.onResizePointerEnd = this.onResizePointerEnd.bind(this);
      this.onResizePointerCancel = this.onResizePointerCancel.bind(this);
      this.onUiSettingsChange = () => {
        const nextWidthOverride = document.documentElement.style.getPropertyValue('--cgfc-toolbox-panel-width').trim();
        const widthChanged = this.lastPanelWidthOverride !== null
          && nextWidthOverride !== this.lastPanelWidthOverride;
        this.lastPanelWidthOverride = nextWidthOverride;
        window.requestAnimationFrame(() => {
          if (widthChanged && nextWidthOverride && this.sizeMode === 'manual' && this.savedSize) {
            const anchor = !this.collapsed ? this.captureWidgetEdgeAnchor() : null;
            this.setPanelSize(Number.parseFloat(nextWidthOverride), this.savedSize.height, true);
            if (anchor) this.alignManualWidgetToEdgeAnchor(anchor, true);
          }
          this.ensurePanelSizeInViewport(false);
          this.ensureManualPositionInViewport(true);
          this.updateInlineEndOffset();
        });
      };
    }

    start() {
      if (!document.body) return;

      this.createUi();
      this.bindMainObserver();
      this.syncOfficialConversationNav();
      this.rebuildConversationToc();
      this.scheduleApiConversationOutlineRefresh(40, true);
      this.updateInlineEndOffset();
      this.syncVisibility();

      document.addEventListener('scroll', this.onScroll, {
        capture: true,
        passive: true,
      });
      this.onNavigationGesture = (event) => this.cancelNavigationForGesture(event);
      for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
        document.addEventListener(type, this.onNavigationGesture, { capture: true, passive: true });
      }
      window.addEventListener('resize', this.onResize, { passive: true });
      window.visualViewport?.addEventListener('resize', this.onResize, { passive: true });
      window.visualViewport?.addEventListener('scroll', this.onResize, { passive: true });
      window.addEventListener('popstate', this.onRouteSignal, { passive: true });
      window.addEventListener('hashchange', this.onRouteSignal, { passive: true });
      document.addEventListener('keydown', this.onKeyDown, true);
      document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
      document.addEventListener('click', this.onDocumentClick, true);
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      document.addEventListener('cgpt-unified-ui-settings-change', this.onUiSettingsChange);

      if (window.navigation && typeof window.navigation.addEventListener === 'function') {
        window.navigation.addEventListener('navigatesuccess', this.onRouteSignal);
      }

      this.healthTimer = window.setInterval(() => {
        if (document.hidden) return;

        const activeMain = dom.main();
        if (location.href !== this.lastUrl || !this.mainElement?.isConnected
          || (activeMain && activeMain !== this.mainElement)) {
          this.resetForNavigation();
          return;
        }

        this.syncOfficialConversationNav();
        this.refreshConversationTocIfNeeded();
      }, 1600);

      this.requestFrame(true);
    }
    createUi() {
      document.querySelector('#cgpt-answer-toc-host')?.remove();

      const clampUnit = (value, fallback) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback;
      };
      const panelOpacity = clampUnit(this.config.answerTocPanelOpacity, 0.72);
      const launcherOpacity = clampUnit(this.config.answerTocLauncherOpacity, 0.68);
      const panelOpacityPercent = `${Math.round(panelOpacity * 100)}%`;
      const launcherOpacityPercent = `${Math.round(launcherOpacity * 100)}%`;
      const backdropBlur = Math.max(0, Number(this.config.answerTocBackdropBlurPx) || 0);
      const minWidth = Math.max(160, Number(this.config.answerTocMinWidthPx) || 220);
      const minHeight = Math.max(120, Number(this.config.answerTocMinHeightPx) || 170);
      const conversationPreviewMaxLines = Math.max(
        0,
        Math.floor(Number(this.config.conversationTocPreviewMaxLines) || 0),
      );
      const conversationPreviewCss = conversationPreviewMaxLines > 0
        ? `display: -webkit-box;
            overflow: hidden;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: ${conversationPreviewMaxLines};`
        : `display: block;
            overflow: visible;
            -webkit-box-orient: initial;
            -webkit-line-clamp: unset;`;
      const backdropFilterCss = backdropBlur > 0
        ? `-webkit-backdrop-filter: blur(${backdropBlur}px) saturate(118%);
            backdrop-filter: blur(${backdropBlur}px) saturate(118%);`
        : '';

      const host = document.createElement('div');
      host.id = 'cgpt-answer-toc-host';
      host.hidden = true;
      host.setAttribute('data-cgpt-answer-toc', '');
      host.dataset.dockSide = 'right';
      // A manual popover enters the browser top layer without making the page
      // modal. Max z-index remains the fallback for older browsers.
      if (typeof host.showPopover === 'function') host.setAttribute('popover', 'manual');
      host.style.setProperty('z-index', '2147483647', 'important');

      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host {
            all: initial;
            position: fixed !important;
            inset-inline-end: var(--cgpt-answer-toc-inline-end, 20px) !important;
            top: 50% !important;
            z-index: 2147483647 !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            background: transparent !important;
            overflow: visible !important;
            bottom: auto !important;
            inset-inline-start: auto !important;
            isolation: isolate !important;
            width: max-content !important;
            height: max-content !important;
            display: block !important;
            transform: translateY(-50%) !important;
            font-family: var(--cgfc-toolbox-font, ui-sans-serif, -apple-system, BlinkMacSystemFont,
              "Segoe UI", "Microsoft YaHei", sans-serif) !important;
            font-size: var(--cgfc-toolbox-font-size, 13px) !important;
            line-height: var(--cgfc-toolbox-line-height, 1.4) !important;
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616))) !important;
            color-scheme: var(--cgfc-color-scheme, light) !important;
            direction: inherit !important;
            pointer-events: none !important;
          }

          :host([data-position-mode="manual"]) {
            inset-inline: auto !important;
            right: auto !important;
            bottom: auto !important;
            left: var(--cgpt-answer-toc-left, 8px) !important;
            top: var(--cgpt-answer-toc-top, 8px) !important;
            transform: none !important;
          }

          :host([hidden]) {
            display: none !important;
          }

          :host::backdrop {
            background: transparent !important;
            pointer-events: none !important;
          }

          *, *::before, *::after {
            box-sizing: border-box;
          }

          button {
            font: inherit;
          }

          .launcher,
          .panel {
            pointer-events: auto;
            ${backdropFilterCss}
          }

          .launcher {
            display: inline-flex;
            min-width: 42px;
            height: 38px;
            align-items: center;
            justify-content: center;
            gap: 5px;
            padding: 0 9px;
            border: 1px solid var(--cgfc-theme-border, var(--border-light, rgba(0, 0, 0, 0.14)));
            border-radius: 12px;
            background: var(--cgfc-toolbox-launcher-background, color-mix(
              in srgb,
              var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #ffffff))) ${launcherOpacityPercent},
              transparent
            ));
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-secondary, var(--text-secondary, #444444)));
            box-shadow: var(--cgfc-theme-shadow-soft, 0 6px 22px rgba(0, 0, 0, 0.14));
            cursor: grab;
            touch-action: none;
            user-select: none;
          }

          .launcher:hover {
            background: var(--cgfc-toolbox-launcher-background, rgba(244, 244, 244, ${launcherOpacity}));
            background: var(--cgfc-toolbox-launcher-background, color-mix(
              in srgb,
              var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #f4f4f4))) ${launcherOpacityPercent},
              transparent
            ));
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616)));
          }

          .launcher:focus-visible,
          .icon-button:focus-visible,
          .view-tab:focus-visible,
          .toc-item:focus-visible {
            outline: 2px solid var(--cgfc-toolbox-accent-color, var(--text-primary, #161616));
            outline-offset: 2px;
          }

          .launcher svg,
          .icon-button svg {
            width: 17px;
            height: 17px;
            flex: none;
          }

          .launcher-mode {
            min-width: 1em;
            color: var(--cgfc-toolbox-muted-color, var(--text-tertiary, #777777));
            font-size: 10px;
            font-weight: 600;
          }

          .launcher-count {
            min-width: 1.3em;
            text-align: center;
            font-size: 11px;
            font-variant-numeric: tabular-nums;
          }

          .panel {
            position: relative;
            container-type: inline-size;
            width: min(var(--cgpt-answer-toc-width, var(--cgfc-toolbox-panel-width, 300px)), calc(100vw - 16px));
            max-height: min(68dvh, 660px, calc(100dvh - 16px));
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border: 1px solid var(--cgfc-theme-border, var(--border-light, rgba(0, 0, 0, 0.14)));
            border-radius: 14px;
            background: var(--cgfc-toolbox-panel-background, color-mix(
              in srgb,
              var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #ffffff))) ${panelOpacityPercent},
              transparent
            ));
            box-shadow: var(--cgfc-theme-shadow-strong, 0 10px 34px rgba(0, 0, 0, 0.16));
          }

          :host([data-size-mode="manual"]) .panel {
            width: var(--cgpt-answer-toc-width, var(--cgfc-toolbox-panel-width, 300px));
            height: var(--cgpt-answer-toc-height, 420px);
            min-width: ${minWidth}px;
            min-height: ${minHeight}px;
            max-width: calc(100vw - 16px);
            max-height: calc(100dvh - 16px);
          }

          .panel[hidden],
          .launcher[hidden],
          .toc-nav[hidden],
          .empty-state[hidden] {
            display: none !important;
          }

          .panel-header {
            min-height: 36px;
            display: flex;
            flex: none;
            align-items: center;
            gap: 7px;
            padding-block: 5px;
            padding-inline-start: 8px;
            padding-inline-end: 20px;
            border-bottom: 1px solid var(--border-light, rgba(0, 0, 0, 0.11));
            cursor: grab;
            touch-action: none;
            user-select: none;
          }

          .drag-grip {
            width: 12px;
            height: 22px;
            display: grid;
            flex: none;
            grid-template-columns: repeat(2, 3px);
            grid-auto-rows: 3px;
            place-content: center;
            gap: 3px;
            color: var(--cgfc-toolbox-muted-color, var(--text-tertiary, #777777));
            opacity: 0.75;
          }

          .drag-grip::before,
          .drag-grip::after {
            width: 3px;
            height: 3px;
            border-radius: 50%;
            background: currentColor;
            box-shadow: 0 6px currentColor, 0 -6px currentColor;
            content: "";
          }

          :host([data-dragging]) .launcher,
          :host([data-dragging]) .panel-header {
            cursor: grabbing;
          }

          :host([data-resizing]) .panel {
            user-select: none;
          }

          .panel-title-wrap {
            min-width: 0;
            display: flex;
            flex: 1;
            align-items: baseline;
            gap: 7px;
          }

          .panel-title {
            overflow: hidden;
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616)));
            font-weight: 600;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .count-label {
            flex: none;
            color: var(--cgfc-toolbox-muted-color, var(--text-tertiary, #777777));
            font-size: 11px;
            font-variant-numeric: tabular-nums;
          }

          .icon-button {
            position: relative;
            z-index: 4;
            width: 27px;
            height: 27px;
            display: inline-flex;
            flex: none;
            align-items: center;
            justify-content: center;
            padding: 0;
            border: 0;
            border-radius: 8px;
            background: transparent;
            color: var(--cgfc-toolbox-muted-color, var(--text-secondary, #555555));
            cursor: pointer;
          }

          .icon-button:hover {
            background: var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #f1f1f1)));
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616)));
          }

          .view-tabs {
            display: grid;
            flex: none;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 3px;
            padding: 3px 5px;
            border-bottom: 1px solid var(--border-light, rgba(0, 0, 0, 0.09));
          }

          .view-tab {
            min-width: 0;
            min-height: 28px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            padding: 3px 5px;
            border: 0;
            border-radius: 8px;
            background: transparent;
            color: var(--cgfc-toolbox-muted-color, var(--text-secondary, #4a4a4a));
            cursor: pointer;
            white-space: nowrap;
          }

          .view-tab:hover {
            background: color-mix(
              in srgb,
              var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #f3f3f3))) 74%,
              transparent
            );
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616)));
          }

          .view-tab[aria-selected="true"] {
            background: color-mix(in srgb, var(--cgfc-toolbox-accent-color, var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #ededed)))) 18%, transparent);
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #111111)));
            font-weight: 600;
          }

          .view-count {
            min-width: 1.45em;
            padding: 0 4px;
            border-radius: 999px;
            background: color-mix(in srgb, currentColor 10%, transparent);
            font-size: 10px;
            font-variant-numeric: tabular-nums;
            font-weight: 500;
          }

          @container (max-width: 219px) {
            .panel-header { gap: 4px; padding-inline-end: 7px; }
            .panel-title-wrap { gap: 0; }
            .count-label, .view-count { display: none; }
            .view-tab { gap: 1px; padding-inline: 2px; }
          }

          .toc-nav {
            min-height: 0;
            flex: 1;
            overflow-y: auto;
            overscroll-behavior: contain;
            padding: 6px;
          }

          /* Match the prompt list: narrow grey thumb, clear track, no arrows.
             Keep scrollbar-width auto in Chromium so it uses these pseudo
             elements; thin would override their size and native buttons. */
          .toc-nav::-webkit-scrollbar { width: 9px; }
          .toc-nav::-webkit-scrollbar-track { background: transparent; border-radius: 9px; }
          .toc-nav::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 9px; background: #424242; background-clip: padding-box; }
          .toc-nav::-webkit-scrollbar-thumb:hover { background-color: #585858; }
          .toc-nav::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
          .toc-nav::-webkit-scrollbar-corner { background: transparent; }
          @supports not selector(::-webkit-scrollbar) {
            .toc-nav { scrollbar-width: thin; scrollbar-color: #424242 transparent; }
          }

          .toc-list {
            display: flex;
            flex-direction: column;
            gap: 2px;
            margin: 0;
            padding: 0;
            list-style: none;
          }

          /* 长提问由目录区域滚动，不压缩单个条目的实际高度。 */
          .toc-list > li {
            min-width: 0;
            flex: 0 0 auto;
          }

          .toc-item {
            position: relative;
            width: 100%;
            min-height: 30px;
            display: flex;
            align-items: flex-start;
            gap: 7px;
            overflow: hidden;
            padding: 6px 9px 6px 11px;
            border: 0;
            border-radius: 8px;
            background: transparent;
            color: var(--cgfc-toolbox-muted-color, var(--text-secondary, #4a4a4a));
            text-align: start;
            cursor: pointer;
          }

          .toc-item::before {
            position: absolute;
            inset-block: 7px;
            inset-inline-start: 3px;
            width: 2px;
            border-radius: 2px;
            background: transparent;
            content: "";
          }

          .toc-item:hover {
            background: color-mix(
              in srgb,
              var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #f3f3f3))) 82%,
              transparent
            );
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #161616)));
          }

          .toc-item[data-active="true"] {
            background: color-mix(in srgb, var(--cgfc-toolbox-accent-color, var(--cgfc-theme-surface-secondary, var(--main-surface-secondary, var(--bg-secondary, #ededed)))) 18%, transparent);
            color: var(--cgfc-toolbox-text-color, var(--cgfc-theme-text-primary, var(--text-primary, #111111)));
          }

          .toc-item[data-active="true"]::before {
            background: var(--cgfc-toolbox-accent-color, var(--cgfc-theme-text-primary, var(--text-primary, #111111)));
          }

          .toc-item[data-level="1"] {
            font-weight: 600;
          }

          .toc-item[data-level="2"] {
            padding-inline-start: 25px;
            font-size: 12.5px;
          }

          .toc-item[data-level="3"] {
            padding-inline-start: 38px;
            font-size: 12px;
          }

          .toc-item[data-level="4"],
          .toc-item[data-level="5"],
          .toc-item[data-level="6"] {
            padding-inline-start: 50px;
            font-size: 11.5px;
          }

          .prompt-index {
            width: 2.4em;
            flex: none;
            padding-top: 1px;
            color: var(--cgfc-toolbox-muted-color, var(--text-tertiary, #777777));
            font-size: 10.5px;
            font-variant-numeric: tabular-nums;
            text-align: end;
          }

          .toc-item-label {
            min-width: 0;
            display: -webkit-box;
            flex: 1;
            overflow: hidden;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 2;
            overflow-wrap: anywhere;
          }

          /*
           * 问答级目录只在提问过长时按配置限制行数和字符数；
           * 完整文本仍写入按钮 title。章节标题继续保持两行预览。
           */
          #conversation-list .toc-item {
            height: auto;
            flex: 0 0 auto;
          }

          #conversation-list .toc-item-label {
            ${conversationPreviewCss}
            max-height: none;
            text-overflow: clip;
            white-space: pre-wrap;
            word-break: break-word;
          }

          .empty-state {
            margin: 6px;
            padding: 18px 12px;
            border: 1px dashed var(--border-light, rgba(0, 0, 0, 0.14));
            border-radius: 10px;
            color: var(--cgfc-toolbox-muted-color, var(--text-tertiary, #777777));
            text-align: center;
            font-size: 12px;
          }

          /*
           * 四个角仍可缩放，但命中区域完全透明，不绘制任何角标。
           * 鼠标进入角落命中区时，仅通过系统 resize 光标提示该功能。
           */
          .resize-handle {
            position: absolute;
            z-index: 3;
            width: 18px;
            height: 18px;
            display: block;
            border: 0;
            background: transparent;
            opacity: 0;
            pointer-events: auto;
            touch-action: none;
            user-select: none;
          }

          .resize-handle::before,
          .resize-handle::after {
            display: none !important;
            content: none !important;
          }

          .resize-handle[data-resize-corner="top-left"] {
            top: 0;
            left: 0;
            cursor: nwse-resize;
          }

          .resize-handle[data-resize-corner="top-right"] {
            top: 0;
            right: 0;
            cursor: nesw-resize;
          }

          .resize-handle[data-resize-corner="bottom-left"] {
            bottom: 0;
            left: 0;
            cursor: nesw-resize;
          }

          .resize-handle[data-resize-corner="bottom-right"] {
            right: 0;
            bottom: 0;
            cursor: nwse-resize;
          }

          @media (max-width: 819px) {
            :host(:not([data-position-mode="manual"])) {
              inset-inline-end: max(8px, env(safe-area-inset-right)) !important;
              top: auto !important;
              bottom: max(140px, calc(env(safe-area-inset-bottom) + 128px)) !important;
              transform: none !important;
            }

            .launcher {
              min-width: 44px;
              height: 40px;
            }

            .panel {
              width: min(var(--cgpt-answer-toc-width, var(--cgfc-toolbox-panel-width, 300px)), calc(100vw - 16px));
              max-height: min(72dvh, calc(100dvh - 96px));
            }

            .panel-header {
              padding-inline-end: 12px;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after {
              scroll-behavior: auto !important;
              transition: none !important;
            }
          }
        </style>

        <button
          id="launcher"
          class="launcher"
          type="button"
          aria-label="展开导航目录"
          aria-expanded="false"
          title="悬停临时展开；在目录中点击、拖动或缩放后保持展开（Alt+Shift+O）"
          hidden
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 6h14M5 12h14M5 18h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          <span id="launcher-mode" class="launcher-mode">章</span>
          <span id="launcher-count" class="launcher-count">0</span>
        </button>

        <aside id="panel" class="panel" aria-label="ChatGPT 导航目录" hidden>
          <div class="panel-header" title="拖动标题栏可移动目录">
            <span class="drag-grip" aria-hidden="true"></span>
            <div class="panel-title-wrap">
              <span class="panel-title">导航目录</span>
              <span id="count-label" class="count-label">0 节</span>
            </div>
            <button
              id="collapse-button"
              class="icon-button"
              type="button"
              aria-label="收起导航目录"
              title="收起目录（Alt+Shift+O）"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>

          <div class="view-tabs" role="tablist" aria-label="目录层级">
            <button id="view-conversation" class="view-tab" type="button" role="tab" data-view="conversation" aria-selected="false">
              <span>问答</span><span id="view-conversation-count" class="view-count">0</span>
            </button>
            <button id="view-headings" class="view-tab" type="button" role="tab" data-view="headings" aria-selected="true">
              <span>章节</span><span id="view-headings-count" class="view-count">0</span>
            </button>
            <button id="view-prompts" class="view-tab" type="button" role="tab" data-view="prompts" aria-selected="false">
              <span>提示词</span><span id="view-prompts-count" class="view-count">0</span>
            </button>
          </div>

          <nav id="conversation-nav" class="toc-nav" aria-label="对话问答导航" hidden>
            <div id="conversation-empty" class="empty-state" hidden>暂未找到可跳转的提问</div>
            <ol id="conversation-list" class="toc-list"></ol>
          </nav>

          <nav id="heading-nav" class="toc-nav" aria-label="当前回答章节">
            <div id="heading-empty" class="empty-state" hidden>当前回答没有可导航的标题或段落</div>
            <ol id="toc-list" class="toc-list"></ol>
          </nav>

          <section id="prompt-nav" class="prompt-view" aria-label="提示词与会话导出" hidden></section>

          <span class="resize-handle" aria-hidden="true" data-resize-corner="top-left"></span>
          <span class="resize-handle" aria-hidden="true" data-resize-corner="top-right"></span>
          <span class="resize-handle" aria-hidden="true" data-resize-corner="bottom-left"></span>
          <span class="resize-handle" aria-hidden="true" data-resize-corner="bottom-right"></span>
        </aside>
      `;

      document.body.appendChild(host);

      this.host = host;
      this.shadow = shadow;
      this.installTopLayer();
      this.launcher = shadow.getElementById('launcher');
      this.panel = shadow.getElementById('panel');
      this.list = shadow.getElementById('toc-list');
      this.tocNav = shadow.getElementById('heading-nav');
      this.conversationList = shadow.getElementById('conversation-list');
      this.conversationNav = shadow.getElementById('conversation-nav');
      this.headingEmptyState = shadow.getElementById('heading-empty');
      this.conversationEmptyState = shadow.getElementById('conversation-empty');
      this.countLabel = shadow.getElementById('count-label');
      this.launcherCount = shadow.getElementById('launcher-count');
      this.launcherMode = shadow.getElementById('launcher-mode');
      this.panelHeader = shadow.querySelector('.panel-header');
      this.collapseButton = shadow.getElementById('collapse-button');
      this.viewConversationButton = shadow.getElementById('view-conversation');
      this.viewHeadingsButton = shadow.getElementById('view-headings');
      this.viewPromptsButton = shadow.getElementById('view-prompts');
      this.viewConversationCount = shadow.getElementById('view-conversation-count');
      this.viewHeadingsCount = shadow.getElementById('view-headings-count');
      this.viewPromptsCount = shadow.getElementById('view-prompts-count');
      this.promptNav = shadow.getElementById('prompt-nav');
      this.resizeHandles = Array.from(
        shadow.querySelectorAll('[data-resize-corner]'),
      );
      this.promptLibrary?.mount({
        shadow,
        nav: this.promptNav,
        onCountChange: () => this.updateViewMeta(),
      });

      host.dataset.positionMode = this.positionMode;
      host.dataset.sizeMode = this.sizeMode;
      if (this.savedPosition) {
        this.setManualPosition(
          this.savedPosition.left,
          this.savedPosition.top,
          false,
        );
      }
      if (this.savedSize) {
        this.setPanelSize(this.savedSize.width, this.savedSize.height, false);
      }

      this.launcher.addEventListener('pointerenter', this.onLauncherPointerEnter);
      this.launcher.addEventListener('pointerleave', this.onLauncherPointerLeave);
      this.launcher.addEventListener('pointerdown', (event) => {
        this.beginDrag(event, 'launcher');
      });
      this.launcher.addEventListener('click', (event) => {
        if (this.suppressNextLauncherClick) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.suppressNextLauncherClick = false;
          return;
        }
        this.setCollapsed(false, { source: 'click', persist: true });
      });

      this.panel.addEventListener('pointerenter', this.onPanelPointerEnter);
      this.panel.addEventListener('pointerleave', this.onPanelPointerLeave);
      this.panel.addEventListener('click', this.onPanelClickCapture, true);

      this.tocNav?.addEventListener('pointerenter', () => {
        this.headingNavPointerInside = true;
      });
      this.tocNav?.addEventListener('pointerleave', () => {
        this.headingNavPointerInside = false;
        this.markHeadingNavInteraction(360);
      });
      for (const eventName of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
        this.tocNav?.addEventListener(eventName, () => this.markHeadingNavInteraction(), {
          passive: eventName !== 'keydown',
        });
      }

      this.panelHeader?.addEventListener('pointerdown', (event) => {
        const target = event.target;
        if (target instanceof Element && target.closest('button, a, input, textarea, select')) {
          return;
        }
        this.beginDrag(event, 'panel');
      });

      this.collapseButton?.addEventListener('click', () => {
        this.setCollapsed(true, { source: 'click', persist: true });
      });

      this.viewConversationButton?.addEventListener('click', () => {
        this.setActiveView('conversation', true);
      });
      this.viewHeadingsButton?.addEventListener('click', () => {
        this.setActiveView('headings', true);
      });
      this.viewPromptsButton?.addEventListener('click', () => {
        this.setActiveView('prompts', true);
      });

      this.list.addEventListener('click', (event) => {
        const button = event.target instanceof Element
          ? event.target.closest('button[data-heading-index]')
          : null;
        if (!(button instanceof HTMLButtonElement)) return;

        const index = Number.parseInt(button.dataset.headingIndex ?? '', 10);
        if (Number.isInteger(index)) this.jumpToHeading(index);
      });

      this.conversationList.addEventListener('click', (event) => {
        const button = event.target instanceof Element
          ? event.target.closest('button[data-conversation-index]')
          : null;
        if (!(button instanceof HTMLButtonElement)) return;

        const index = Number.parseInt(button.dataset.conversationIndex ?? '', 10);
        if (Number.isInteger(index)) this.jumpToConversation(index);
      });

      for (const handle of this.resizeHandles) {
        handle.addEventListener('pointerdown', (event) => {
          this.beginResize(event, handle.dataset.resizeCorner);
        });
      }

      this.applyActiveView();
      this.applyCollapsedState();
      this.updateViewMeta();
      globalThis.__cgptUnifiedRuntimeV1.surfaceLiquidGlass?.schedule();
    }

    readPositionState() {
      if (!this.config.answerTocRememberPosition) return null;

      try {
        const raw = localStorage.getItem('cgpt-answer-toc-position-v1');
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        const left = Number(parsed?.left);
        const top = Number(parsed?.top);
        if (Number.isFinite(left) && Number.isFinite(top)) return { left, top };
      } catch {
        // 忽略存储不可用或旧数据损坏的情况。
      }

      return null;
    }

    writePositionState() {
      if (!this.config.answerTocRememberPosition || this.positionMode !== 'manual') {
        return;
      }

      const left = Number.parseFloat(
        this.host?.style.getPropertyValue('--cgpt-answer-toc-left') ?? '',
      );
      const top = Number.parseFloat(
        this.host?.style.getPropertyValue('--cgpt-answer-toc-top') ?? '',
      );
      if (!Number.isFinite(left) || !Number.isFinite(top)) return;

      try {
        localStorage.setItem(
          'cgpt-answer-toc-position-v1',
          JSON.stringify({ left, top }),
        );
      } catch {
        // 忽略严格隐私模式下的存储错误。
      }
    }

    setManualPosition(left, top, persist = false) {
      if (!this.host || !Number.isFinite(left) || !Number.isFinite(top)) return;

      this.positionMode = 'manual';
      this.host.dataset.positionMode = 'manual';
      this.host.style.setProperty('--cgpt-answer-toc-left', `${left}px`);
      this.host.style.setProperty('--cgpt-answer-toc-top', `${top}px`);
      if (persist) this.writePositionState();
    }

    readSizeState() {
      if (!this.config.answerTocRememberSize) return null;

      try {
        const raw = localStorage.getItem('cgpt-answer-toc-size-v1');
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        const width = Number(parsed?.width);
        const height = Number(parsed?.height);
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
          return { width, height };
        }
      } catch {
        // 忽略存储不可用或旧数据损坏的情况。
      }

      return null;
    }

    getPanelSizeLimits() {
      const margin = Math.max(0, Number(this.config.answerTocDragViewportMarginPx) || 0);
      const viewportWidth = Math.max(1, document.documentElement.clientWidth);
      const viewportHeight = Math.max(1, document.documentElement.clientHeight);
      const configuredMinWidth = Math.max(160, Number(this.config.answerTocMinWidthPx) || 160);
      const configuredMaxWidth = Math.max(
        configuredMinWidth,
        Number(this.config.answerTocMaxWidthPx) || 560,
      );
      const configuredMinHeight = Math.max(120, Number(this.config.answerTocMinHeightPx) || 170);
      const configuredMaxHeight = Math.max(
        configuredMinHeight,
        Number(this.config.answerTocMaxHeightPx) || 760,
      );
      const maxWidth = Math.max(1, Math.min(configuredMaxWidth, viewportWidth - margin * 2));
      const maxHeight = Math.max(1, Math.min(configuredMaxHeight, viewportHeight - margin * 2));

      return {
        minWidth: Math.min(configuredMinWidth, maxWidth),
        maxWidth,
        minHeight: Math.min(configuredMinHeight, maxHeight),
        maxHeight,
      };
    }

    setPanelSize(width, height, persist = false) {
      if (!this.host || !Number.isFinite(width) || !Number.isFinite(height)) return null;

      const limits = this.getPanelSizeLimits();
      const nextWidth = Math.round(
        Math.min(limits.maxWidth, Math.max(limits.minWidth, width)),
      );
      const nextHeight = Math.round(
        Math.min(limits.maxHeight, Math.max(limits.minHeight, height)),
      );

      this.savedSize = { width: nextWidth, height: nextHeight };
      this.sizeMode = 'manual';
      this.host.dataset.sizeMode = 'manual';
      this.host.style.setProperty('--cgpt-answer-toc-width', `${nextWidth}px`);
      this.host.style.setProperty('--cgpt-answer-toc-height', `${nextHeight}px`);

      if (persist) this.writeSizeState();
      return this.savedSize;
    }

    writeSizeState() {
      if (!this.config.answerTocRememberSize || !this.savedSize) return;

      try {
        localStorage.setItem(
          'cgpt-answer-toc-size-v1',
          JSON.stringify(this.savedSize),
        );
      } catch {
        // 忽略严格隐私模式下的存储错误。
      }
    }

    ensurePanelSizeInViewport(persist = false) {
      if (this.sizeMode !== 'manual' || !this.savedSize) return;

      const anchor = !this.collapsed ? this.captureWidgetEdgeAnchor() : null;
      const previous = this.savedSize;
      const next = this.setPanelSize(previous.width, previous.height, false);
      const changed = next && (
        next.width !== previous.width || next.height !== previous.height
      );

      if (anchor) this.alignManualWidgetToEdgeAnchor(anchor, false);
      if (persist && changed) this.writeSizeState();
    }

    readViewState() {
      const fallback = this.config.answerTocInitialView === 'conversation'
        ? 'conversation'
        : 'headings';
      if (!this.config.answerTocRememberView) return fallback;

      try {
        const stored = localStorage.getItem('cgpt-answer-toc-view-v1');
        if (stored === 'conversation' || stored === 'headings' || stored === 'prompts') return stored;
      } catch {
        // 忽略存储不可用的情况。
      }

      return fallback;
    }

    writeViewState() {
      if (!this.config.answerTocRememberView) return;

      try {
        localStorage.setItem('cgpt-answer-toc-view-v1', this.activeView);
      } catch {
        // 忽略存储不可用的情况。
      }
    }

    setActiveView(view, persist = true) {
      const nextView = view === 'conversation' || view === 'prompts' ? view : 'headings';
      if (nextView !== 'headings') {
        // 隐藏章节列表时 pointerleave 不一定会触发，主动清掉“用户仍在浏览目录”的状态。
        this.headingNavPointerInside = false;
        this.headingNavUserActiveUntil = 0;
      }
      if (nextView === this.activeView) {
        this.applyActiveView();
        return;
      }

      this.activeView = nextView;
      if (persist) this.writeViewState();
      this.applyActiveView();
      this.updateViewMeta();
      if (this.activeView === 'conversation') this.scheduleConversationLabelHydration();
      else this.cancelConversationLabelHydration();

      window.requestAnimationFrame(() => {
        if (this.activeView === 'conversation') {
          const current = this.conversationItemButtons[this.activeConversationIndex];
          if (current) this.scrollItemIntoView(this.conversationNav, current);
        } else if (this.activeView === 'headings') {
          const current = this.itemButtons[this.activeIndex];
          if (current) this.scrollItemIntoView(this.tocNav, current);
        }
      });
    }

    applyActiveView() {
      if (!this.conversationNav || !this.tocNav || !this.promptNav) return;

      const conversationActive = this.activeView === 'conversation';
      const headingsActive = this.activeView === 'headings';
      const promptsActive = this.activeView === 'prompts';
      this.conversationNav.hidden = !conversationActive;
      this.tocNav.hidden = !headingsActive;
      this.promptNav.hidden = !promptsActive;
      this.viewConversationButton?.setAttribute('aria-selected', String(conversationActive));
      this.viewHeadingsButton?.setAttribute('aria-selected', String(headingsActive));
      this.viewPromptsButton?.setAttribute('aria-selected', String(promptsActive));
      this.viewConversationButton?.setAttribute('tabindex', conversationActive ? '0' : '-1');
      this.viewHeadingsButton?.setAttribute('tabindex', headingsActive ? '0' : '-1');
      this.viewPromptsButton?.setAttribute('tabindex', promptsActive ? '0' : '-1');
    }

    updateViewMeta() {
      const conversationCount = this.conversationItems.length;
      const headingCount = this.headings.length;
      const promptCount = this.promptLibrary?.count || 0;
      const conversationActive = this.activeView === 'conversation';
      const promptsActive = this.activeView === 'prompts';
      const activeCount = conversationActive ? conversationCount : promptsActive ? promptCount : headingCount;

      if (this.viewConversationCount) {
        this.viewConversationCount.textContent = String(conversationCount);
      }
      if (this.viewHeadingsCount) {
        this.viewHeadingsCount.textContent = String(headingCount);
      }
      if (this.viewPromptsCount) {
        this.viewPromptsCount.textContent = String(promptCount);
      }
      if (this.countLabel) {
        this.countLabel.textContent = conversationActive
          ? `${conversationCount} 问`
          : promptsActive ? `${promptCount} 条提示词` : `${headingCount} 节`;
      }
      if (this.launcherMode) {
        this.launcherMode.textContent = conversationActive ? '问' : promptsActive ? '词' : '章';
      }
      if (this.launcherCount) {
        this.launcherCount.textContent = String(activeCount);
      }
      if (this.launcher) {
        this.launcher.title = `悬停临时展开；在目录中点击、拖动或缩放后保持展开；问答 ${conversationCount}，章节 ${headingCount}，提示词 ${promptCount}`;
      }
      if (this.conversationEmptyState) {
        this.conversationEmptyState.hidden = conversationCount > 0;
      }
      if (this.headingEmptyState) {
        this.headingEmptyState.hidden = headingCount > 0;
      }
    }

    getVisibleWidget() {
      if (!this.launcher || !this.panel) return null;
      return this.collapsed ? this.launcher : this.panel;
    }

    getWidgetDockSide(rect) {
      const viewportWidth = Math.max(1, document.documentElement.clientWidth);
      const centerX = rect.left + rect.width / 2;
      return centerX <= viewportWidth / 2 ? 'left' : 'right';
    }

    captureWidgetEdgeAnchor() {
      if (this.positionMode !== 'manual') return null;

      const widget = this.getVisibleWidget();
      if (!(widget instanceof HTMLElement) || widget.hidden) return null;

      const rect = widget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      const side = this.getWidgetDockSide(rect);
      if (this.host) this.host.dataset.dockSide = side;
      return {
        side,
        left: rect.left,
        right: rect.right,
        top: rect.top,
      };
    }

    alignManualWidgetToEdgeAnchor(anchor, persist = false) {
      if (!anchor || this.positionMode !== 'manual' || !this.host || this.host.hidden) {
        return;
      }

      const widget = this.getVisibleWidget();
      if (!(widget instanceof HTMLElement) || widget.hidden) return;

      const rect = widget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const desiredLeft = anchor.side === 'right'
        ? anchor.right - rect.width
        : anchor.left;
      const clamped = this.clampPosition(
        desiredLeft,
        anchor.top,
        rect.width,
        rect.height,
      );

      this.host.dataset.dockSide = anchor.side;
      this.setManualPosition(clamped.left, clamped.top, persist);
    }

    readCollapsedState() {
      if (!this.config.answerTocRememberCollapsedState) {
        return this.config.answerTocInitiallyCollapsed;
      }

      try {
        const stored = localStorage.getItem('cgpt-answer-toc-collapsed');
        if (stored === '1') return true;
        if (stored === '0') return false;
      } catch {
        // 某些严格隐私模式可能阻止 localStorage。
      }

      return this.config.answerTocInitiallyCollapsed;
    }

    writeCollapsedState() {
      if (!this.config.answerTocRememberCollapsedState) return;

      try {
        localStorage.setItem('cgpt-answer-toc-collapsed', this.collapsed ? '1' : '0');
      } catch {
        // 忽略存储不可用的情况。
      }
    }

    cancelHoverExpand() {
      window.clearTimeout(this.hoverExpandTimer);
      this.hoverExpandTimer = 0;
    }

    cancelHoverCollapse() {
      window.clearTimeout(this.hoverCollapseTimer);
      this.hoverCollapseTimer = 0;
    }

    captureHoverOriginRect() {
      if (!(this.launcher instanceof HTMLElement) || this.launcher.hidden) return null;
      const rect = this.launcher.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    }

    isPointInsideRect(clientX, clientY, rect, tolerance = 0) {
      return Boolean(
        rect &&
        Number.isFinite(clientX) &&
        Number.isFinite(clientY) &&
        clientX >= rect.left - tolerance &&
        clientX <= rect.right + tolerance &&
        clientY >= rect.top - tolerance &&
        clientY <= rect.bottom + tolerance
      );
    }

    clearTransientOriginClickSuppression() {
      window.clearTimeout(this.suppressTransientOriginClickTimer);
      this.suppressTransientOriginClickTimer = 0;
      this.suppressTransientOriginClick = false;
      this.suppressTransientOriginClickRect = null;
    }

    armTransientOriginClickSuppression(rect) {
      this.clearTransientOriginClickSuppression();
      this.suppressTransientOriginClick = true;
      this.suppressTransientOriginClickRect = rect ? { ...rect } : null;
      this.suppressTransientOriginClickTimer = window.setTimeout(() => {
        this.clearTransientOriginClickSuppression();
      }, 900);
    }

    onDocumentPointerDown(event) {
      if (event.isTrusted && this.conversationLabelHydrating) {
        this.cancelConversationLabelHydration();
      }
      if (!this.transientHoverOpen || this.collapsed) return;
      if (
        event instanceof PointerEvent &&
        (event.button !== 0 || event.isPrimary === false)
      ) {
        return;
      }

      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      const insidePanel = Boolean(this.host && path.includes(this.host));
      const insideOrigin = this.isPointInsideRect(
        event.clientX,
        event.clientY,
        this.transientHoverOriginRect,
        3,
      );

      if (!insidePanel && !insideOrigin) return;

      if (insideOrigin) {
        /*
         * 面板展开后，原启动器位置通常会被“收起”按钮覆盖。抑制这一次
         * 随后的 click，避免用户本想点击展开，却立即触发收起。
         */
        this.armTransientOriginClickSuppression(this.transientHoverOriginRect);
      }

      // pointerdown 早于 click：先把临时悬浮状态提升为持久展开。
      this.pinTransientHoverOpen(true);
    }

    onDocumentClick(event) {
      if (!this.suppressTransientOriginClick) return;

      const shouldSuppress = this.isPointInsideRect(
        event.clientX,
        event.clientY,
        this.suppressTransientOriginClickRect,
        5,
      );
      this.clearTransientOriginClickSuppression();
      if (!shouldSuppress) return;

      event.preventDefault();
      event.stopPropagation();
    }

    scheduleHoverCollapse() {
      this.cancelHoverCollapse();
      if (
        !this.transientHoverOpen ||
        this.collapsed ||
        this.dragState ||
        this.resizeState
      ) {
        return;
      }

      const delay = Math.max(
        0,
        Number(this.config.answerTocHoverCollapseDelayMs) || 0,
      );
      this.hoverCollapseTimer = window.setTimeout(() => {
        this.hoverCollapseTimer = 0;
        if (
          this.transientHoverOpen &&
          !this.collapsed &&
          !this.dragState &&
          !this.resizeState &&
          !this.panel?.matches(':hover')
        ) {
          this.setCollapsed(true, { source: 'hover-leave', persist: false });
        }
      }, delay);
    }

    onLauncherPointerEnter(event) {
      this.launcherHovered = true;
      this.cancelHoverCollapse();
      if (
        !this.collapsed ||
        this.dragState ||
        this.resizeState ||
        (event.pointerType && event.pointerType !== 'mouse')
      ) {
        return;
      }

      this.cancelHoverExpand();
      const delay = Math.max(0, Number(this.config.answerTocHoverExpandDelayMs) || 0);
      this.hoverExpandTimer = window.setTimeout(() => {
        this.hoverExpandTimer = 0;
        if (this.collapsed && this.launcherHovered && !this.dragState && !this.resizeState) {
          this.transientHoverOriginRect = this.captureHoverOriginRect();
          this.setCollapsed(false, { source: 'hover', persist: false });
          window.requestAnimationFrame(() => {
            if (this.transientHoverOpen && !this.panel?.matches(':hover')) {
              this.scheduleHoverCollapse();
            }
          });
        }
      }, delay);
    }

    onLauncherPointerLeave() {
      this.launcherHovered = false;
      this.cancelHoverExpand();
    }

    onPanelPointerEnter() {
      this.cancelHoverCollapse();
    }

    onPanelPointerLeave(event) {
      const related = event.relatedTarget;
      if (
        related instanceof Node &&
        (this.panel?.contains(related) || this.launcher?.contains(related))
      ) {
        return;
      }
      this.scheduleHoverCollapse();
    }

    /*
     * 悬浮展开只有在“纯浏览、无交互”时才会自动收起。
     * 一旦用户点击、拖动或缩放目录，就将本次展开提升为持久展开。
     */
    pinTransientHoverOpen(persist = true) {
      if (!this.transientHoverOpen || this.collapsed) return false;

      this.transientHoverOpen = false;
      this.cancelHoverCollapse();
      this.transientHoverOriginRect = null;
      if (persist) this.writeCollapsedState();
      return true;
    }

    onPanelClickCapture(event) {
      const target = event.target;

      // “收起”按钮是明确的折叠意图，不先把状态提升为持久展开。
      if (target instanceof Element && target.closest('#collapse-button')) return;
      this.pinTransientHoverOpen(true);
    }

    setCollapsed(collapsed, options = {}) {
      const nextCollapsed = Boolean(collapsed);
      const source = options.source || 'manual';
      const persist = options.persist !== false;

      this.cancelHoverExpand();
      this.cancelHoverCollapse();
      if (nextCollapsed) {
        this.cancelConversationLabelHydration();
        // 键盘/Escape 收起时列表会直接 hidden，浏览器可能不会补发 pointerleave。
        this.headingNavPointerInside = false;
        this.headingNavUserActiveUntil = 0;
      }

      if (!nextCollapsed && source === 'hover') {
        this.transientHoverOpen = true;
      } else if (source !== 'layout') {
        this.transientHoverOpen = false;
        this.transientHoverOriginRect = null;
      }

      if (nextCollapsed === this.collapsed) {
        /*
         * 悬浮已经把面板打开后，后续点击的视觉状态仍是“展开”。这里不能
         * 因状态相同而丢弃点击语义，必须写入持久展开状态。
         */
        if (persist) this.writeCollapsedState();
        this.applyCollapsedState();
        return;
      }

      const edgeAnchor = this.captureWidgetEdgeAnchor();
      this.collapsed = nextCollapsed;
      if (persist) this.writeCollapsedState();
      this.applyCollapsedState();

      if (edgeAnchor) this.alignManualWidgetToEdgeAnchor(edgeAnchor, false);

      window.requestAnimationFrame(() => {
        if (edgeAnchor) {
          this.alignManualWidgetToEdgeAnchor(edgeAnchor, true);
        } else {
          this.ensureManualPositionInViewport(true);
        }

        if (!this.collapsed) {
          this.ensurePanelSizeInViewport(false);
          const current = this.activeView === 'conversation'
            ? this.conversationItemButtons[this.activeConversationIndex]
            : this.itemButtons[this.activeIndex];
          const nav = this.activeView === 'conversation'
            ? this.conversationNav
            : this.tocNav;
          if (current) this.scrollItemIntoView(nav, current);

          if (this.transientHoverOpen && !this.panel?.matches(':hover')) {
            this.scheduleHoverCollapse();
          }
        }
      });
    }

    applyCollapsedState() {
      if (!this.launcher || !this.panel) return;

      if (this.host) this.host.dataset.collapsed = String(this.collapsed);
      this.launcher.hidden = !this.collapsed;
      this.panel.hidden = this.collapsed;
      this.launcher.setAttribute('aria-expanded', String(!this.collapsed));
    }

    beginDrag(event, source) {
      if (
        !(event instanceof PointerEvent) ||
        event.button !== 0 ||
        event.isPrimary === false ||
        this.dragState ||
        this.resizeState ||
        !this.host
      ) {
        return;
      }

      const widget = this.getVisibleWidget();
      if (!(widget instanceof HTMLElement) || widget.hidden) return;

      if (source === 'panel') this.pinTransientHoverOpen(true);
      this.cancelHoverExpand();
      this.cancelHoverCollapse();
      event.preventDefault();

      const rect = widget.getBoundingClientRect();
      this.dragState = {
        pointerId: event.pointerId,
        source,
        captureTarget: event.currentTarget instanceof Element
          ? event.currentTarget
          : null,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top,
        width: rect.width,
        height: rect.height,
        moved: false,
      };

      this.rootStyleBeforeDrag = {
        userSelect: document.documentElement.style.userSelect,
        cursor: document.documentElement.style.cursor,
      };
      document.documentElement.style.userSelect = 'none';
      document.documentElement.style.cursor = 'grabbing';

      try {
        this.dragState.captureTarget?.setPointerCapture?.(event.pointerId);
      } catch {
        // window 级监听仍可完成拖动。
      }

      window.addEventListener('pointermove', this.onDragPointerMove, {
        capture: true,
        passive: false,
      });
      window.addEventListener('pointerup', this.onDragPointerEnd, true);
      window.addEventListener('pointercancel', this.onDragPointerCancel, true);
    }

    onDragPointerMove(event) {
      const state = this.dragState;
      if (!state || event.pointerId !== state.pointerId) return;

      event.preventDefault();
      const deltaX = event.clientX - state.startClientX;
      const deltaY = event.clientY - state.startClientY;

      if (!state.moved) {
        if (Math.hypot(deltaX, deltaY) < 4) return;
        state.moved = true;
        this.host?.setAttribute('data-dragging', '');
        this.setManualPosition(state.startLeft, state.startTop, false);
      }

      this.pendingDragPoint = {
        clientX: event.clientX,
        clientY: event.clientY,
      };

      if (this.dragFrameId) return;
      this.dragFrameId = window.requestAnimationFrame(() => {
        this.dragFrameId = 0;
        const point = this.pendingDragPoint;
        this.pendingDragPoint = null;
        if (point) this.applyDragPoint(point.clientX, point.clientY);
      });
    }

    applyDragPoint(clientX, clientY) {
      const state = this.dragState;
      if (!state?.moved) return;

      const left = state.startLeft + clientX - state.startClientX;
      const top = state.startTop + clientY - state.startClientY;
      const clamped = this.clampPosition(left, top, state.width, state.height);
      this.setManualPosition(clamped.left, clamped.top, false);
    }

    onDragPointerEnd(event) {
      this.finishDrag(event, false);
    }

    onDragPointerCancel(event) {
      this.finishDrag(event, true);
    }

    finishDrag(event, cancelled) {
      const state = this.dragState;
      if (!state || event.pointerId !== state.pointerId) return;

      if (this.dragFrameId) {
        window.cancelAnimationFrame(this.dragFrameId);
        this.dragFrameId = 0;
      }

      const point = this.pendingDragPoint;
      this.pendingDragPoint = null;
      if (point && state.moved) this.applyDragPoint(point.clientX, point.clientY);

      try {
        state.captureTarget?.releasePointerCapture?.(state.pointerId);
      } catch {
        // 忽略 pointer capture 已释放的情况。
      }

      window.removeEventListener('pointermove', this.onDragPointerMove, true);
      window.removeEventListener('pointerup', this.onDragPointerEnd, true);
      window.removeEventListener('pointercancel', this.onDragPointerCancel, true);

      this.host?.removeAttribute('data-dragging');
      if (this.rootStyleBeforeDrag) {
        document.documentElement.style.userSelect = this.rootStyleBeforeDrag.userSelect;
        document.documentElement.style.cursor = this.rootStyleBeforeDrag.cursor;
      }
      this.rootStyleBeforeDrag = null;
      this.dragState = null;

      const launcherActivation =
        state.source === 'launcher' &&
        !state.moved &&
        !cancelled;

      if (launcherActivation) {
        /*
         * launcher 的 pointerdown 同时承担拖动起点，并调用了 preventDefault。
         * 某些 Chromium/React 组合不会再派发可靠的 click；在 pointerup 这里
         * 直接按“点击展开”处理，且明确退出 hover 临时展开状态。
         */
        this.suppressNextLauncherClick = true;
        this.setCollapsed(false, { source: 'click', persist: true });
        window.setTimeout(() => {
          this.suppressNextLauncherClick = false;
        }, 0);
        return;
      }

      if (state.moved && !cancelled) {
        this.ensureManualPositionInViewport(true);

        if (state.source === 'launcher') {
          this.suppressNextLauncherClick = true;
          window.setTimeout(() => {
            this.suppressNextLauncherClick = false;
          }, 0);
        }
      }

      this.resumeTransientAutoCollapse(event.clientX, event.clientY);
    }

    beginResize(event, handleCorner) {
      if (
        !(event instanceof PointerEvent) ||
        event.button !== 0 ||
        event.isPrimary === false ||
        this.resizeState ||
        this.dragState ||
        this.collapsed ||
        !this.host ||
        !this.panel
      ) {
        return;
      }

      const allowedCorners = new Set([
        'top-left',
        'top-right',
        'bottom-left',
        'bottom-right',
      ]);
      const corner = allowedCorners.has(handleCorner)
        ? handleCorner
        : 'bottom-right';
      const [verticalSide, horizontalSide] = corner.split('-');
      const rect = this.panel.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      // 缩放属于明确交互：若面板由 hover 临时展开，则从此保持展开。
      this.pinTransientHoverOpen(true);
      this.cancelHoverExpand();
      this.cancelHoverCollapse();
      event.preventDefault();
      event.stopPropagation();

      this.resizeState = {
        pointerId: event.pointerId,
        captureTarget: event.currentTarget instanceof Element
          ? event.currentTarget
          : null,
        corner,
        horizontalSide,
        verticalSide,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startWidth: rect.width,
        startHeight: rect.height,
        startLeft: rect.left,
        startRight: rect.right,
        startTop: rect.top,
        startBottom: rect.bottom,
        moved: false,
      };

      this.rootStyleBeforeResize = {
        userSelect: document.documentElement.style.userSelect,
        cursor: document.documentElement.style.cursor,
      };
      document.documentElement.style.userSelect = 'none';
      document.documentElement.style.cursor = (
        corner === 'top-left' || corner === 'bottom-right'
      ) ? 'nwse-resize' : 'nesw-resize';

      try {
        this.resizeState.captureTarget?.setPointerCapture?.(event.pointerId);
      } catch {
        // window 级监听仍可完成缩放。
      }

      window.addEventListener('pointermove', this.onResizePointerMove, {
        capture: true,
        passive: false,
      });
      window.addEventListener('pointerup', this.onResizePointerEnd, true);
      window.addEventListener('pointercancel', this.onResizePointerCancel, true);
    }

    onResizePointerMove(event) {
      const state = this.resizeState;
      if (!state || event.pointerId !== state.pointerId) return;

      event.preventDefault();
      const deltaX = event.clientX - state.startClientX;
      const deltaY = event.clientY - state.startClientY;

      if (!state.moved) {
        if (Math.hypot(deltaX, deltaY) < 3) return;
        state.moved = true;
        this.host?.setAttribute('data-resizing', '');
        this.setManualPosition(state.startLeft, state.startTop, false);
        this.setPanelSize(state.startWidth, state.startHeight, false);
      }

      this.pendingResizePoint = {
        clientX: event.clientX,
        clientY: event.clientY,
      };

      if (this.resizeFrameId) return;
      this.resizeFrameId = window.requestAnimationFrame(() => {
        this.resizeFrameId = 0;
        const point = this.pendingResizePoint;
        this.pendingResizePoint = null;
        if (point) this.applyResizePoint(point.clientX, point.clientY);
      });
    }

    applyResizePoint(clientX, clientY) {
      const state = this.resizeState;
      if (!state?.moved) return;

      const deltaX = clientX - state.startClientX;
      const deltaY = clientY - state.startClientY;
      const requestedWidth = state.horizontalSide === 'left'
        ? state.startWidth - deltaX
        : state.startWidth + deltaX;
      const requestedHeight = state.verticalSide === 'top'
        ? state.startHeight - deltaY
        : state.startHeight + deltaY;

      const margin = Math.max(
        0,
        Number(this.config.answerTocDragViewportMarginPx) || 0,
      );
      const viewportWidth = Math.max(1, document.documentElement.clientWidth);
      const viewportHeight = Math.max(1, document.documentElement.clientHeight);
      const limits = this.getPanelSizeLimits();

      // 固定对角：从哪个角拖动，就保持其对角在原位置。
      const maxWidthByAnchor = Math.max(
        1,
        state.horizontalSide === 'left'
          ? state.startRight - margin
          : viewportWidth - state.startLeft - margin,
      );
      const maxHeightByAnchor = Math.max(
        1,
        state.verticalSide === 'top'
          ? state.startBottom - margin
          : viewportHeight - state.startTop - margin,
      );
      const effectiveMinWidth = Math.min(limits.minWidth, maxWidthByAnchor);
      const effectiveMaxWidth = Math.max(
        effectiveMinWidth,
        Math.min(limits.maxWidth, maxWidthByAnchor),
      );
      const effectiveMinHeight = Math.min(limits.minHeight, maxHeightByAnchor);
      const effectiveMaxHeight = Math.max(
        effectiveMinHeight,
        Math.min(limits.maxHeight, maxHeightByAnchor),
      );
      const width = Math.round(
        Math.min(effectiveMaxWidth, Math.max(effectiveMinWidth, requestedWidth)),
      );
      const height = Math.round(
        Math.min(effectiveMaxHeight, Math.max(effectiveMinHeight, requestedHeight)),
      );
      const left = state.horizontalSide === 'left'
        ? state.startRight - width
        : state.startLeft;
      const top = state.verticalSide === 'top'
        ? state.startBottom - height
        : state.startTop;

      this.setPanelSize(width, height, false);
      this.setManualPosition(left, top, false);
    }

    onResizePointerEnd(event) {
      this.finishResize(event, false);
    }

    onResizePointerCancel(event) {
      this.finishResize(event, true);
    }

    finishResize(event, cancelled) {
      const state = this.resizeState;
      if (!state || event.pointerId !== state.pointerId) return;

      if (this.resizeFrameId) {
        window.cancelAnimationFrame(this.resizeFrameId);
        this.resizeFrameId = 0;
      }

      const point = this.pendingResizePoint;
      this.pendingResizePoint = null;
      if (point && state.moved) this.applyResizePoint(point.clientX, point.clientY);

      try {
        state.captureTarget?.releasePointerCapture?.(state.pointerId);
      } catch {
        // 忽略 pointer capture 已释放的情况。
      }

      window.removeEventListener('pointermove', this.onResizePointerMove, true);
      window.removeEventListener('pointerup', this.onResizePointerEnd, true);
      window.removeEventListener('pointercancel', this.onResizePointerCancel, true);

      this.host?.removeAttribute('data-resizing');
      if (this.rootStyleBeforeResize) {
        document.documentElement.style.userSelect = this.rootStyleBeforeResize.userSelect;
        document.documentElement.style.cursor = this.rootStyleBeforeResize.cursor;
      }
      this.rootStyleBeforeResize = null;
      this.resizeState = null;

      if (state.moved && !cancelled) {
        this.ensurePanelSizeInViewport(false);
        this.ensureManualPositionInViewport(true);
        this.writeSizeState();
      }

      this.resumeTransientAutoCollapse(event.clientX, event.clientY);
    }

    resumeTransientAutoCollapse(clientX, clientY) {
      if (!this.transientHoverOpen || this.collapsed || this.dragState || this.resizeState) {
        return;
      }

      const rect = this.panel?.getBoundingClientRect();
      const pointInside = rect && Number.isFinite(clientX) && Number.isFinite(clientY)
        ? clientX >= rect.left && clientX <= rect.right &&
          clientY >= rect.top && clientY <= rect.bottom
        : false;
      if (!pointInside && !this.panel?.matches(':hover')) this.scheduleHoverCollapse();
    }

    clampPosition(left, top, width, height) {
      const margin = Math.max(
        0,
        Number(this.config.answerTocDragViewportMarginPx) || 0,
      );
      const visualViewport = window.visualViewport;
      const viewportLeft = Math.max(0, visualViewport?.offsetLeft || 0);
      const viewportTop = Math.max(0, visualViewport?.offsetTop || 0);
      const viewportWidth = Math.max(1, visualViewport?.width || document.documentElement.clientWidth);
      const viewportHeight = Math.max(1, visualViewport?.height || document.documentElement.clientHeight);
      const safeWidth = Math.max(1, Number(width) || 1);
      const safeHeight = Math.max(1, Number(height) || 1);
      const minLeft = viewportLeft + margin;
      const minTop = viewportTop + margin;
      const maxLeft = Math.max(minLeft, viewportLeft + viewportWidth - safeWidth - margin);
      const maxTop = Math.max(minTop, viewportTop + viewportHeight - safeHeight - margin);

      return {
        left: Math.min(maxLeft, Math.max(minLeft, left)),
        top: Math.min(maxTop, Math.max(minTop, top)),
      };
    }

    ensureManualPositionInViewport(persist = false) {
      if (
        this.positionMode !== 'manual' ||
        !this.host ||
        this.host.hidden
      ) {
        return;
      }

      const widget = this.getVisibleWidget();
      if (!(widget instanceof HTMLElement) || widget.hidden) return;

      const rect = widget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      this.host.dataset.dockSide = this.getWidgetDockSide(rect);
      const clamped = this.clampPosition(
        rect.left,
        rect.top,
        rect.width,
        rect.height,
      );
      this.setManualPosition(clamped.left, clamped.top, persist);
    }

    onScroll(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      if (this.host && path.includes(this.host)) return;

      if (this.currentAnswer?.isConnected) {
        const target = event.target;

        if (this.currentScrollRoot instanceof HTMLElement) {
          const isDocumentScroll =
            target === document ||
            target === document.documentElement ||
            target === document.body ||
            target === window;

          if (target !== this.currentScrollRoot && !isDocumentScroll) return;
        } else if (target instanceof Element && !target.contains(this.currentAnswer)) {
          return;
        }
      }

      this.requestFrame(false);
    }

    onResize() {
      if (this.currentAnswer?.isConnected) {
        this.currentScrollRoot = this.findScrollRoot(this.currentAnswer);
      }

      window.requestAnimationFrame(() => {
        this.ensurePanelSizeInViewport(true);
        if (this.positionMode === 'manual') {
          this.ensureManualPositionInViewport(true);
        } else {
          this.updateInlineEndOffset();
        }
      });

      this.syncVisibility();
      this.requestFrame(true);
    }

    onKeyDown(event) {
      if (event.altKey && event.shiftKey && event.code === 'KeyO') {
        if (!this.host?.hidden) {
          event.preventDefault();
          this.setCollapsed(!this.collapsed, { source: 'keyboard', persist: true });
        }
        return;
      }

      if (event.key === 'Escape' && !this.collapsed) {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        if (this.host && path.includes(this.host)) {
          this.setCollapsed(true, { source: 'keyboard', persist: true });
        }
      }
    }

    onVisibilityChange() {
      if (!document.hidden) {
        this.syncOfficialConversationNav();
        this.refreshConversationTocIfNeeded();
        this.requestFrame(true);
      }
    }

    onRouteSignal() {
      window.setTimeout(() => this.resetForNavigation(), 0);
      window.setTimeout(() => this.requestFrame(true), 180);
    }

    getConversationRouteKey(value = location.href) {
      try {
        const url = new URL(value, location.origin);
        return `${url.origin}${url.pathname}`;
      } catch {
        return String(value || '').split(/[?#]/, 1)[0];
      }
    }

    resetForNavigation() {
      const nextUrl = location.href;
      const nextRouteKey = this.getConversationRouteKey(nextUrl);
      const routeChanged = nextRouteKey !== this.lastConversationRouteKey;
      this.lastUrl = nextUrl;
      this.lastConversationRouteKey = nextRouteKey;
      this.cancelConversationJump();
      this.cancelHeadingJump();
      this.cancelConversationLabelHydration(!routeChanged);

      if (routeChanged) {
        this.userPromptTextCache = new WeakMap();
        this.pendingApiOutline = null;
        this.resolvedApiOutline = null;
        this.lastConversationDataSignature = '';
        this.clearConversationLabelCacheState();
        this.maxObservedOfficialLogicalIndex = -1;
        this.restoreConversationLabelSnapshot();
        this.clearConversationToc();
        this.apiConversationOutline = null;
        this.apiConversationRefreshToken += 1;
        this.apiConversationRefreshInFlight = false;
        globalThis.__cgptUnifiedRuntimeV1?.sessionExporter?.invalidateApiTreeCache?.();
      } else {
        // React 仅替换 main 或 URL 查询参数变化时保留完整问答目录快照。
        this.lastConversationSignature = '';
      }

      this.disconnectCurrentAnswer();
      this.clearToc();
      this.bindMainObserver();
      this.syncOfficialConversationNav();
      this.scheduleConversationRebuild(80);
      this.scheduleApiConversationOutlineRefresh(120, routeChanged);
      this.updateInlineEndOffset();
      this.requestFrame(true);
    }

    bindMainObserver() {
      const activeMain = dom.main();
      const conversationAnchor =
        document.querySelector(dom.assistant) ||
        document.querySelector(dom.user) ||
        document.querySelector('[data-composer-surface="true"], [data-chatgpt-composer], #prompt-textarea');
      const main = activeMain || conversationAnchor?.closest('main');
      if (!main) {
        window.clearTimeout(this.rebindTimer);
        this.rebindTimer = window.setTimeout(() => this.bindMainObserver(), 300);
        return;
      }

      if (main === this.mainElement && this.mainObserver) return;

      this.mainObserver?.disconnect();
      this.mainElement = main;
      this.mainObserver = globalThis.__cgptUnifiedRuntimeV1.pageWork.observe(main, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-message-id', 'data-turn-key', 'data-chatgpt-search-message-ids',
          'data-chatgpt-selection-message-id', 'data-toc-item-index', 'aria-label', 'title'],
      }, this.onMainMutations);
      this.scheduleConversationRebuild(60);
    }

    nodeMatchesOrContains(node, selector) {
      return node instanceof Element && (
        node.matches?.(selector) || Boolean(node.querySelector?.(selector))
      );
    }

    onMainMutations(records) {
      let assistantAdded = false;
      let conversationChanged = false;

      for (const record of records) {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        const ownSelector = '[data-cgpt-token-chip], .cgpt-unified-copy-message-md';
        const changedNodes = [...(record.addedNodes || []), ...(record.removedNodes || [])];
        if (target?.closest(ownSelector) || (record.type === 'childList' && changedNodes.length
          && changedNodes.every((node) => node instanceof Element && node.matches(ownSelector)))) continue;
        const user = target?.closest(`${dom.user}, [data-chatgpt-search-unit-key$=":user"]`);
        if (user) {
          this.userPromptTextCache?.delete(user);
          conversationChanged = true;
        }
        if (record.type === 'attributes' && target?.matches('button[data-toc-item-index]')) {
          conversationChanged = true;
        }
        if (
          this.currentAnswer?.isConnected &&
          record.target instanceof Node &&
          this.currentAnswer.contains(record.target)
        ) {
          continue;
        }

        for (const node of [...(record.addedNodes || []), ...(record.removedNodes || [])]) {
          if (this.nodeMatchesOrContains(node, dom.assistant)) {
            assistantAdded = true;
          }
          if (
            this.nodeMatchesOrContains(node, dom.user) ||
            this.nodeMatchesOrContains(node, 'button[data-toc-item-index]')
          ) {
            conversationChanged = true;
          }
        }
      }

      if (this.currentAnswer && !this.currentAnswer.isConnected) {
        this.disconnectCurrentAnswer();
        this.clearToc();
        assistantAdded = true;
      }

      if (conversationChanged) {
        this.conversationLabelHydrationAttempts?.clear();
        this.scheduleConversationRebuild();
        if (this.pendingConversationLogicalIndex < 0) {
          this.scheduleApiConversationOutlineRefresh(420, true);
        }
      }
      if (assistantAdded) {
        if (this.pendingConversationLogicalIndex < 0) {
          this.requestFrame(true);
          // 新回答节点出现时再补一次强制刷新，覆盖“发送后 API 尚未落库”的短窗口。
          this.scheduleApiConversationOutlineRefresh(700, false);
        }
      }
    }

    requestFrame(forceAnswerDetection) {
      this.forceAnswerDetection ||= Boolean(forceAnswerDetection);
      if (this.frameId) return;

      this.frameId = globalThis.__cgptUnifiedRuntimeV1.pageWork.requestFrame((timestamp) => {
        this.frameId = 0;

        if (!this.isViewportEligible()) {
          this.syncVisibility();
          return;
        }

        const elapsedSinceDetection = timestamp - this.lastAnswerDetectionAt;
        const shouldDetect =
          this.forceAnswerDetection ||
          !this.currentAnswer?.isConnected ||
          elapsedSinceDetection >= 180;

        this.forceAnswerDetection = false;

        if (shouldDetect) {
          window.clearTimeout(this.answerDetectionTimer);
          this.answerDetectionTimer = 0;
          this.lastAnswerDetectionAt = timestamp;
          this.detectCurrentAnswer();
        } else {
          window.clearTimeout(this.answerDetectionTimer);
          this.answerDetectionTimer = window.setTimeout(() => {
            this.answerDetectionTimer = 0;
            this.requestFrame(true);
          }, Math.max(0, Math.ceil(180 - elapsedSinceDetection)));
        }

        this.updateActiveHeading();
      });
    }

    detectCurrentAnswer() {
      // A smooth jump passes other answers. Keep its outline until it settles.
      if (this.pendingHeadingIndex >= 0 && performance.now() < this.pendingHeadingUntil
        && this.currentAnswer?.isConnected) return;
      const answer = this.findAnswerAtViewport();

      if (answer && answer !== this.currentAnswer) {
        this.setCurrentAnswer(answer);
      } else if (this.currentAnswer && !this.currentAnswer.isConnected) {
        this.disconnectCurrentAnswer();
        this.clearToc();
      }
    }

    findAnswerAtViewport() {
      const width = document.documentElement.clientWidth;
      const height = document.documentElement.clientHeight;
      if (width < 1 || height < 1) return null;

      // 阅读指针优先：当前章节与当前回答尽量使用同一条 28% 活动线。
      // 若活动线恰好落在空白/浮层，再退回原来的多点加权算法。
      const activeY = Math.min(height - 1, Math.max(0, this.getActiveLineViewportY()));
      for (const xRatio of [0.5, 0.42, 0.58]) {
        const x = Math.min(width - 1, Math.max(0, width * xRatio));
        const element = document.elementFromPoint(x, activeY);
        const answer = element?.closest?.(dom.assistant);
        if (answer) return answer;
      }

      const yRatios = [
        this.config.answerTocActiveLineRatio,
        0.5,
        0.68,
        0.16,
        0.82,
      ];
      const scores = new Map();

      const sampleAtX = (xRatio) => {
        const x = Math.min(width - 1, Math.max(0, width * xRatio));

        for (const yRatio of yRatios) {
          const y = Math.min(height - 1, Math.max(0, height * yRatio));
          const element = document.elementFromPoint(x, y);
          const answer = element?.closest?.(dom.assistant);
          if (!answer) continue;

          const verticalWeight =
            1 / (0.18 + Math.abs(yRatio - this.config.answerTocActiveLineRatio));
          const currentBonus = answer === this.currentAnswer ? 0.15 : 0;
          scores.set(answer, (scores.get(answer) ?? 0) + verticalWeight + currentBonus);
        }
      };

      sampleAtX(0.5);
      if (scores.size === 0) {
        sampleAtX(0.42);
        sampleAtX(0.58);
      }

      let bestAnswer = null;
      let bestScore = -Infinity;
      for (const [answer, score] of scores) {
        if (score > bestScore) {
          bestAnswer = answer;
          bestScore = score;
        }
      }
      if (bestAnswer) return bestAnswer;

      let currentStillVisible = false;
      if (this.currentAnswer?.isConnected) {
        const rect = this.currentAnswer.getBoundingClientRect();
        currentStillVisible = rect.bottom > 0 && rect.top < height;
      }

      if (!currentStillVisible) {
        let bestVisiblePixels = 0;
        for (const answer of document.querySelectorAll(ASSISTANT_SELECTOR)) {
          const rect = answer.getBoundingClientRect();
          const visiblePixels = Math.max(
            0,
            Math.min(rect.bottom, height) - Math.max(rect.top, 0),
          );
          if (visiblePixels > bestVisiblePixels) {
            bestVisiblePixels = visiblePixels;
            bestAnswer = answer;
          }
        }
      }

      return bestAnswer;
    }

    setCurrentAnswer(answer) {
      this.disconnectCurrentAnswer();

      this.currentAnswer = answer;
      this.outlineTextCache = new WeakMap();
      this.currentContentRoot = answer;
      this.currentScrollRoot = this.findScrollRoot(answer);
      this.lastScrollTop = this.getScrollTop();

      this.answerObserver = new MutationObserver(this.onAnswerMutations);
      this.answerObserver.observe(answer, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      this.rebuildToc();
      this.scheduleConversationRebuild(30);
      this.updateActiveConversation(true);
      this.updateInlineEndOffset();
    }

    disconnectCurrentAnswer() {
      this.answerObserver?.disconnect();
      this.answerObserver = null;
      this.headingTextObserver?.disconnect();
      this.headingTextObserver = null;
      this.currentAnswer = null;
      this.currentContentRoot = null;
      this.currentScrollRoot = null;
      this.activeIndex = -1;
      this.cancelHeadingJump();
      this.lastScrollTop = 0;
      window.clearTimeout(this.answerDetectionTimer);
      this.answerDetectionTimer = 0;
      window.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = 0;
    }

    onAnswerMutations(records) {
      this.invalidateOutlineText(records);
      const ownSelector = '[data-cgpt-token-chip], .cgpt-unified-copy-message-md';
      records = records.filter(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target?.closest(ownSelector)) return false;
        const changed = [...(record.addedNodes || []), ...(record.removedNodes || [])];
        return !(record.type === 'childList' && changed.length && changed.every(node => node instanceof Element && node.matches(ownSelector)));
      });
      let touchesHeading = false;

      for (const record of records) {
        if (record.type !== 'childList') continue;

        if (
          record.target instanceof Element &&
          record.target.closest(this.config.answerTocHeadingSelector)
        ) {
          touchesHeading = true;
          break;
        }

        const changedNodes = [...record.addedNodes, ...record.removedNodes];
        for (const node of changedNodes) {
          if (!(node instanceof Element)) continue;
          if (
            node.matches?.(this.config.answerTocHeadingSelector) ||
            node.querySelector?.(this.config.answerTocHeadingSelector)
          ) {
            touchesHeading = true;
            break;
          }
        }
        if (touchesHeading) break;
      }

      if (touchesHeading || (this.config.answerTocDerivedOutline && records.length)) {
        this.scheduleTocRebuild();
      }
    }

    scheduleTocRebuild() {
      window.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = window.setTimeout(() => {
        this.rebuildTimer = 0;
        this.rebuildToc();
      }, 180);
    }

    rebuildToc() {
      if (!this.currentAnswer?.isConnected || !this.currentContentRoot) {
        this.clearToc();
        return;
      }

      this.invalidateOutlineText(this.answerObserver?.takeRecords() || []);
      this.headingTextObserver?.disconnect();

      const headings = [];
      const hasMarkdownRoot =
        this.currentAnswer.matches(dom.content) ||
        Boolean(this.currentAnswer.querySelector(dom.content));
      const nodes = this.currentContentRoot.querySelectorAll(
        this.config.answerTocHeadingSelector,
      );

      for (const element of nodes) {
        if (!(element instanceof HTMLElement)) continue;
        if (element.closest('[hidden], [aria-hidden="true"]')) continue;
        if (hasMarkdownRoot && !element.closest(dom.content)) continue;
        if (element.closest(dom.assistant) !== this.currentAnswer) {
          continue;
        }

        const fullLabel = this.normalizeText(element.textContent ?? '');
        if (!fullLabel) continue;

        headings.push({
          element,
          level: Number.parseInt(element.tagName.slice(1), 10) || 2,
          fullLabel,
          label: this.truncateLabel(fullLabel, this.config.answerTocMaxLabelLength, 180),
        });
      }

      if (this.config.answerTocDerivedOutline) {
        headings.push(...this.collectAdaptiveOutline(headings));
      }
      headings.sort((a, b) => {
        if (a.element === b.element) return 0;
        const position = a.element.compareDocumentPosition(b.element);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
      this.normalizeOutlineLevels(headings);

      // 正式 H1-H6 一律完整保留；answerTocDerivedMaxItems 只限制自动派生项。
      const pendingElement = this.pendingHeadingElement;
      const unchanged = headings.length === this.headings.length && headings.every((heading, index) => {
        const previous = this.headings[index];
        return previous.element === heading.element && previous.label === heading.label
          && previous.fullLabel === heading.fullLabel && previous.displayLevel === heading.displayLevel
          && previous.derived === heading.derived;
      });
      this.headings = headings;
      if (pendingElement) {
        const nextIndex = headings.findIndex(heading => heading.element === pendingElement);
        if (nextIndex < 0) this.cancelHeadingJump();
        else this.pendingHeadingIndex = nextIndex;
      }
      this.observeHeadingText();
      if (!unchanged || this.itemButtons.length !== headings.length) this.renderTocItems();
      const nextActiveIndex = this.pendingHeadingIndex >= 0
        ? this.pendingHeadingIndex : this.findActiveIndexBinary();
      this.activeIndex = -1;
      this.applyActiveIndex(nextActiveIndex, false);
      this.updateViewMeta();
      this.syncVisibility();
    }

    normalizeOutlineLevels(headings) {
      /*
       * 正式 H1-H6 单独建立层级栈。派生章节只能“挂在”最近的正式章节下，
       * 绝不能进入这个栈，否则一个正文候选会改变后续 H3/H4 的真实父子关系。
       */
      const formalStack = [];
      const formalItems = headings.filter((heading) => !heading.derived);
      for (const heading of formalItems) {
        const rawLevel = Math.min(6, Math.max(1, Number(heading.level) || 2));
        while (formalStack.length && formalStack[formalStack.length - 1].rawLevel >= rawLevel) {
          formalStack.pop();
        }
        heading.rawLevel = rawLevel;
        heading.displayLevel = Math.min(4, formalStack.length + 1);
        formalStack.push({ rawLevel, displayLevel: heading.displayLevel });
      }

      let previousFormal = null;
      const hasFormal = formalItems.length > 0;
      for (const heading of headings) {
        const rawLevel = Math.min(6, Math.max(1, Number(heading.level) || 2));
        heading.rawLevel = rawLevel;
        if (!heading.derived) {
          previousFormal = heading;
          continue;
        }

        // 完全没有 Markdown 标题时，自动识别出的章节彼此都是一级章节。
        // 有正式标题时，派生项作为最近正式章节的一级子项显示。
        heading.displayLevel = !hasFormal || !previousFormal
          ? 1
          : Math.min(4, (previousFormal.displayLevel || 1) + 1);
      }
      return headings;
    }

    extractOutlineSentence(value) {
      const source = this.normalizeText(value ?? '').replace(/\*\*([^*]+)\*\*/g, '$1');
      if (!source) return '';

      const endpoints = [];
      const lineBreak = source.indexOf('\n');
      if (lineBreak >= 0) endpoints.push(lineBreak);

      // 中文句号后通常没有空格，不能沿用英文的“标点 + 空格”分句规则。
      const cjk = /[。！？]/u.exec(source);
      if (cjk) endpoints.push(cjk.index + cjk[0].length);

      // 英文句号保守要求后接空白或文本结束，避免把 3.14 / v1.3.1 切碎。
      // A list marker is part of the heading, not an English sentence ending.
      const marker = /^(?:\d+(?:\.\d+)*|[一二三四五六七八九十百零〇]+)[.)．]\s+/u.exec(source);
      const offset = marker?.[0].length || 0;
      const latin = /[.!?](?=\s|$)/u.exec(source.slice(offset));
      if (latin) endpoints.push(offset + latin.index + latin[0].length);

      const end = endpoints.length ? Math.min(...endpoints) : source.length;
      return source.slice(0, end).trim();
    }

    canonicalOutlineLabel(value) {
      return this.normalizeText(value ?? '')
        .toLocaleLowerCase()
        .replace(
          /^\s*(?:(?:第\s*)?[一二三四五六七八九十百零〇\d]+\s*(?:章|节|部分|篇|卷|单元)\s*[：:、.．)）-]?\s*|[一二三四五六七八九十百零〇]+\s*[、.．：:)）]\s*|\d+(?:\.\d+)*(?:\s*[.)、：:．-]\s*|\s+)|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*)/u,
          '',
        )
        .replace(/[\s\p{P}\p{S}]+/gu, '');
    }

    outlineText(element) {
      this.outlineTextCache ||= new WeakMap();
      if (this.outlineTextCache.has(element)) return this.outlineTextCache.get(element);
      const text = this.normalizeText(element.textContent ?? '');
      this.outlineTextCache.set(element, text);
      return text;
    }

    invalidateOutlineText(records) {
      if (!this.outlineTextCache) return;
      for (const record of records) {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        for (let node = target; node; node = node.parentElement) {
          this.outlineTextCache.delete(node);
          if (node === this.currentAnswer) break;
        }
        // React can remove a subtree, edit it off-document and insert it again.
        // Forget its old labels as well as the changed ancestor chain.
        for (const node of record.addedNodes || []) {
          if (!(node instanceof Element)) continue;
          this.outlineTextCache.delete(node);
          for (const child of node.querySelectorAll('*')) this.outlineTextCache.delete(child);
        }
      }
    }

    collectDerivedOutline() {
      const answer = this.currentAnswer;
      if (!(answer instanceof HTMLElement)) return [];
      const markdownRoot = answer.matches(dom.content) ? answer : answer.querySelector(dom.content);
      const root = markdownRoot || answer;
      const minLength = Math.max(3, Number(this.config.answerTocDerivedMinTextLength) || 8);
      const maxItems = Math.max(3, Number(this.config.answerTocDerivedMaxItems) || 18);
      const belongsToAnswer = (element) =>
        element.closest(dom.assistant) === answer
        && !element.closest('[hidden], [aria-hidden="true"]');
      const makeItem = (element, level, prefix = '') => {
        const raw = this.outlineText(element);
        if (raw.length < minLength) return null;
        const sentence = this.extractOutlineSentence(raw) || raw;
        const fullLabel = prefix + sentence.slice(0, 220);
        return {
          element,
          level,
          fullLabel,
          label: this.truncateLabel(fullLabel, this.config.answerTocMaxLabelLength, 180),
          derived: true,
        };
      };

      // Atlas 风格的最大标题层级降级：H1/H2 缺失时仍使用 H3-H6。
      const lowerHeadings = Array.from(root.querySelectorAll('h3, h4, h5, h6'))
        .filter((element) => element instanceof HTMLElement && belongsToAnswer(element))
        .map((element) => makeItem(element, Number(element.tagName.slice(1))))
        .filter(Boolean);
      if (lowerHeadings.length) return lowerHeadings.slice(0, maxItems);

      // 其次识别“加粗段首/独立加粗段”，它们常被模型当作视觉章节标题。
      const strongSections = Array.from(root.querySelectorAll('p, li'))
        .filter((element) => element instanceof HTMLElement && belongsToAnswer(element))
        .map((element) => {
          const strong = element.querySelector(':scope > strong:first-child, :scope > b:first-child, :scope > [data-d-component="text"][data-d-default-strong]:first-child, :scope > [data-d-component="text"][data-d-weight="bold"]:first-child');
          if (!(strong instanceof HTMLElement)) return null;
          const label = this.outlineText(strong);
          if (label.length < 2 || label.length > 100) return null;
          return {
            element,
            level: element.tagName === 'LI' ? 3 : 2,
            fullLabel: label,
            label: this.truncateLabel(label, this.config.answerTocMaxLabelLength, 180),
            derived: true,
          };
        }).filter(Boolean);
      if (strongSections.length >= 2) return strongSections.slice(0, maxItems);

      // 最后按顶层结构块建立“幽灵章节”，使完全无标题的回答仍可导航。
      let blocks = Array.from(root.querySelectorAll(':scope > p, :scope > blockquote, :scope > pre, :scope > ul, :scope > ol, :scope > table, :scope > div'))
        .filter((element) => element instanceof HTMLElement && belongsToAnswer(element));
      if (!blocks.length) {
        blocks = Array.from(root.querySelectorAll('p, blockquote, pre, ul, ol, table'))
          .filter((element) => element instanceof HTMLElement && belongsToAnswer(element));
      }
      const meaningful = blocks.filter((element) => this.outlineText(element).length >= minLength);
      const stride = Math.max(1, Math.ceil(meaningful.length / maxItems));
      return meaningful.filter((_, index) => index === 0 || index % stride === 0)
        .slice(0, maxItems)
        .map((element) => {
          const prefix = element.tagName === 'PRE' ? '代码：' : element.tagName === 'TABLE' ? '表格：' : '';
          return makeItem(element, 3, prefix);
        }).filter(Boolean);
    }

    collectAdaptiveOutline(existing = []) {
      const answer = this.currentAnswer;
      if (!(answer instanceof HTMLElement)) return [];
      const markdownRoot = answer.matches(dom.content) ? answer : answer.querySelector(dom.content);
      const root = markdownRoot || answer;
      const minLength = Math.max(3, Number(this.config.answerTocDerivedMinTextLength) || 8);
      const maxItems = Math.max(3, Number(this.config.answerTocDerivedMaxItems) || 18);
      const minScore = Math.max(0, Number(this.config.answerTocDerivedMinScore) || 60);
      const totalTextLength = this.outlineText(root).length;
      const separatorTarget = Math.min(6, root.querySelectorAll('hr').length + 1);
      const targetCount = Math.min(maxItems, Math.max(
        existing.length,
        separatorTarget,
        totalTextLength >= 1400 ? 4 : totalTextLength >= 600 ? 3 : totalTextLength >= 240 ? 2 : 1,
      ));
      const needed = Math.max(0, targetCount - existing.length);
      if (!needed) return [];

      const existingElements = new Set(existing.map((item) => item.element));
      const canonicalLabel = (value) => this.canonicalOutlineLabel(value);
      const existingLabels = new Set(existing.map((item) => canonicalLabel(item.fullLabel)));
      const belongsToAnswer = (element) =>
        element.closest(dom.assistant) === answer
        && !element.closest('[hidden], [aria-hidden="true"]');
      const compareElements = (a, b) => {
        if (a === b) return 0;
        const position = a.compareDocumentPosition(b);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      };
      const sentenceFrom = (value) => this.extractOutlineSentence(value);
      const makeItem = (element, labelOverride = '', level = 3) => {
        if (!(element instanceof HTMLElement) || existingElements.has(element) || !belongsToAnswer(element)) return null;
        const raw = this.outlineText(element);
        const source = this.normalizeText(labelOverride || raw).replace(/\*\*([^*]+)\*\*/g, '$1');
        if (raw.length < minLength || source.length < 2) return null;
        const sentence = sentenceFrom(source);
        const prefix = element.tagName === 'PRE' ? '代码：' : element.tagName === 'TABLE' ? '表格：' : '';
        const fullLabel = (prefix + sentence).slice(0, 220);
        const key = canonicalLabel(fullLabel);
        if (!key || existingLabels.has(key)) return null;
        return {
          element,
          level,
          fullLabel,
          label: this.truncateLabel(fullLabel, this.config.answerTocMaxLabelLength, 180),
          derived: true,
        };
      };
      const extractLeadingLabel = (element) => {
        const raw = this.outlineText(element);
        const markdownBold = raw.match(/^\*\*([^*\n]{2,100})\*\*[:：]?/);
        if (markdownBold) return this.normalizeText(markdownBold[1]);
        const strong = element.querySelector(':scope > strong:first-child, :scope > b:first-child, :scope > [data-d-component="text"][data-d-default-strong]:first-child, :scope > [data-d-component="text"][data-d-weight="bold"]:first-child');
        if (!(strong instanceof HTMLElement)) return '';
        let textBefore = '';
        for (const node of element.childNodes) {
          if (node === strong) break;
          textBefore += node.textContent ?? '';
        }
        if (this.normalizeText(textBefore)) return '';
        const label = this.outlineText(strong);
        return label.length >= 2 && label.length <= 100 ? label : '';
      };
      const looksLikeNumberedTitle = (label) => /^(?:#{0,6}\s*)?(?:\d+(?:\.\d+)*(?:[.)、：:．-]|\s+)|[一二三四五六七八九十百零〇]+[、.．：:)）]|第[一二三四五六七八九十百零〇\d]+(?:章|节|部分|篇|卷|单元)|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])\s*\S+/.test(label);
      const lowSignalLead = /^(?:所以|因此|那么|然后|接下来|另外|不过|但是|其实|当然|总之|换句话说|也就是说|可以看到|这意味着|这里|此时|现在)/;
      const scoreLabel = (item, baseScore) => {
        const label = this.normalizeText(item?.fullLabel ?? '');
        if (!label) return -Infinity;
        let score = baseScore;
        if (looksLikeNumberedTitle(label)) score += 20;
        if (label.length <= 48) score += 9;
        else if (label.length <= 88) score += 4;
        else if (label.length > 150) score -= 14;
        if (lowSignalLead.test(label)) score -= 24;
        if (/^[“"'（(]?\S.{16,}[。！？.!?]$/.test(label)) score -= 8;
        if (item.element.tagName === 'PRE' || item.element.tagName === 'TABLE') score -= 3;
        return score;
      };

      const blockSelector = 'p, blockquote, pre, ul, ol, table';
      const blocks = Array.from(root.querySelectorAll(blockSelector))
        .filter((element) => element instanceof HTMLElement && belongsToAnswer(element))
        .filter((element) => {
          const ancestorBlock = element.parentElement?.closest(blockSelector);
          return !(ancestorBlock instanceof HTMLElement) || !root.contains(ancestorBlock);
        })
        .filter((element) => this.outlineText(element).length >= minLength)
        .sort(compareElements);
      if (!blocks.length) return existing.length ? [] : this.collectDerivedOutline();

      const candidates = new Map();
      const offer = (element, labelOverride, level, baseScore, sourceKind) => {
        const item = makeItem(element, labelOverride, level);
        if (!item) return;
        const score = scoreLabel(item, baseScore);
        const current = candidates.get(element);
        if (!current || score > current.score) candidates.set(element, { item, score, sourceKind });
      };

      const firstExisting = existing.map((item) => item.element).filter(Boolean).sort(compareElements)[0] || null;
      const leadingBlock = blocks.find((block) => !firstExisting
        || Boolean(block.compareDocumentPosition(firstExisting) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (leadingBlock) offer(leadingBlock, '', 2, 62, 'lead');

      for (const element of root.querySelectorAll('p, li')) {
        if (!(element instanceof HTMLElement) || !belongsToAnswer(element)) continue;
        const leadingLabel = extractLeadingLabel(element);
        if (leadingLabel) offer(element, leadingLabel, element.tagName === 'LI' ? 4 : 3, 82, 'strong');
      }

      const boundaryNodes = Array.from(root.querySelectorAll('hr, h1, h2, h3, h4, h5, h6, p, blockquote, pre, ul, ol, table'))
        .filter((element) => element instanceof HTMLElement && belongsToAnswer(element));
      for (let index = 0; index < boundaryNodes.length; index += 1) {
        if (boundaryNodes[index].tagName !== 'HR') continue;
        const next = boundaryNodes.slice(index + 1).find((element) => element.tagName !== 'HR');
        if (!next || /^H[1-6]$/.test(next.tagName) || existingElements.has(next)) continue;
        offer(next, '', 3, 72, 'separator');
      }

      // 普通正文仅作为低权重候选，避免把“所以/接下来……”之类句子轻易升级为章节。
      const stride = Math.max(1, Math.floor(blocks.length / Math.max(1, needed)));
      blocks.forEach((element, index) => {
        if (index === 0 || index % stride === 0 || index === blocks.length - 1) {
          offer(element, '', 3, 46, 'distributed');
        }
      });

      const ranked = [...candidates.values()]
        .sort((a, b) => b.score - a.score || compareElements(a.item.element, b.item.element));

      // 不只和正式标题去重，也让不同 DOM 块生成的同名派生章节彼此去重。
      // 分数更高的候选排在前面，因此自然保留质量更好的那个。
      const uniqueRanked = [];
      const seenLabels = new Set(existingLabels);
      for (const entry of ranked) {
        const key = canonicalLabel(entry.item.fullLabel);
        if (!key || seenLabels.has(key)) continue;
        seenLabels.add(key);
        uniqueRanked.push(entry);
      }

      const selected = uniqueRanked.filter((entry) => entry.score >= minScore).slice(0, needed);

      // 完全无正式标题时必须保留可导航性，但兜底只补到目标数量，不再无差别抽正文。
      if (selected.length < needed && existing.length === 0) {
        const selectedElements = new Set(selected.map((entry) => entry.item.element));
        for (const entry of uniqueRanked) {
          if (selected.length >= needed) break;
          if (selectedElements.has(entry.item.element)) continue;
          if (entry.score < 38) continue;
          selected.push(entry);
          selectedElements.add(entry.item.element);
        }
      }

      return selected
        .map((entry) => entry.item)
        .sort((a, b) => compareElements(a.element, b.element));
    }

    observeHeadingText() {
      this.headingTextObserver?.disconnect();
      this.headingTextObserver = null;
      if (!this.headings.length) return;

      this.headingTextObserver = new MutationObserver(() => {
        this.scheduleTocRebuild();
      });

      for (const heading of this.headings) {
        this.headingTextObserver.observe(heading.element, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }
    }

    normalizeText(text) {
      return String(text).replace(/\s+/g, ' ').trim();
    }

    truncateLabel(label, configuredMax, fallback) {
      const max = Math.max(20, Number(configuredMax) || fallback);
      if (label.length <= max) return label;
      return `${label.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
    }

    formatConversationLabel(label) {
      const configuredMax = Number(this.config.conversationTocMaxLabelLength);

      // 0 或负数代表不按字符数截断。
      if (Number.isFinite(configuredMax) && configuredMax <= 0) return label;

      return this.truncateLabel(label, configuredMax, 120);
    }

    renderTocItems() {
      if (!this.list) return;

      const fragment = document.createDocumentFragment();
      this.itemButtons = [];

      this.headings.forEach((heading, index) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        const label = document.createElement('span');

        button.type = 'button';
        button.className = 'toc-item';
        button.dataset.kind = 'heading';
        button.dataset.headingIndex = String(index);
        button.dataset.level = String(heading.displayLevel || heading.level || 1);
        button.dataset.active = 'false';
        button.dataset.derived = heading.derived ? 'true' : 'false';
        button.title = heading.derived ? `自动识别章节 · ${heading.fullLabel}` : heading.fullLabel;

        label.className = 'toc-item-label';
        label.textContent = heading.label;

        button.appendChild(label);
        item.appendChild(button);
        fragment.appendChild(item);
        this.itemButtons.push(button);
      });

      this.list.replaceChildren(fragment);
      this.updateViewMeta();
    }

    clearToc() {
      this.headings = [];
      this.itemButtons = [];
      this.activeIndex = -1;
      this.list?.replaceChildren();
      this.updateViewMeta();
      this.syncVisibility();
    }

    getConversationTurnElement(element) {
      return element instanceof Element
        ? element.closest(dom.turn)
        : null;
    }

    getConversationTurnNumber(element) {
      const turn = this.getConversationTurnElement(element);
      const testId = turn?.getAttribute('data-testid') || '';
      const match = /^conversation-turn-(\d+)$/.exec(testId);
      if (!match) return null;

      const number = Number.parseInt(match[1], 10);
      return Number.isInteger(number) && number >= 0 ? number : null;
    }

    getConversationRecordIdentity(element, fallbackIndex = 0) {
      const turn = this.getConversationTurnElement(element);
      const messageId =
        dom.messageId(element) ||
        turn?.querySelector?.('[data-message-id]')?.getAttribute('data-message-id') ||
        '';
      if (messageId) return `message:${messageId}`;

      const testId = turn?.getAttribute('data-testid') || '';
      return testId || `user-node:${fallbackIndex}`;
    }

    getUserMessageElements() {
      return globalThis.__cgptUnifiedRuntimeV1.pageWork.memo(this, 'user-message-elements', () => {
      const bridgedTurns = globalThis.__cgptUnifiedRuntimeV1?.lazy?.getAllTurnNodes?.() || [];
      // A user turn containing only an attachment has no text bubble. Its
      // message wrapper still carries the user role and message ID.
      const attachmentOnlyUserSelector = '[data-chatgpt-search-unit-key$=":user"]';
      const candidateSource = bridgedTurns.length
        ? bridgedTurns.flatMap((turn) => [
            ...(turn.matches?.(dom.user) ? [turn] : []),
            ...turn.querySelectorAll?.(dom.user) || [],
            ...(turn.matches?.(attachmentOnlyUserSelector) ? [turn] : []),
            ...turn.querySelectorAll?.(attachmentOnlyUserSelector) || [],
          ])
        : [...document.querySelectorAll(`${USER_SELECTOR}, main ${attachmentOnlyUserSelector}`)];
      const candidates = candidateSource.filter((element) => {
        if (!(element instanceof HTMLElement) || (!element.isConnected && !bridgedTurns.length)) return false;
        if (element.matches(attachmentOnlyUserSelector) && element.querySelector(dom.user)) return false;
        if (element.parentElement?.closest(dom.user)) return false;
        if (element.closest('[hidden]')) return false;
        return true;
      });

      /*
       * 响应式布局或分支切换期间可能同时存在同一轮次的多个副本。
       * 每个 conversation-turn 仅保留“可见且文本更完整”的那个节点。
       */
      const bestByIdentity = new Map();
      candidates.forEach((element, index) => {
        const identity = this.getConversationRecordIdentity(element, index);
        const textLength = (element.textContent ?? '').trim().length;
        const hiddenPenalty = element.closest('[aria-hidden="true"]') ? 0 : 1_000_000;
        const score = hiddenPenalty + textLength;
        const current = bestByIdentity.get(identity);
        if (!current || score > current.score) {
          bestByIdentity.set(identity, { element, score });
        }
      });

      const bestElements = [...bestByIdentity.values()].map((entry) => entry.element);
      if (bridgedTurns.length) return bestElements;
      return bestElements.sort((a, b) => {
          if (a === b) return 0;
          const relation = a.compareDocumentPosition(b);
          if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
          return 0;
        });
      }).slice();
    }

    normalizeConversationText(text) {
      return String(text)
        .replace(/\r\n?/g, '\n')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    extractUserPromptText(element) {
      this.userPromptTextCache ||= new WeakMap();
      const cached = this.userPromptTextCache.get(element);
      if (cached) return cached.text;
      const source =
        element.querySelector('[data-message-content]') ||
        element.querySelector('.whitespace-pre-wrap') ||
        element.querySelector(dom.content) ||
        element;

      const clone = source.cloneNode(true);
      if (clone instanceof Element) {
        for (const removable of clone.querySelectorAll(
          'button, script, style, svg, [aria-hidden="true"], [role="tooltip"], [data-cgpt-token-chip], .cgpt-unified-copy-message-md',
        )) {
          removable.remove();
        }
      }

      const text = this.normalizeConversationText(clone.textContent ?? '')
        .replace(/^(?:You said:|你说[:：])\s*/i, '')
        .trim();
      this.userPromptTextRevision = (this.userPromptTextRevision || 0) + 1;
      this.userPromptTextCache.set(element, { text, revision: this.userPromptTextRevision });
      return text;
    }

    getConversationIdFromLocation() {
      const match = location.pathname.match(/\/c\/([0-9a-f-]{20,})/i);
      return match?.[1] || '';
    }

    getApiConversationOutlineForCurrentRoute() {
      const conversationId = this.getConversationIdFromLocation();
      if (!conversationId || this.apiConversationOutline?.conversationId !== conversationId) return null;
      return Array.isArray(this.apiConversationOutline.items) ? this.apiConversationOutline.items : null;
    }

    scheduleApiConversationOutlineRefresh(delay = 180, force = false) {
      if (!this.config.enableConversationToc) return;
      this.apiConversationRefreshForce ||= Boolean(force);
      window.clearTimeout(this.apiConversationRefreshTimer);
      this.apiConversationRefreshTimer = window.setTimeout(() => {
        this.apiConversationRefreshTimer = 0;
        const shouldForce = this.apiConversationRefreshForce;
        this.apiConversationRefreshForce = false;
        void this.refreshApiConversationOutline(shouldForce);
      }, Math.max(0, Number(delay) || 0));
    }

    async refreshApiConversationOutline(force = false) {
      if (document.hidden || this.apiConversationRefreshInFlight) {
        if (force) this.scheduleApiConversationOutlineRefresh(500, true);
        return;
      }
      const exporter = globalThis.__cgptUnifiedRuntimeV1?.sessionExporter;
      if (!exporter?.getConversationOutline) return;
      const conversationId = this.getConversationIdFromLocation();
      if (!conversationId) return;

      this.apiConversationRefreshInFlight = true;
      const token = ++this.apiConversationRefreshToken;
      const routeKey = this.lastConversationRouteKey;
      try {
        const outline = await exporter.getConversationOutline({
          force: Boolean(force),
          maxAgeMs: force ? 0 : 8000,
        });
        if (
          token !== this.apiConversationRefreshToken
          || routeKey !== this.lastConversationRouteKey
          || outline?.conversationId !== this.getConversationIdFromLocation()
        ) return;
        if (outline?.items?.length) {
          this.apiConversationOutline = outline;
          this.apiConversationLastErrorKey = '';
          // API 标签是当前分支的权威目录快照，不需要再通过“逐个点官方目录”补标题。
          outline.items.forEach((item) => {
            if (item?.fullLabel) this.conversationLabelCache.set(item.logicalIndex, item.fullLabel);
          });
          this.rebuildConversationToc();
        }
      } catch (error) {
        const key = `${conversationId}:${error?.message || error}`;
        if (token !== this.apiConversationRefreshToken || routeKey !== this.getConversationRouteKey()) return;
        if (this.apiConversationLastErrorKey !== key) {
          this.apiConversationLastErrorKey = key;
          console.warn('[ChatGPT 完整问答目录] API 目录读取失败，继续使用 DOM/官方目录回退：', error);
        }
      } finally {
        if (token === this.apiConversationRefreshToken) this.apiConversationRefreshInFlight = false;
      }
    }

    getConversationRecordLookup(records) {
      this.conversationRecordLookups ||= new WeakMap();
      const cached = this.conversationRecordLookups.get(records);
      if (cached) return cached;
      const byId = new Map(), byLabel = new Map();
      for (const record of records) {
        const ids = [record.identity?.startsWith('message:') ? record.identity.slice(8) : '', record.turnKey];
        for (const id of ids.filter(Boolean)) if (!byId.has(String(id))) byId.set(String(id), record);
        const label = this.normalizeConversationText(record.fullLabel || '');
        if (label) byLabel.set(label, byLabel.has(label) ? null : record);
      }
      const lookup = { byId, byLabel };
      this.conversationRecordLookups.set(records, lookup);
      return lookup;
    }

    getApiOutlineLookup(outline) {
      if (!Array.isArray(outline)) return { byId: new Map(), labelCounts: new Map() };
      this.apiOutlineLookups ||= new WeakMap();
      const cached = this.apiOutlineLookups.get(outline);
      if (cached) return cached;
      const byId = new Map(), labelCounts = new Map();
      for (const item of outline) {
        for (const id of [item.messageId, item.nodeId].filter(Boolean)) byId.set(String(id), item);
        const label = this.normalizeConversationText(item.fullLabel || '');
        if (label) labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
      }
      const lookup = { byId, labelCounts };
      this.apiOutlineLookups.set(outline, lookup);
      return lookup;
    }

    findApiRecordByIdentity(apiItem, records) {
      const lookup = this.getConversationRecordLookup(records);
      for (const id of [apiItem?.messageId, apiItem?.nodeId].filter(Boolean)) {
        const record = lookup.byId.get(String(id));
        if (record) return record;
      }
      return null;
    }

    findApiRecordMatch(apiItem, records, legacyMapping = null, outline = this.getApiConversationOutlineForCurrentRoute()) {
      const exact = this.findApiRecordByIdentity(apiItem, records);
      if (exact) return exact;
      const apiLookup = this.getApiOutlineLookup(outline);
      const conflictsWithIdentity = (record) => {
        const actualIds = [record?.identity?.startsWith('message:') ? record.identity.slice(8) : '', record?.turnKey].filter(Boolean);
        // The exporter deliberately invents api-user-N when the payload lacks
        // IDs. Those labels must retain the original legacy fallback behavior.
        const expectedIds = [apiItem?.messageId, apiItem?.nodeId].filter((id) => id && !/^api-user-\d+$/.test(id));
        // A real, different ID is not a legacy text-only wrapper. Do not alias
        // it by identical prose while the expected history node is unmounted.
        if (actualIds.length && expectedIds.length && !actualIds.some((id) => expectedIds.includes(id))) return true;
        return actualIds.some((id) => {
        const known = apiLookup.byId.get(String(id));
        return known && ![known.messageId, known.nodeId].filter(Boolean)
          .some((value) => [apiItem?.messageId, apiItem?.nodeId].filter(Boolean).includes(value));
        });
      };
      const normalizedLabel = this.normalizeConversationText(apiItem?.fullLabel || '');
      if (normalizedLabel && (apiLookup.labelCounts.get(normalizedLabel) || 0) <= 1) {
        const record = this.getConversationRecordLookup(records).byLabel.get(normalizedLabel);
        if (record && !conflictsWithIdentity(record)) return record;
      }
      if (legacyMapping?.confident) {
        const mapped = legacyMapping.recordsByIndex.get(apiItem.logicalIndex);
        if (mapped && !conflictsWithIdentity(mapped)) return mapped;
      }
      return null;
    }

    reconcileConversationOutline(apiOutline, records, mapping = null) {
      if (!apiOutline.length) return apiOutline;
      const samePrompt = (a, b) => [a?.messageId, a?.nodeId].filter(Boolean)
        .some((id) => [b?.messageId, b?.nodeId].filter(Boolean).includes(id));
      const identity = (item) => ({ messageId: item.messageId || '', nodeId: item.nodeId || '' });
      const tail = this.pendingApiOutline;
      const result = apiOutline.slice();
      // A saved optimistic tail survives native unmounting, but never a branch
      // change: the confirmed prefix and every confirmed tail identity must match.
      if (tail && tail.routeKey === this.lastConversationRouteKey
        && apiOutline.length >= tail.base.length
        && tail.base.every((item, index) => samePrompt(item, apiOutline[index]))) {
        const confirmed = apiOutline.length - tail.base.length;
        if (confirmed <= tail.items.length && tail.items.slice(0, confirmed)
          .every((item, index) => samePrompt(item, apiOutline[tail.base.length + index]))) {
          result.push(...tail.items.slice(confirmed));
        }
      }
      const lastApiItem = apiOutline.at(-1);
      const anchor = this.findApiRecordMatch(lastApiItem, records, null, apiOutline);
      const anchorIndex = anchor ? records.indexOf(anchor) : -1;
      let trustedPositions = false;
      if (mapping?.confident && mapping.trustLabels) {
        const positions = new Map([...mapping.recordsByIndex].map(([index, record]) => [record, index]));
        let aligned = false, contradicted = false;
        apiOutline.forEach((item, index) => {
          const record = this.findApiRecordByIdentity(item, records);
          if (!record || !positions.has(record)) return;
          if (positions.get(record) === index) aligned = true;
          else contradicted = true;
        });
        trustedPositions = aligned && !contradicted;
      }
      if (trustedPositions || (anchorIndex >= 0 && anchorIndex + 1 < records.length
        && (!mapping || mapping.officialMaxIndex < apiOutline.length + records.length - anchorIndex - 1))) {
        const knownPositions = new Map();
        result.forEach((item, index) => {
          for (const id of [item.messageId, item.nodeId].filter(Boolean)) knownPositions.set(id, index);
        });
        const additions = trustedPositions
          ? [...mapping.recordsByIndex].filter(([index]) => index >= apiOutline.length).sort((a, b) => a[0] - b[0])
          : records.slice(anchorIndex + 1).map((record) => [null, record]);
        for (const [position, record] of additions) {
          const messageId = record.identity?.startsWith('message:') ? record.identity.slice(8) : record.turnKey || '';
          if (!messageId || !record.fullLabel) continue;
          const existingIndex = knownPositions.get(messageId) ?? knownPositions.get(record.turnKey);
          if (existingIndex !== undefined && (existingIndex < apiOutline.length || !Number.isInteger(position))) continue;
          const index = Number.isInteger(position) ? position : result.length;
          if (existingIndex !== undefined && existingIndex !== index) {
            result[existingIndex] = { messageId: '', nodeId: '', fullLabel: `提问 ${existingIndex + 1}`, sourceHint: 'native-pending' };
          }
          while (result.length < index) {
            result.push({ messageId: '', nodeId: '', fullLabel: `提问 ${result.length + 1}`, sourceHint: 'native-pending' });
          }
          result[index] = { messageId, nodeId: record.turnKey || '', fullLabel: record.fullLabel, sourceHint: 'dom-pending' };
          knownPositions.set(messageId, index);
          if (record.turnKey) knownPositions.set(record.turnKey, index);
        }
      }
      const pending = result.slice(apiOutline.length);
      this.pendingApiOutline = pending.length ? {
        routeKey: this.lastConversationRouteKey,
        base: apiOutline.map(identity),
        items: pending.map((item) => ({ ...identity(item), fullLabel: item.fullLabel, sourceHint: 'dom-pending' })),
      } : null;
      return pending.length ? result : apiOutline;
    }

    rebuildConversationTocFromApi(apiOutline, records, officialButtons) {
      const buttonsByIndex = new Map();
      officialButtons.forEach((button) => {
        const logicalIndex = Number.parseInt(button.dataset.tocItemIndex ?? '', 10);
        if (Number.isInteger(logicalIndex) && logicalIndex >= 0) buttonsByIndex.set(logicalIndex, button);
      });
      const legacyMapping = this.mapUserRecordsToLogicalIndices(records, officialButtons);
      let mergedOutline = this.reconcileConversationOutline(apiOutline, records, legacyMapping);
      const maxOfficialIndex = Math.max(-1, ...buttonsByIndex.keys());
      if (maxOfficialIndex >= mergedOutline.length) {
        mergedOutline = mergedOutline.slice();
        for (let index = mergedOutline.length; index <= maxOfficialIndex; index++) {
          mergedOutline.push({ messageId: '', nodeId: '', sourceHint: 'native-pending',
            fullLabel: this.getOfficialConversationLabel(buttonsByIndex.get(index), index) || `提问 ${index + 1}` });
        }
      }

      const items = mergedOutline.map((apiItem, logicalIndex) => {
        const canonical = { ...apiItem, logicalIndex };
        const mappedRecord = this.findApiRecordMatch(canonical, records, legacyMapping, mergedOutline);
        const officialButton = buttonsByIndex.get(logicalIndex) ?? null;
        const nativeLabel = canonical.sourceHint === 'native-pending'
          && this.isConversationPlaceholderLabel(canonical.fullLabel, logicalIndex)
          ? this.getOfficialConversationLabel(officialButton, logicalIndex) : '';
        const fullLabel = nativeLabel || canonical.fullLabel || `提问 ${logicalIndex + 1}`;
        const identity = canonical.messageId ? `message:${canonical.messageId}` : mappedRecord?.identity || '';
        if (identity) this.cacheConversationRecordLabel(logicalIndex, { identity, fullLabel });
        else {
          this.removeConversationCachedLabel(logicalIndex);
          if (!this.isConversationPlaceholderLabel(fullLabel, logicalIndex)) this.conversationLabelCache.set(logicalIndex, fullLabel);
        }
        return {
          logicalIndex,
          apiMessageId: canonical.messageId || '',
          apiNodeId: canonical.nodeId || '',
          userElement: mappedRecord?.userElement ?? null,
          targetElement: mappedRecord?.targetElement ?? null,
          targetRecordIdentity: mappedRecord?.identity || '',
          officialButton,
          fullLabel,
          label: this.formatConversationLabel(fullLabel),
          mappingConfident: Boolean(mappedRecord),
          // 目录始终完整显示；这里只标记“目标当前是否挂载”，供视觉提示和跳转策略使用。
          unloaded: !mappedRecord?.targetElement?.isConnected,
          source: canonical.sourceHint || 'api',
        };
      });

      this.conversationItems = items;
      this.maxObservedOfficialLogicalIndex = Math.max(
        this.maxObservedOfficialLogicalIndex,
        items.length - 1,
      );
      this.lastConversationSignature = this.getConversationSignature();
      this.lastConversationDataSignature = this.getConversationDataSignature();
      this.renderConversationItems();
      const active = this.findActiveConversationIndex();
      this.activeConversationIndex = -1;
      this.applyActiveConversationIndex(active, false);
      this.updateViewMeta();
      this.syncVisibility();
      this.persistConversationLabelSnapshot();
      // API 和 DOM 的已确认标题优先；尚未落库的原生条目继续只读补全。
      this.cancelConversationLabelHydration(false);
      if (items.some((item) => this.isConversationPlaceholderLabel(item.fullLabel, item.logicalIndex))) {
        this.scheduleConversationLabelHydration();
      }
    }

    collectUserMessageRecords() {
      return this.getUserMessageElements().map((userElement, index) => ({
        userElement,
        targetElement: this.getConversationTurnElement(userElement) || userElement,
        turnNumber: this.getConversationTurnNumber(userElement),
        turnKey: this.getConversationTurnElement(userElement)?.getAttribute('data-turn-key') || '',
        identity: this.getConversationRecordIdentity(userElement, index),
        fullLabel: this.extractUserPromptText(userElement),
        ariaHidden: Boolean(userElement.closest('[aria-hidden="true"]')),
      }));
    }

    getOfficialNavButtons() {
      const activeMain = dom.main();
      return globalThis.__cgptUnifiedRuntimeV1.pageWork.query(document, 'button[data-toc-item-index]')
        .filter((button) => button instanceof HTMLButtonElement && button.isConnected
          && !button.closest('[hidden], [inert], [aria-hidden="true"]')
          && (!button.closest('main, [role="main"]') || button.closest('main, [role="main"]') === activeMain))
        .sort((a, b) => {
          const ai = Number.parseInt(a.dataset.tocItemIndex ?? '', 10);
          const bi = Number.parseInt(b.dataset.tocItemIndex ?? '', 10);
          return (Number.isFinite(ai) ? ai : 0) - (Number.isFinite(bi) ? bi : 0);
        });
    }

    getOfficialActiveLogicalIndex(buttons = this.getOfficialNavButtons()) {
      const activeButton = buttons.find((button) => button.hasAttribute('data-toc-active'));
      const index = Number.parseInt(activeButton?.dataset.tocItemIndex ?? '', 10);
      return Number.isInteger(index) && index >= 0 ? index : -1;
    }

    findFixedAncestor(element) {
      for (let current = element?.parentElement; current; current = current.parentElement) {
        if (
          getComputedStyle(current).position === 'fixed' ||
          current.classList.contains('fixed')
        ) {
          return current;
        }
      }
      return null;
    }

    syncOfficialConversationNav() {
      const buttons = this.getOfficialNavButtons();
      const container = buttons.length ? this.findFixedAncestor(buttons[0]) : null;

      if (
        this.officialNavContainer &&
        this.officialNavContainer !== container &&
        this.officialNavContainer.isConnected
      ) {
        this.officialNavContainer.removeAttribute(
          'data-cgpt-native-conversation-toc-hidden',
        );
      }

      this.officialNavContainer = container;
      if (container) {
        if (this.config.hideOfficialConversationToc) {
          container.setAttribute('data-cgpt-native-conversation-toc-hidden', '');
        } else {
          container.removeAttribute('data-cgpt-native-conversation-toc-hidden');
        }
      }

      return buttons;
    }

    getConversationDataSignature(users = this.getUserMessageElements(), buttons = this.getOfficialNavButtons()) {
      const userSignature = users.map((element, index) => {
        const text = this.extractUserPromptText(element);
        const identity = this.getConversationRecordIdentity(element, index);
        const revision = this.userPromptTextCache?.get(element)?.revision || 0;
        return `${identity}:${revision}:${text.length}:${text.slice(0, 16)}:${text.slice(-16)}`;
      }).join('|');
      const buttonSignature = buttons.map((button) => `${button.dataset.tocItemIndex ?? '?'}:${button.title}:${button.getAttribute('aria-label') || ''}:${button.textContent || ''}`).join('|');
      return `${userSignature}||${buttonSignature}`;
    }

    getConversationSignature() {
      const users = this.getUserMessageElements();
      const buttons = this.getOfficialNavButtons();
      const currentAnswerTurn = this.currentAnswer?.closest?.(dom.turn);
      const currentAnswerIdentity = dom.messageId(this.currentAnswer)
        || currentAnswerTurn?.getAttribute('data-testid')
        || currentAnswerTurn?.getAttribute('data-turn-key') || '';
      const buttonSignature = buttons.map((button) => {
        const index = button.dataset.tocItemIndex ?? '?';
        const active = button.hasAttribute('data-toc-active') ? 'a' : '';
        return `${index}${active}`;
      }).join(',');
      return `${currentAnswerIdentity}||${this.getConversationDataSignature(users, buttons)}||${buttonSignature}`;
    }

    refreshConversationTocIfNeeded() {
      const signature = this.getConversationSignature();
      const dataSignature = this.getConversationDataSignature();
      if (signature !== this.lastConversationSignature) {
        this.scheduleConversationRebuild(40);
      }
      if (dataSignature !== this.lastConversationDataSignature && this.pendingConversationLogicalIndex < 0) {
        this.conversationLabelHydrationAttempts?.clear();
        this.scheduleApiConversationOutlineRefresh(460, true);
      } else if (!this.getApiConversationOutlineForCurrentRoute()
        || this.conversationItems.some((item) => item.source === 'dom-pending' || item.source === 'native-pending')) {
        // 首次打开超长会话时 DOM 可能看起来完全没变化，但 API 目录仍需要补齐。
        this.scheduleApiConversationOutlineRefresh(120, false);
      }
    }

    scheduleConversationRebuild(delay = 120) {
      window.clearTimeout(this.conversationRebuildTimer);
      globalThis.__cgptUnifiedRuntimeV1.pageWork.cancelFrame(this.conversationRebuildFrame); this.conversationRebuildFrame = 0;
      this.conversationRebuildTimer = window.setTimeout(() => {
        this.conversationRebuildTimer = 0;
        if (this.conversationRebuildFrame) return;
        this.conversationRebuildFrame = globalThis.__cgptUnifiedRuntimeV1.pageWork.requestFrame(() => {
          this.conversationRebuildFrame = 0; this.rebuildConversationToc();
        });
      }, Math.max(0, Number(delay) || 0));
    }

    findCurrentPromptRecordIndex(records) {
      if (!this.currentAnswer?.isConnected || !records.length) return -1;

      let bestIndex = -1;
      for (let index = 0; index < records.length; index += 1) {
        const userElement = records[index].userElement;
        if (!userElement?.isConnected) continue;

        const relation = userElement.compareDocumentPosition(this.currentAnswer);
        if (relation & Node.DOCUMENT_POSITION_FOLLOWING) {
          bestIndex = index;
        } else if (relation & Node.DOCUMENT_POSITION_PRECEDING) {
          break;
        }
      }
      return bestIndex;
    }

    findViewportPromptRecordIndex(records) {
      if (!records.length) return -1;
      const lineY = this.getActiveLineViewportY();
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;

      records.forEach((record, index) => {
        const target = record.targetElement || record.userElement;
        if (!(target instanceof HTMLElement) || !target.isConnected) return;
        const rect = target.getBoundingClientRect();
        const distance = rect.top <= lineY && rect.bottom >= lineY
          ? 0
          : Math.min(Math.abs(rect.top - lineY), Math.abs(rect.bottom - lineY));
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      return bestIndex;
    }

    getUserTurnStride(records) {
      const numbers = records
        .map((record) => record.turnNumber)
        .filter((number) => Number.isInteger(number));
      if (numbers.length < 2) return 2;

      const parity = numbers[0] % 2;
      return numbers.every((number) => number % 2 === parity) ? 2 : 1;
    }

    validateRecordIndexMapping(indices, maxOfficialIndex) {
      if (!indices.length) return false;
      const seen = new Set();
      let previous = -1;

      for (const index of indices) {
        if (!Number.isInteger(index) || index < 0) return false;
        if (maxOfficialIndex >= 0 && index > maxOfficialIndex) return false;
        if (seen.has(index) || index <= previous) return false;
        seen.add(index);
        previous = index;
      }
      return true;
    }

    getConversationLabelSnapshotKey() {
      const routeKey = this.lastConversationRouteKey || this.getConversationRouteKey();
      return 'cgpt-unified-conversation-labels-v1:' + encodeURIComponent(routeKey);
    }

    restoreConversationLabelSnapshot() {
      try {
        const parsed = JSON.parse(sessionStorage.getItem(this.getConversationLabelSnapshotKey()) || '[]');
        if (!Array.isArray(parsed)) return;
        for (const entry of parsed.slice(0, 500)) {
          const logicalIndex = Number(entry?.[0]);
          const label = this.normalizeConversationText(entry?.[1] || '').slice(0, 1000);
          if (Number.isInteger(logicalIndex) && logicalIndex >= 0 && label) {
            this.conversationLabelCache.set(logicalIndex, label);
          }
        }
      } catch (_) {
        // sessionStorage 不可用或旧快照损坏时直接重新采集。
      }
    }

    persistConversationLabelSnapshot() {
      try {
        const entries = [...this.conversationLabelCache.entries()]
          .filter(([logicalIndex, label]) =>
            Number.isInteger(logicalIndex) && logicalIndex >= 0
            && !this.isConversationPlaceholderLabel(label, logicalIndex))
          .slice(0, 500);
        sessionStorage.setItem(this.getConversationLabelSnapshotKey(), JSON.stringify(entries));
      } catch (_) {
        // 标签只在当前标签页保存；存储不可用不影响目录跳转。
      }
    }

    clearConversationLabelCacheState() {
      this.conversationLabelCache.clear();
      this.conversationCacheIdentityByIndex.clear();
      this.conversationCacheIndexByIdentity.clear();
      this.conversationLabelHydrationAttempts?.clear();
    }

    removeConversationCachedLabel(logicalIndex) {
      const identity = this.conversationCacheIdentityByIndex.get(logicalIndex);
      if (
        identity &&
        this.conversationCacheIndexByIdentity.get(identity) === logicalIndex
      ) {
        this.conversationCacheIndexByIdentity.delete(identity);
      }
      this.conversationCacheIdentityByIndex.delete(logicalIndex);
      this.conversationLabelCache.delete(logicalIndex);
    }

    cacheConversationRecordLabel(logicalIndex, record) {
      if (
        !Number.isInteger(logicalIndex) ||
        logicalIndex < 0 ||
        !record?.fullLabel
      ) {
        return;
      }

      const identity = String(record.identity || '');
      if (identity) {
        const previousIndex = this.conversationCacheIndexByIdentity.get(identity);
        if (Number.isInteger(previousIndex) && previousIndex !== logicalIndex) {
          this.removeConversationCachedLabel(previousIndex);
        }

        const displacedIdentity = this.conversationCacheIdentityByIndex.get(logicalIndex);
        if (
          displacedIdentity &&
          displacedIdentity !== identity &&
          this.conversationCacheIndexByIdentity.get(displacedIdentity) === logicalIndex
        ) {
          this.conversationCacheIndexByIdentity.delete(displacedIdentity);
        }

        this.conversationCacheIdentityByIndex.set(logicalIndex, identity);
        this.conversationCacheIndexByIdentity.set(identity, logicalIndex);
      }

      this.conversationLabelCache.set(logicalIndex, record.fullLabel);
    }

    isConversationPlaceholderLabel(label, logicalIndex = -1) {
      const normalized = this.normalizeConversationText(label || '');
      if (!normalized) return true;
      if (/^Prompt\s+\d+$/i.test(normalized)) return true;
      if (/^提问\s+\d+(?:（尚未加载，点击加载）)?$/.test(normalized)) return true;
      return logicalIndex >= 0 && normalized === 'Prompt ' + (logicalIndex + 1);
    }

    findDirectConversationRecord(logicalIndex) {
      const records = this.collectUserMessageRecords();
      return records.find((record) =>
        Number.isInteger(record.turnNumber)
        && Math.floor(record.turnNumber / 2) === logicalIndex
        && !this.isConversationPlaceholderLabel(record.fullLabel, logicalIndex)) || null;
    }

    waitForDirectConversationRecord(logicalIndex, token) {
      const routeKey = this.lastConversationRouteKey;
      const startedAt = performance.now();
      const timeout = Math.max(250, Number(this.config.conversationTocHydrateTimeoutMs) || 900);
      return new Promise((resolve) => {
        const inspect = () => {
          if (token !== this.conversationLabelHydrationToken || routeKey !== this.lastConversationRouteKey) {
            resolve(null);
            return;
          }
          const record = this.findDirectConversationRecord(logicalIndex);
          if (record || performance.now() - startedAt >= timeout) {
            resolve(record);
            return;
          }
          window.setTimeout(inspect, 60);
        };
        inspect();
      });
    }

    restoreConversationLabelHydrationContext() {
      // Passive hydration never changes navigation or needs a scroll restore.
      this.conversationLabelHydrationContext = null;
    }

    cancelConversationLabelHydration(restore = true) {
      this.conversationLabelHydrationToken += 1;
      window.clearTimeout(this.conversationLabelHydrationTimer);
      this.conversationLabelHydrationTimer = 0;
      this.conversationLabelHydrating = false;
      if (restore) this.restoreConversationLabelHydrationContext();
      else this.conversationLabelHydrationContext = null;
    }

    scheduleConversationLabelHydration(delay = this.config.conversationTocHydrateDelayMs) {
      if (
        !this.config.conversationTocAutoHydrateLabels
        || this.collapsed
        || this.activeView !== 'conversation'
        || document.hidden
        || this.conversationLabelHydrating
        || this.dragState
        || this.resizeState
      ) return;
      const hasMissingLabel = this.conversationItems.some((item) =>
        this.isConversationPlaceholderLabel(item.fullLabel, item.logicalIndex)
        && (this.conversationLabelHydrationAttempts.get(item.logicalIndex) || 0) < 2);
      if (!hasMissingLabel) return;
      window.clearTimeout(this.conversationLabelHydrationTimer);
      this.conversationLabelHydrationTimer = window.setTimeout(() => {
        this.conversationLabelHydrationTimer = 0;
        void this.hydrateConversationLabelBatch();
      }, Math.max(80, Number(delay) || 360));
    }

    getOfficialConversationLabel(button, logicalIndex) {
      return [button?.getAttribute('title'), button?.getAttribute('aria-label'), button?.textContent]
        .map((value) => this.normalizeConversationText(value || ''))
        .find((value) => value && !this.isConversationPlaceholderLabel(value, logicalIndex)
          && !/^(?:\d+|(?:jump|go|scroll)\s+to\s+(?:prompt|question|message|turn)\s*\d+|(?:跳转(?:到)?|转到)\s*(?:提问|问题|消息|问答)\s*\d+)$/i.test(value)) || '';
    }

    async hydrateConversationLabelBatch() {
      if (!this.config.conversationTocAutoHydrateLabels || this.conversationLabelHydrating
        || this.collapsed || this.activeView !== 'conversation') return;
      const buttons = this.getOfficialNavButtons();
      const batchSize = Math.max(1, Math.min(6, Number(this.config.conversationTocHydrateBatchSize) || 3));
      const missing = this.conversationItems
        .filter((item) => this.isConversationPlaceholderLabel(item.fullLabel, item.logicalIndex)
          && (this.conversationLabelHydrationAttempts.get(item.logicalIndex) || 0) < 2)
        .slice(0, batchSize);
      if (!missing.length) return;

      this.conversationLabelHydrating = true;
      const token = ++this.conversationLabelHydrationToken;
      const routeKey = this.lastConversationRouteKey;
      let changed = false;
      try {
        const records = this.collectUserMessageRecords();
        const mapping = this.mapUserRecordsToLogicalIndices(records, buttons);
        for (const item of missing) {
          if (token !== this.conversationLabelHydrationToken || routeKey !== this.lastConversationRouteKey) break;
          const record = mapping.trustLabels ? mapping.recordsByIndex.get(item.logicalIndex) : null;
          const button = buttons.find((candidate) =>
            Number.parseInt(candidate.dataset.tocItemIndex ?? '', 10) === item.logicalIndex);
          if (record?.fullLabel && !this.isConversationPlaceholderLabel(record.fullLabel, item.logicalIndex)) {
            this.cacheConversationRecordLabel(item.logicalIndex, record);
            changed = true;
          } else {
            // Native buttons sometimes expose the full prompt in title or text.
            // Read those labels without activating the native virtual list.
            const label = this.getOfficialConversationLabel(button, item.logicalIndex);
            if (label) {
              this.conversationLabelCache.set(item.logicalIndex, label);
              changed = true;
            }
          }
          const attempts = this.conversationLabelHydrationAttempts.get(item.logicalIndex) || 0;
          this.conversationLabelHydrationAttempts.set(item.logicalIndex, attempts + 1);
        }
        // The API can fill prompts which the native UI has not mounted at all.
        if (missing.some((item) => !this.conversationLabelCache.has(item.logicalIndex))) {
          await this.refreshApiConversationOutline(false);
        }
      } finally {
        if (token === this.conversationLabelHydrationToken && routeKey === this.lastConversationRouteKey) {
          this.conversationLabelHydrationContext = null;
          this.persistConversationLabelSnapshot();
          this.conversationLabelHydrating = false;
          if (changed) this.rebuildConversationToc();
          this.scheduleConversationLabelHydration();
        }
      }
    }

    mapUserRecordsToLogicalIndices(records, officialButtons) {
      const buttonsByIndex = new Map();
      let maxOfficialIndex = -1;

      for (const button of officialButtons) {
        const logicalIndex = Number.parseInt(button.dataset.tocItemIndex ?? '', 10);
        if (!Number.isInteger(logicalIndex) || logicalIndex < 0) continue;
        if (!buttonsByIndex.has(logicalIndex)) buttonsByIndex.set(logicalIndex, button);
        maxOfficialIndex = Math.max(maxOfficialIndex, logicalIndex);
      }

      const officialIndices = [...buttonsByIndex.keys()].sort((a, b) => a - b);
      const officialCount = officialIndices.length;
      const activeLogicalIndex = this.getOfficialActiveLogicalIndex(officialButtons);
      const anchorRecordIndex = this.findCurrentPromptRecordIndex(records);
      const viewportAnchorIndex = this.findViewportPromptRecordIndex(records);
      const stride = this.getUserTurnStride(records);
      const officialNavAppearsPartial =
        this.maxObservedOfficialLogicalIndex >= 0 &&
        maxOfficialIndex >= 0 &&
        maxOfficialIndex < this.maxObservedOfficialLogicalIndex;

      let mappedIndices = null;
      let confident = false;
      let trustLabels = false;
      let source = 'none';
      let tentativeTurnCandidate = null;

      const acceptCandidate = (
        candidate,
        candidateSource,
        candidateConfident,
        candidateTrustLabels,
      ) => {
        if (mappedIndices || !this.validateRecordIndexMapping(candidate, maxOfficialIndex)) {
          return false;
        }
        mappedIndices = candidate;
        source = candidateSource;
        confident = Boolean(candidateConfident);
        trustLabels = Boolean(candidateTrustLabels);
        return true;
      };

      if (!records.length) {
        return {
          buttonsByIndex,
          recordsByIndex: new Map(),
          maxIndex: maxOfficialIndex,
          officialMaxIndex: maxOfficialIndex,
          confident: true,
          trustLabels: true,
          source: 'empty',
        };
      }

      if (!officialCount) {
        let maxCachedIndex = -1;
        for (const logicalIndex of this.conversationLabelCache.keys()) {
          if (Number.isInteger(logicalIndex)) maxCachedIndex = Math.max(maxCachedIndex, logicalIndex);
        }
        const knownCount = Math.max(this.maxObservedOfficialLogicalIndex, maxCachedIndex) + 1;
        const domAppearsPartial = knownCount > records.length;
        const offset = domAppearsPartial ? knownCount - records.length : 0;
        acceptCandidate(
          records.map((_, index) => index + offset),
          domAppearsPartial ? 'known-catalog-partial' : 'dom-only',
          !domAppearsPartial,
          !domAppearsPartial,
        );
      }

      /*
       * 官方 active 项与“当前回答之前的用户提问”是最可靠的独立锚点。
       * 必须优先于 conversation-turn-N；页面首轮 hydration/虚拟化期间，
       * 后者可能暂时从 0 重新编号，不能直接视为绝对问答序号。
       */
      if (!mappedIndices && activeLogicalIndex >= 0 && anchorRecordIndex >= 0) {
        const anchorTurn = records[anchorRecordIndex].turnNumber;
        const candidate = records.map((record, index) => {
          if (Number.isInteger(anchorTurn) && Number.isInteger(record.turnNumber)) {
            const delta = record.turnNumber - anchorTurn;
            if (delta % stride === 0) return activeLogicalIndex + delta / stride;
          }
          return activeLogicalIndex + index - anchorRecordIndex;
        });
        acceptCandidate(candidate, 'active-current-answer', true, true);
      }

      if (!mappedIndices && activeLogicalIndex >= 0 && viewportAnchorIndex >= 0) {
        const candidate = records.map((_, index) =>
          activeLogicalIndex + index - viewportAnchorIndex);
        acceptCandidate(candidate, 'active-viewport', true, true);
      }

      if (!mappedIndices) {
        const recordsWithTurns = records.every((record) =>
          Number.isInteger(record.turnNumber));
        if (recordsWithTurns) {
          const candidates = [
            records.map((record) => Math.floor(record.turnNumber / 2)),
            records.map((record) => record.turnNumber),
          ];

          for (const candidate of candidates) {
            if (!this.validateRecordIndexMapping(candidate, maxOfficialIndex)) continue;

            const matchesCurrentAnchor =
              activeLogicalIndex >= 0 &&
              anchorRecordIndex >= 0 &&
              candidate[anchorRecordIndex] === activeLogicalIndex;
            const matchesViewportAnchor =
              activeLogicalIndex >= 0 &&
              viewportAnchorIndex >= 0 &&
              candidate[viewportAnchorIndex] === activeLogicalIndex;
            const matchesCompleteOfficialSet =
              records.length === officialCount &&
              candidate.length === officialIndices.length &&
              candidate.every((value, index) => value === officialIndices[index]);
            const reachesKnownConversationEnd =
              maxOfficialIndex >= 0 &&
              candidate[candidate.length - 1] === maxOfficialIndex;

            if (matchesCurrentAnchor || matchesViewportAnchor) {
              acceptCandidate(candidate, 'turn-number-aligned', true, true);
              break;
            }

            if (
              reachesKnownConversationEnd &&
              records.length < officialCount &&
              !officialNavAppearsPartial
            ) {
              acceptCandidate(candidate, 'turn-number-end-aligned', true, true);
              break;
            }

            if (matchesCompleteOfficialSet && !officialNavAppearsPartial) {
              acceptCandidate(candidate, 'turn-number-complete', true, true);
              break;
            }

            tentativeTurnCandidate ||= candidate;
          }
        }
      }

      /*
       * DOM 记录数与当前官方按钮数相等时可以临时一一对应；但如果此前
       * 已观察到更多官方项，则当前按钮集只是 React 过渡态，不能缓存标签。
       */
      if (!mappedIndices && records.length === officialCount) {
        acceptCandidate(
          officialIndices.slice(),
          'count-match',
          !officialNavAppearsPartial,
          !officialNavAppearsPartial,
        );
      }

      if (!mappedIndices && tentativeTurnCandidate) {
        acceptCandidate(tentativeTurnCandidate, 'turn-number-tentative', false, false);
      }

      if (!mappedIndices) {
        const offset = Math.max(0, maxOfficialIndex + 1 - records.length);
        acceptCandidate(
          records.map((_, index) => index + offset),
          'tail-fallback',
          false,
          false,
        );
      }

      const recordsByIndex = new Map();
      mappedIndices.forEach((logicalIndex, recordIndex) => {
        if (!Number.isInteger(logicalIndex) || logicalIndex < 0) return;
        if (maxOfficialIndex >= 0 && logicalIndex > maxOfficialIndex) return;
        const record = records[recordIndex];
        if (!record) return;

        const previous = recordsByIndex.get(logicalIndex);
        if (!previous) {
          recordsByIndex.set(logicalIndex, record);
          return;
        }

        const previousScore = (previous.ariaHidden ? 0 : 1_000_000) + previous.fullLabel.length;
        const nextScore = (record.ariaHidden ? 0 : 1_000_000) + record.fullLabel.length;
        if (nextScore > previousScore) recordsByIndex.set(logicalIndex, record);
      });

      let maxMappedIndex = -1;
      for (const index of recordsByIndex.keys()) {
        maxMappedIndex = Math.max(maxMappedIndex, index);
      }

      return {
        buttonsByIndex,
        recordsByIndex,
        maxIndex: Math.max(maxOfficialIndex, maxMappedIndex),
        officialMaxIndex: maxOfficialIndex,
        confident,
        trustLabels,
        source,
      };
    }

    rebuildConversationToc() {
      if (!this.config.enableConversationToc) {
        this.clearConversationToc();
        return;
      }

      const records = this.collectUserMessageRecords();
      const officialButtons = this.syncOfficialConversationNav();
      const apiOutline = this.getApiConversationOutlineForCurrentRoute();
      if (apiOutline?.length) {
        this.rebuildConversationTocFromApi(apiOutline, records, officialButtons);
        return;
      }
      const cachedOutline = globalThis.__cgptUnifiedRuntimeV1?.sessionExporter?.getCachedConversationOutlineSync?.();
      if (cachedOutline?.conversationId === this.getConversationIdFromLocation() && cachedOutline.items?.length) {
        this.apiConversationOutline = cachedOutline;
        this.rebuildConversationTocFromApi(cachedOutline.items, records, officialButtons);
        return;
      }
      const mapping = this.mapUserRecordsToLogicalIndices(records, officialButtons);
      const items = [];

      /*
       * 首次 hydration 时官方目录可能先出现 1～2 项，随后一次性扩展为
       * 完整问答数。只有缓存尚不完整时才清空早期错位索引；完整快照必须保留。
       */
      if (
        this.maxObservedOfficialLogicalIndex >= 0 &&
        mapping.officialMaxIndex > this.maxObservedOfficialLogicalIndex + 1 &&
        this.conversationLabelCache.size < mapping.officialMaxIndex + 1
      ) {
        this.clearConversationLabelCacheState();
      }
      if (mapping.officialMaxIndex >= 0) {
        this.maxObservedOfficialLogicalIndex = Math.max(
          this.maxObservedOfficialLogicalIndex,
          mapping.officialMaxIndex,
        );
      }

      if (mapping.trustLabels) {
        for (const [logicalIndex, record] of mapping.recordsByIndex) {
          this.cacheConversationRecordLabel(logicalIndex, record);
        }
      }

      const liveLabelIndices = new Map();
      if (mapping.trustLabels) {
        for (const [logicalIndex, record] of mapping.recordsByIndex) {
          if (!record.fullLabel) continue;
          const indices = liveLabelIndices.get(record.fullLabel) || new Set();
          indices.add(logicalIndex);
          liveLabelIndices.set(record.fullLabel, indices);
        }
      }

      const knownIndices = new Set([
        ...mapping.buttonsByIndex.keys(),
        ...mapping.recordsByIndex.keys(),
        ...this.conversationLabelCache.keys(),
      ]);
      const maxKnownIndex = knownIndices.size ? Math.max(...knownIndices) : -1;
      // 官方导航或 DOM 暂时缩小时，目录总数不得回退。
      const maxIndex = Math.max(
        mapping.maxIndex,
        maxKnownIndex,
        this.maxObservedOfficialLogicalIndex,
      );

      for (let logicalIndex = 0; logicalIndex <= maxIndex; logicalIndex += 1) {
        const mappedRecord = mapping.recordsByIndex.get(logicalIndex) ?? null;
        const displayRecord = mapping.trustLabels ? mappedRecord : null;
        const officialButton = mapping.buttonsByIndex.get(logicalIndex) ?? null;
        let cachedLabel = this.conversationLabelCache.get(logicalIndex) || '';

        /*
         * 若某个仅来自缓存的标签，与当前已可信挂载在另一个序号的记录完全
         * 相同，它通常就是 hydration 早期错位留下的副本。宁可退回 Prompt N，
         * 也不把最后两问错误显示到最前两问。
         */
        if (!displayRecord && cachedLabel) {
          const liveIndices = liveLabelIndices.get(cachedLabel);
          if (liveIndices && !liveIndices.has(logicalIndex)) {
            this.removeConversationCachedLabel(logicalIndex);
            cachedLabel = '';
          }
        }

        const unloaded = !mappedRecord && !officialButton && !cachedLabel;
        const fullLabel =
          displayRecord?.fullLabel ||
          cachedLabel ||
          this.getOfficialConversationLabel(officialButton, logicalIndex) ||
          (unloaded
            ? `提问 ${logicalIndex + 1}（尚未加载，点击加载）`
            : `提问 ${logicalIndex + 1}`);

        items.push({
          logicalIndex,
          userElement: mapping.confident ? mappedRecord?.userElement ?? null : null,
          targetElement: mapping.confident ? mappedRecord?.targetElement ?? null : null,
          officialButton,
          fullLabel,
          label: this.formatConversationLabel(fullLabel),
          mappingConfident: mapping.confident,
          unloaded,
        });
      }

      this.conversationItems = items;
      this.resolvedApiOutline = items.map((item) => ({
        logicalIndex: item.logicalIndex, messageId: item.apiMessageId, nodeId: item.apiNodeId,
        fullLabel: item.fullLabel, sourceHint: item.source,
      }));
      this.lastConversationSignature = this.getConversationSignature();
      this.lastConversationDataSignature = this.getConversationDataSignature();
      this.renderConversationItems();
      const active = this.findActiveConversationIndex();
      this.activeConversationIndex = -1;
      this.applyActiveConversationIndex(active, false);
      this.updateViewMeta();
      this.syncVisibility();
      this.persistConversationLabelSnapshot();
      this.scheduleConversationLabelHydration();
    }

    renderConversationItems() {
      if (!this.conversationList) return;
      const previous = this.lastRenderedConversationModel;
      const unchanged = previous?.length === this.conversationItems.length
        && this.conversationItems.every((item, index) => {
          const row = previous[index];
          return row.logicalIndex === item.logicalIndex && row.fullLabel === item.fullLabel
            && row.label === item.label && row.unloaded === Boolean(item.unloaded);
        });
      if (unchanged
        && this.conversationItemButtons.length === this.conversationItems.length
        && this.conversationItemButtons.every((button) => button.isConnected)) {
        // Rebuilds update target nodes; unchanged rows retain focus and list scroll.
        const active = this.conversationItemButtons[this.activeConversationIndex];
        if (active) { active.dataset.active = 'false'; active.removeAttribute('aria-current'); }
        return;
      }
      // Store string references; do not serialize potentially huge prompts on
      // every scroll-driven rebuild merely to detect unchanged directory rows.
      this.lastRenderedConversationModel = this.conversationItems.map((item) => ({
        logicalIndex: item.logicalIndex, fullLabel: item.fullLabel, label: item.label, unloaded: Boolean(item.unloaded),
      }));

      const fragment = document.createDocumentFragment();
      this.conversationItemButtons = [];

      this.conversationItems.forEach((conversation, index) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        const number = document.createElement('span');
        const label = document.createElement('span');

        button.type = 'button';
        button.className = 'toc-item';
        button.dataset.kind = 'conversation';
        button.dataset.conversationIndex = String(index);
        button.dataset.active = 'false';
        button.dataset.unloaded = String(Boolean(conversation.unloaded));
        button.title = conversation.fullLabel;

        number.className = 'prompt-index';
        number.textContent = String(conversation.logicalIndex + 1);
        label.className = 'toc-item-label';
        label.textContent = conversation.label;

        button.append(number, label);
        item.appendChild(button);
        fragment.appendChild(item);
        this.conversationItemButtons.push(button);
      });

      this.conversationList.replaceChildren(fragment);
      this.updateViewMeta();
    }

    clearConversationToc(clearCache = false) {
      window.clearTimeout(this.conversationRebuildTimer);
      globalThis.__cgptUnifiedRuntimeV1.pageWork.cancelFrame(this.conversationRebuildFrame); this.conversationRebuildFrame = 0;
      this.conversationRebuildTimer = 0;
      this.conversationItems = [];
      this.conversationItemButtons = [];
      this.activeConversationIndex = -1;
      this.lastRenderedConversationModel = null;
      this.resolvedApiOutline = null;
      this.lastConversationSignature = '';
      this.pendingConversationLogicalIndex = -1;
      this.pendingConversationUntil = 0;
      if (clearCache) this.clearConversationLabelCacheState();
      this.conversationList?.replaceChildren();
      this.updateViewMeta();
      this.syncVisibility();
    }

    findActiveConversationIndex() {
      if (!this.conversationItems.length) return -1;

      if (
        this.pendingConversationLogicalIndex >= 0 &&
        performance.now() < this.pendingConversationUntil
      ) {
        const pendingIndex = this.conversationItems.findIndex(
          (item) => item.logicalIndex === this.pendingConversationLogicalIndex,
        );
        if (pendingIndex >= 0) return pendingIndex;
      }

      if (this.currentAnswer?.isConnected) {
        let best = -1;
        for (let index = 0; index < this.conversationItems.length; index += 1) {
          const userElement = this.conversationItems[index].userElement;
          if (!userElement?.isConnected) continue;

          const relation = userElement.compareDocumentPosition(this.currentAnswer);
          if (relation & Node.DOCUMENT_POSITION_FOLLOWING) {
            best = index;
          } else if (relation & Node.DOCUMENT_POSITION_PRECEDING) {
            break;
          }
        }
        if (best >= 0) return best;
      }

      const officialActiveLogicalIndex = this.getOfficialActiveLogicalIndex();
      if (officialActiveLogicalIndex >= 0) {
        const officialActiveIndex = this.conversationItems.findIndex(
          (item) => item.logicalIndex === officialActiveLogicalIndex,
        );
        if (officialActiveIndex >= 0) return officialActiveIndex;
      }

      if (
        this.activeConversationIndex >= 0 &&
        this.activeConversationIndex < this.conversationItems.length
      ) {
        return this.activeConversationIndex;
      }

      return 0;
    }

    updateActiveConversation(force = false) {
      const index = this.findActiveConversationIndex();
      this.applyActiveConversationIndex(index, force);
    }

    applyActiveConversationIndex(index, ensureVisible) {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= this.conversationItemButtons.length
      ) {
        return;
      }
      if (this.activeConversationIndex === index && !ensureVisible) return;

      const previous = this.conversationItemButtons[this.activeConversationIndex];
      if (previous) {
        previous.dataset.active = 'false';
        previous.removeAttribute('aria-current');
      }

      this.activeConversationIndex = index;
      const current = this.conversationItemButtons[index];
      if (!current) return;

      current.dataset.active = 'true';
      current.setAttribute('aria-current', 'location');
      if (ensureVisible || (!this.collapsed && this.activeView === 'conversation')) {
        this.scrollItemIntoView(this.conversationNav, current);
      }
    }

    clearConversationJumpReveal() {
      window.clearTimeout(this.conversationJumpRevealTimer);
      this.conversationJumpRevealTimer = 0;
      if (this.conversationJumpRevealElement?.isConnected) {
        this.conversationJumpRevealElement.removeAttribute(
          'data-cgpt-conversation-jump-target',
        );
      }
      this.conversationJumpRevealElement = null;
    }

    revealConversationJumpTarget(target) {
      if (!(target instanceof HTMLElement)) return;
      if (this.conversationJumpRevealElement !== target) {
        this.clearConversationJumpReveal();
      }
      this.conversationJumpRevealElement = target;
      target.setAttribute('data-cgpt-conversation-jump-target', '');
      window.clearTimeout(this.conversationJumpRevealTimer);
      this.conversationJumpRevealTimer = window.setTimeout(() => {
        this.clearConversationJumpReveal();
      }, 2400);
    }

    cancelConversationJump() {
      this.conversationJumpToken += 1;
      for (const timer of this.conversationJumpTimers) window.clearTimeout(timer);
      this.conversationJumpTimers.clear();
      this.pendingConversationLogicalIndex = -1;
      this.pendingConversationUntil = 0;
      this.clearConversationJumpReveal();
    }

    scheduleConversationJumpTask(callback, delay, token) {
      const timer = window.setTimeout(() => {
        this.conversationJumpTimers.delete(timer);
        if (token !== this.conversationJumpToken) return;
        callback();
      }, Math.max(0, Number(delay) || 0));
      this.conversationJumpTimers.add(timer);
      return timer;
    }

    resolveConversationTarget(logicalIndex) {
      const currentItem = this.conversationItems.find(
        (item) => item.logicalIndex === logicalIndex,
      );
      if (
        currentItem?.mappingConfident &&
        currentItem.targetElement?.isConnected && currentItem.userElement?.isConnected
        && currentItem.targetElement.contains(currentItem.userElement)
        && currentItem.targetElement.closest('main, [role="main"]') === dom.main()
      ) {
        const expected = [currentItem.apiMessageId, currentItem.apiNodeId].filter(Boolean);
        const user = currentItem.userElement;
        const role = dom.role(user);
        const isUser = role === 'user' || (!role && user.matches('[data-chatgpt-search-unit-key$=":user"]'));
        const owner = currentItem.targetRecordIdentity;
        const unchangedOwner = !owner || owner.startsWith('user-node:')
          || owner === this.getConversationRecordIdentity(user, logicalIndex);
        const actual = [dom.messageId(user), this.getConversationTurnElement(user)?.getAttribute('data-turn-key')].filter(Boolean);
        if (isUser && unchangedOwner && (!expected.length || !actual.length || actual.some((id) => expected.includes(id)))) return currentItem.targetElement;
      }

      const records = this.collectUserMessageRecords();
      if (currentItem?.apiMessageId || currentItem?.apiNodeId) {
        const exactRecord = this.findApiRecordByIdentity({
          messageId: currentItem.apiMessageId,
          nodeId: currentItem.apiNodeId,
        }, records);
        if (exactRecord) {
          currentItem.userElement = exactRecord.userElement;
          currentItem.targetElement = exactRecord.targetElement;
          currentItem.targetRecordIdentity = exactRecord.identity;
          currentItem.mappingConfident = true;
          currentItem.unloaded = !exactRecord.targetElement?.isConnected;
          return exactRecord.targetElement || exactRecord.userElement;
        }
      }

      const mapping = this.mapUserRecordsToLogicalIndices(
        records,
        this.getOfficialNavButtons(),
      );
      const record = currentItem?.apiMessageId || currentItem?.apiNodeId || currentItem?.source === 'native-pending'
        ? this.findApiRecordMatch({
          logicalIndex, messageId: currentItem.apiMessageId, nodeId: currentItem.apiNodeId,
          fullLabel: currentItem.fullLabel, sourceHint: currentItem.source,
        }, records, mapping, this.resolvedApiOutline || this.getApiConversationOutlineForCurrentRoute())
        : mapping.recordsByIndex.get(logicalIndex);
      if (!record || !mapping.confident) return null;

      if (record.fullLabel && mapping.trustLabels) {
        this.cacheConversationRecordLabel(logicalIndex, record);
      }
      if (currentItem) {
        currentItem.userElement = record.userElement;
        currentItem.targetElement = record.targetElement;
        currentItem.targetRecordIdentity = record.identity;
        currentItem.fullLabel = record.fullLabel || currentItem.fullLabel;
        currentItem.label = this.formatConversationLabel(currentItem.fullLabel);
        currentItem.mappingConfident = true;
      }
      return record.targetElement || record.userElement;
    }

    isUsableConversationTarget(element) {
      if (!(element instanceof HTMLElement) || !element.isConnected) return false;
      if (element.closest('[hidden]')) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0 || element.getClientRects().length > 0;
    }

    getConversationJumpBehavior() {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      return this.config.answerTocSmoothScroll && !reduceMotion ? 'smooth' : 'auto';
    }

    getConversationScrollOffset() {
      return Math.max(
        0,
        Number(this.config.conversationTocScrollOffsetPx) || 88,
      );
    }

    scrollConversationTarget(target, behavior = 'auto') {
      if (!this.isUsableConversationTarget(target)) return false;
      this.revealConversationJumpTarget(target);

      const targetRect = target.getBoundingClientRect();
      const offset = this.getConversationScrollOffset();
      const scrollRoot = this.findScrollRoot(target);

      if (scrollRoot instanceof HTMLElement) {
        const rootRect = scrollRoot.getBoundingClientRect();
        const visibleTop = Math.max(0, rootRect.top);
        const visibleBottom = Math.min(window.innerHeight, rootRect.bottom);
        const availableHeight = Math.max(1, visibleBottom - visibleTop);
        const desiredTop = visibleTop + Math.min(offset, availableHeight * 0.3);
        const delta = targetRect.top - desiredTop;
        scrollRoot.scrollBy({ top: delta, behavior });
      } else {
        const desiredTop = Math.min(offset, window.innerHeight * 0.3);
        const delta = targetRect.top - desiredTop;
        window.scrollBy({ top: delta, behavior });
      }
      return true;
    }

    correctConversationTargetPosition(target) {
      return this.scrollConversationTarget(target, 'auto');
    }

    isConversationTargetAligned(target) {
      if (!this.isUsableConversationTarget(target)) return false;
      const scrollRoot = this.findScrollRoot(target);
      const rootRect = scrollRoot instanceof HTMLElement
        ? scrollRoot.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight };
      const visibleTop = Math.max(0, rootRect.top);
      const availableHeight = Math.max(1, Math.min(window.innerHeight, rootRect.bottom) - visibleTop);
      const desiredTop = visibleTop + Math.min(this.getConversationScrollOffset(), availableHeight * 0.3);
      return Math.abs(target.getBoundingClientRect().top - desiredTop) <= 24;
    }

    activateOfficialConversationButton(logicalIndex) {
      const button = this.getOfficialNavButtons().find((candidate) => (
        Number.parseInt(candidate.dataset.tocItemIndex ?? '', 10) === logicalIndex
      ));
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;

      try {
        button.click();
        return true;
      } catch (error) {
        console.warn('[ChatGPT 双层目录] 官方问答跳转失败：', error);
        return false;
      }
    }

    seekConversationHistory(logicalIndex, attempt = 0) {
      const scrollAnchor = this.currentAnswer?.isConnected
        ? this.currentAnswer
        : document.querySelector(`${USER_SELECTOR}, ${ASSISTANT_SELECTOR}`);
      const target = this.currentScrollRoot instanceof HTMLElement && this.currentScrollRoot.isConnected
        ? this.currentScrollRoot
        : scrollAnchor ? this.findScrollRoot(scrollAnchor) : null;
      if (!(target instanceof HTMLElement)) return false;

      const bounds = dom.scrollBounds(target);
      const desiredY = target.getBoundingClientRect().top + this.getConversationScrollOffset();
      const records = this.collectUserMessageRecords();
      const anchors = this.conversationItems.map((item) => {
        const record = this.findApiRecordMatch({
          messageId: item.apiMessageId,
          nodeId: item.apiNodeId,
          fullLabel: item.fullLabel,
        }, records);
        const element = record?.targetElement;
        if (!this.isUsableConversationTarget(element) || this.findScrollRoot(element) !== target) return null;
        return {
          index: item.logicalIndex,
          top: dom.clampScrollTop(target, target.scrollTop + element.getBoundingClientRect().top - desiredY),
        };
      }).filter(Boolean);
      const before = anchors.filter((anchor) => anchor.index < logicalIndex).at(-1);
      const after = anchors.find((anchor) => anchor.index > logicalIndex);
      const low = before?.top ?? bounds.min;
      const high = after?.top ?? bounds.max;
      const span = Math.max(0, high - low);
      const count = this.conversationItems.length;
      const fraction = count <= 1 ? 0 : logicalIndex / (count - 1);
      const center = logicalIndex === 0 ? low
        : logicalIndex === count - 1 ? high
          : before && after
            ? low + span * (logicalIndex - before.index) / (after.index - before.index)
            : bounds.min + (bounds.max - bounds.min) * fraction;
      const step = Math.max(180, target.clientHeight * 0.8);
      const seekAttempt = attempt === 23 ? 0 : attempt;
      const sweep = logicalIndex === 0 ? seekAttempt
        : logicalIndex === count - 1 ? -seekAttempt
          : seekAttempt === 0 ? 0 : (seekAttempt % 2 ? 1 : -1) * Math.ceil(seekAttempt / 2);
      const nextTop = Math.min(high, Math.max(low, center + sweep * step));
      target.scrollTo({ top: dom.clampScrollTop(target, nextTop), behavior: 'auto' });
      return true;
    }

    jumpToConversation(index) {
      this.cancelConversationLabelHydration(false);
      const item = this.conversationItems[index];
      if (!item) return;

      this.cancelHeadingJump();
      this.cancelConversationJump();
      globalThis.__cgptUnifiedRuntimeV1?.beginNavigationLease?.(3600);
      const token = this.conversationJumpToken;
      const routeKey = this.getConversationRouteKey();
      let logicalIndex = item.logicalIndex;
      const resolveClickedItem = () => {
        if (routeKey !== this.getConversationRouteKey()) { this.cancelConversationJump(); return null; }
        const liveItem = this.conversationItems.find(candidate => {
          if (item.apiMessageId) return candidate.apiMessageId === item.apiMessageId;
          if (item.apiNodeId) return candidate.apiNodeId === item.apiNodeId;
          return candidate === item || (candidate.logicalIndex === item.logicalIndex && candidate.fullLabel === item.fullLabel);
        });
        if (!liveItem) { this.cancelConversationJump(); return null; }
        logicalIndex = liveItem.logicalIndex;
        this.pendingConversationLogicalIndex = logicalIndex;
        return liveItem;
      };
      this.pendingConversationLogicalIndex = logicalIndex;
      this.pendingConversationUntil = performance.now() + 2600;
      this.applyActiveConversationIndex(index, true);

      let initialTarget = this.resolveConversationTarget(logicalIndex);
      if (!this.isUsableConversationTarget(initialTarget)) {
        globalThis.__cgptUnifiedRuntimeV1?.lazy?.revealAllForNavigation?.();
        initialTarget = this.resolveConversationTarget(logicalIndex) || initialTarget;
      }
      const canDirectlyScroll = this.isUsableConversationTarget(initialTarget);
      let jumpLifetime = 2250;
      let jumpSettled = false;

      if (canDirectlyScroll) {
        const behavior = this.getConversationJumpBehavior();
        this.scrollConversationTarget(initialTarget, behavior);
        this.scheduleConversationJumpTask(() => {
          if (!resolveClickedItem()) return;
          const liveTarget = this.resolveConversationTarget(logicalIndex) || initialTarget;
          if (this.isUsableConversationTarget(liveTarget)
            && !this.isConversationTargetAligned(liveTarget)) {
            this.correctConversationTargetPosition(liveTarget);
          }
          this.requestFrame(true);
        }, behavior === 'smooth' ? 1050 : 220, token);
      } else {
        const activated = this.activateOfficialConversationButton(logicalIndex);
        const retryDelays = activated
          ? [100, 280, 620, 1150, 1950]
          : Array.from({ length: 24 }, (_, attempt) => attempt * 240);
        if (!activated) {
          jumpLifetime = 5900;
          globalThis.__cgptUnifiedRuntimeV1?.beginNavigationLease?.(6400);
        }

        const retry = (attempt) => {
          const delay = retryDelays[attempt];
          this.scheduleConversationJumpTask(() => {
            if (!resolveClickedItem()) return;
            if (jumpSettled) return;
            if (attempt === 0 || attempt === 3) {
              this.syncOfficialConversationNav();
              this.scheduleConversationRebuild(0);
            }

            const liveTarget = this.resolveConversationTarget(logicalIndex);
            if (this.isUsableConversationTarget(liveTarget)) {
              jumpSettled = true;
              this.pendingConversationUntil = performance.now() + 800;
              this.correctConversationTargetPosition(liveTarget);
              this.requestFrame(true);
              return;
            }

            /* React 若替换了官方按钮，在中段再解析并补点一次。 */
            if (activated && delay === 620) {
              const activeLogicalIndex = this.getOfficialActiveLogicalIndex();
              if (activeLogicalIndex !== logicalIndex) {
                this.activateOfficialConversationButton(logicalIndex);
              }
            } else if (!activated) {
              const newlyAvailableButton = this.getOfficialNavButtons().find((candidate) =>
                Number.parseInt(candidate.dataset.tocItemIndex ?? '', 10) === logicalIndex);
              if (newlyAvailableButton instanceof HTMLButtonElement) {
                newlyAvailableButton.click();
              } else {
                this.seekConversationHistory(logicalIndex, attempt);
              }
            }
            if (attempt + 1 < retryDelays.length) retry(attempt + 1);
          }, attempt === 0 ? delay : delay - retryDelays[attempt - 1], token);
        };
        retry(0);
      }

      this.pendingConversationUntil = performance.now() + Math.max(2600, jumpLifetime + 100);
      this.scheduleConversationJumpTask(() => {
        jumpSettled = true;
        this.pendingConversationLogicalIndex = -1;
        this.pendingConversationUntil = 0;
        this.requestFrame(true);
        window.setTimeout(() => {
          if (token === this.conversationJumpToken) {
            this.clearConversationJumpReveal();
          }
        }, 240);
      }, jumpLifetime, token);
    }

    syncTopLayer(raise = false) {
      const host = this.host;
      if (!host || !host.hasAttribute('popover')) return;
      let modal = null;
      try {
        const modals = document.querySelectorAll('dialog:modal');
        modal = modals[modals.length - 1] || null;
      } catch {}
      // Outside a native modal dialog, even top-layer elements can be inert.
      // Keep the same host/shadow tree inside the modal until it closes.
      const parent = modal || document.body;
      const focused = this.shadow?.activeElement;
      try {
        if (host.parentElement !== parent) {
          if (host.matches(':popover-open')) host.hidePopover();
          parent.appendChild(host);
        }
        if (host.hidden) {
          if (host.matches(':popover-open')) host.hidePopover();
          return;
        }
        if (raise && host.matches(':popover-open')) host.hidePopover();
        if (!host.matches(':popover-open')) host.showPopover();
        if (focused && this.shadow.activeElement !== focused) focused.focus({ preventScroll: true });
      } catch {
        // Retain the visible fixed-position fallback if this browser rejects
        // popovers, rather than leaving the entire toolbox UA-hidden.
        host.removeAttribute('popover');
      }
    }

    installTopLayer() {
      if (!this.host?.hasAttribute('popover')) return;
      let frame = 0;
      let raise = false;
      const schedule = (shouldRaise = false) => {
        raise ||= shouldRaise;
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          this.syncTopLayer(raise);
          raise = false;
        });
      };
      document.addEventListener('toggle', (event) => {
        if (event.target === this.host || !(event.target instanceof Element)) return;
        if (event.target.matches('dialog, [popover]')) schedule(event.newState === 'open');
      }, true);
      this.topLayerObserver = new MutationObserver((records) => {
        if (records.some((record) => (record.type === 'attributes' && record.target.matches('dialog'))
          || Array.from(record.addedNodes).some((node) => node instanceof Element
            && (node.matches('dialog[open]') || node.querySelector('dialog[open]')))
          || !this.host.isConnected)) schedule(true);
      });
      this.topLayerObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    }

    isViewportEligible() {
      return (
        this.config.answerTocMinViewportWidth <= 0 ||
        document.documentElement.clientWidth >= this.config.answerTocMinViewportWidth
      );
    }

    syncVisibility() {
      if (!this.host) return;

      const wasHidden = this.host.hidden;
      const hasAnyNavigation =
        this.conversationItems.length > 0 || this.headings.length > 0 || Boolean(this.promptLibrary);
      this.host.hidden = !this.isViewportEligible() || !hasAnyNavigation;
      this.syncTopLayer();

      if (this.host.hidden && this.transientHoverOpen) {
        this.transientHoverOpen = false;
        this.transientHoverOriginRect = null;
        this.clearTransientOriginClickSuppression();
        this.collapsed = true;
        this.applyCollapsedState();
      }

      if (!this.host.hidden) {
        this.applyActiveView();
        this.applyCollapsedState();
        this.updateViewMeta();

        if (wasHidden) {
          window.requestAnimationFrame(() => {
            this.ensurePanelSizeInViewport(false);
            this.ensureManualPositionInViewport(true);

            if (!this.collapsed) {
              const current = this.activeView === 'conversation'
                ? this.conversationItemButtons[this.activeConversationIndex]
                : this.itemButtons[this.activeIndex];
              const nav = this.activeView === 'conversation'
                ? this.conversationNav
                : this.tocNav;
              if (current) this.scrollItemIntoView(nav, current);
            }
          });
        }
      }
    }

    clearHeadingJumpSettleListener() {
      window.clearTimeout(this.headingJumpSettleTimer);
      this.headingJumpSettleTimer = 0;
      if (this.headingJumpScrollTarget && this.headingJumpScrollEndHandler) {
        try {
          this.headingJumpScrollTarget.removeEventListener('scrollend', this.headingJumpScrollEndHandler);
        } catch {}
      }
      this.headingJumpScrollTarget = null;
      this.headingJumpScrollEndHandler = null;
    }

    cancelHeadingJump() {
      this.headingJumpToken += 1;
      this.clearHeadingJumpSettleListener();
      this.pendingHeadingIndex = -1;
      this.pendingHeadingElement = null;
      this.pendingHeadingUntil = 0;
      window.clearTimeout(this.pendingHeadingTimer);
      this.pendingHeadingTimer = 0;
    }

    cancelNavigationForGesture(event) {
      if (event.isTrusted === false || event.composedPath?.().includes(this.host)) return;
      if (event.type === 'keydown' && (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
        || event.target?.closest?.('input, textarea, select, [contenteditable="true"]'))) return;
      const pending = this.pendingHeadingIndex >= 0 || this.pendingConversationLogicalIndex >= 0;
      if (!pending) return;
      // Stop the browser animation as well as all delayed correction/retry work.
      const target = this.currentScrollRoot;
      if (target instanceof HTMLElement && target.isConnected) {
        target.scrollTo({ top: target.scrollTop, behavior: 'instant' });
      } else {
        window.scrollTo({ top: window.scrollY, behavior: 'instant' });
      }
      this.cancelHeadingJump();
      this.cancelConversationJump();
      this.cancelConversationLabelHydration(false);
      globalThis.__cgptUnifiedRuntimeV1?.beginNavigationLease?.(500);
      this.requestFrame(true);
    }

    jumpToHeading(index) {
      const heading = this.headings[index];
      if (!heading?.element?.isConnected) return;

      this.cancelConversationJump();
      this.cancelConversationLabelHydration(false);
      this.cancelHeadingJump();
      const token = this.headingJumpToken;
      const routeKey = this.getConversationRouteKey();
      const answer = this.currentAnswer;
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const behavior = this.config.answerTocSmoothScroll && !reduceMotion
        ? 'smooth'
        : 'auto';

      // 跳转完成前固定用户点击的章节，避免 smooth scroll 穿过中间标题时高亮闪烁。
      const maxHoldMs = behavior === 'smooth' ? 1800 : 260;
      this.pendingHeadingIndex = index;
      this.pendingHeadingElement = heading.element;
      this.pendingHeadingUntil = performance.now() + maxHoldMs;
      this.applyActiveIndex(index, true);
      globalThis.__cgptUnifiedRuntimeV1?.beginNavigationLease?.(behavior === 'smooth' ? 2600 : 900);

      const finish = () => {
        if (token !== this.headingJumpToken) return;
        if (routeKey !== this.getConversationRouteKey() || answer !== this.currentAnswer
          || !this.headings.some(item => item.element === heading.element)) {
          this.cancelHeadingJump();
          return;
        }
        this.clearHeadingJumpSettleListener();
        if (heading.element.isConnected) {
          const targetY = this.getJumpLineViewportY();
          const delta = heading.element.getBoundingClientRect().top - targetY;
          if (Math.abs(delta) > 8) this.scrollHeadingToReadingLine(heading.element, 'auto');
        }
        this.pendingHeadingIndex = -1;
        this.pendingHeadingElement = null;
        this.pendingHeadingUntil = 0;
        window.clearTimeout(this.pendingHeadingTimer);
        this.pendingHeadingTimer = 0;
        this.requestFrame(false);
      };

      this.scrollHeadingToReadingLine(heading.element, behavior);

      if (behavior === 'smooth') {
        // Chrome/Edge 支持 scrollend 时等真实动画结束再校正；不支持时走超时兜底。
        const scrollTarget = this.currentScrollRoot instanceof HTMLElement
          ? this.currentScrollRoot
          : document;
        const startedAt = performance.now();
        const onScrollEnd = () => {
          if (token !== this.headingJumpToken) return;
          // 防止上一段滚动残留的 scrollend 在本次跳转刚开始时误触发。
          const elapsed = performance.now() - startedAt;
          if (elapsed < 90) {
            window.clearTimeout(this.headingJumpSettleTimer);
            this.headingJumpSettleTimer = window.setTimeout(finish, 100 - elapsed);
            return;
          }
          finish();
        };
        this.headingJumpScrollTarget = scrollTarget;
        this.headingJumpScrollEndHandler = onScrollEnd;
        try {
          scrollTarget.addEventListener('scrollend', onScrollEnd, { once: true, passive: true });
        } catch {}
        this.headingJumpSettleTimer = window.setTimeout(finish, maxHoldMs);
      } else {
        this.headingJumpSettleTimer = window.setTimeout(finish, 80);
      }
    }

    getJumpLineViewportY() {
      const ratio = Math.min(0.75, Math.max(0.08, Number(this.config.answerTocJumpLineRatio) || 0.22));
      if (this.currentScrollRoot instanceof HTMLElement) {
        const rect = this.currentScrollRoot.getBoundingClientRect();
        const top = Math.max(0, rect.top);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        return top + Math.max(1, bottom - top) * ratio;
      }
      return window.innerHeight * ratio;
    }

    scrollHeadingToReadingLine(element, behavior = 'auto') {
      if (!(element instanceof HTMLElement) || !element.isConnected) return;
      const targetY = this.getJumpLineViewportY();
      const delta = element.getBoundingClientRect().top - targetY;
      if (Math.abs(delta) < 1) return;

      if (this.currentScrollRoot instanceof HTMLElement) {
        this.currentScrollRoot.scrollTo({
          top: dom.clampScrollTop(this.currentScrollRoot, this.currentScrollRoot.scrollTop + delta),
          behavior,
        });
      } else {
        const scrollingElement = document.scrollingElement || document.documentElement;
        const currentTop = window.scrollY || scrollingElement.scrollTop || 0;
        window.scrollTo({ top: Math.max(0, currentTop + delta), behavior });
      }
    }

    updateActiveHeading() {
      if (!this.headings.length || !this.currentAnswer?.isConnected) return;

      if (
        this.pendingHeadingIndex >= 0 &&
        this.pendingHeadingIndex < this.headings.length &&
        performance.now() < this.pendingHeadingUntil
      ) {
        this.applyActiveIndex(this.pendingHeadingIndex, false);
        return;
      }
      if (this.pendingHeadingIndex >= 0) {
        this.pendingHeadingIndex = -1;
        this.pendingHeadingUntil = 0;
      }

      const lineY = this.getActiveLineViewportY();
      const hysteresis = Math.max(0, Number(this.config.answerTocActiveHysteresisPx) || 0);
      const currentScrollTop = this.getScrollTop();
      const viewportSpan = this.getScrollViewportSpan();
      const largeJump = Math.abs(currentScrollTop - this.lastScrollTop) > viewportSpan * 0.8;
      this.lastScrollTop = currentScrollTop;

      let index = this.activeIndex;
      if (index < 0 || index >= this.headings.length || largeJump) {
        index = this.findActiveIndexBinary(lineY);
      } else {
        // 向下进入新章节时必须越过活动线一点；向上返回旧章节同理。
        // 这一小段迟滞区能消除触控板慢滚时的 2↔3 抖动。
        while (
          index + 1 < this.headings.length &&
          this.headings[index + 1].element.getBoundingClientRect().top <= lineY - hysteresis
        ) {
          index += 1;
        }

        while (
          index > 0 &&
          this.headings[index].element.getBoundingClientRect().top > lineY + hysteresis
        ) {
          index -= 1;
        }
      }

      this.applyActiveIndex(index, false);
    }

    findActiveIndexBinary(lineY = this.getActiveLineViewportY()) {
      if (!this.headings.length) return -1;
      if (this.headings[0].element.getBoundingClientRect().top > lineY) return 0;

      let low = 0;
      let high = this.headings.length - 1;
      let best = 0;

      while (low <= high) {
        const middle = (low + high) >> 1;
        const top = this.headings[middle].element.getBoundingClientRect().top;

        if (top <= lineY) {
          best = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }

      return best;
    }

    applyActiveIndex(index, ensureVisible) {
      if (!Number.isInteger(index) || index < 0 || index >= this.itemButtons.length) {
        return;
      }
      if (this.activeIndex === index && !ensureVisible) return;

      const previous = this.itemButtons[this.activeIndex];
      if (previous) {
        previous.dataset.active = 'false';
        previous.removeAttribute('aria-current');
      }

      this.activeIndex = index;
      const current = this.itemButtons[index];
      if (!current) return;

      current.dataset.active = 'true';
      current.setAttribute('aria-current', 'location');
      if (
        ensureVisible ||
        (!this.collapsed && this.activeView === 'headings' && !this.isHeadingNavAutoFollowSuspended())
      ) {
        this.scrollItemIntoView(this.tocNav, current);
      }
    }

    markHeadingNavInteraction(duration = this.config.answerTocManualBrowseHoldMs) {
      const hold = Math.max(250, Number(duration) || 1500);
      this.headingNavUserActiveUntil = Math.max(this.headingNavUserActiveUntil, performance.now() + hold);
    }

    isHeadingNavAutoFollowSuspended() {
      return this.headingNavPointerInside || performance.now() < this.headingNavUserActiveUntil;
    }

    scrollItemIntoView(nav, button) {
      if (!(nav instanceof HTMLElement) || !(button instanceof HTMLElement)) return;
      if (nav.hidden) return;

      const navRect = nav.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const padding = 5;

      if (buttonRect.top < navRect.top + padding) {
        nav.scrollTop += buttonRect.top - navRect.top - padding;
      } else if (buttonRect.bottom > navRect.bottom - padding) {
        nav.scrollTop += buttonRect.bottom - navRect.bottom + padding;
      }
    }

    getActiveLineViewportY() {
      const ratio = Math.min(0.9, Math.max(0.05, this.config.answerTocActiveLineRatio));

      if (this.currentScrollRoot instanceof HTMLElement) {
        const rect = this.currentScrollRoot.getBoundingClientRect();
        const top = Math.max(0, rect.top);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        const height = Math.max(1, bottom - top);
        return top + height * ratio;
      }

      return window.innerHeight * ratio;
    }

    findScrollRoot(element) {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent === document.body || parent === document.documentElement) break;

        const style = getComputedStyle(parent);
        if (
          /^(auto|scroll|overlay)$/.test(style.overflowY) &&
          parent.scrollHeight > parent.clientHeight + 4
        ) {
          return parent;
        }
      }

      return null;
    }

    getScrollTop() {
      if (this.currentScrollRoot instanceof HTMLElement) {
        return this.currentScrollRoot.scrollTop;
      }
      return window.scrollY || document.documentElement.scrollTop || 0;
    }

    getScrollViewportSpan() {
      if (this.currentScrollRoot instanceof HTMLElement) {
        return Math.max(1, this.currentScrollRoot.clientHeight);
      }
      return Math.max(1, window.innerHeight);
    }

    getOfficialNavContainer() {
      if (this.officialNavContainer?.isConnected) return this.officialNavContainer;
      this.syncOfficialConversationNav();
      return this.officialNavContainer;
    }

    updateInlineEndOffset() {
      if (!this.host || this.positionMode === 'manual') return;

      this.host.dataset.dockSide = 'right';
      let offset = this.config.hideOfficialConversationToc
        ? Math.max(0, Number(this.config.answerTocStandaloneInlineEndPx) || 20)
        : Math.max(0, Number(this.config.answerTocFallbackInlineEndPx) || 68);

      if (document.documentElement.clientWidth < 820) offset = 8;

      if (!this.config.hideOfficialConversationToc) {
        const container = this.getOfficialNavContainer();
        if (container) {
          const rect = container.getBoundingClientRect();
          const direction = getComputedStyle(document.documentElement).direction;
          const occupiedFromInlineEnd = direction === 'rtl'
            ? rect.right
            : window.innerWidth - rect.left;

          offset = Math.max(
            offset,
            Math.ceil(
              occupiedFromInlineEnd +
              (Number(this.config.answerTocOfficialNavGapPx) || 12),
            ),
          );
        }
      }

      this.host.style.setProperty('--cgpt-answer-toc-inline-end', `${offset}px`);
    }
  }


  const startAnswerToc = () => {
    const controller = new AnswerTocController(CONFIG);
    globalThis.__cgptUnifiedRuntimeV1.answerToc = controller;
    controller.start();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startAnswerToc, { once: true });
  } else {
    startAnswerToc();
  }
})();


/* ===== Module 2: adaptive performance monitoring (React-owned feed stays intact) ===== */

/* SPDX-License-Identifier: GPL-3.0-or-later */
/*!
 * ChatGPT Lazy Chat++ — Userscript
 * Custom long-chat build: UI-free, token-estimator-free, non-destructive feed handling.
 * Copyright (C) 2025 Alex S Hamilton
 */

(function () {
  'use strict';

  const TRANSLATE_PATH_RE = /^\/translate\/?$/i;
  const isTranslatePage = () =>
    location.hostname === 'chatgpt.com' && TRANSLATE_PATH_RE.test(location.pathname);

  if (isTranslatePage()) {
    bootTranslatePageTweaks();
    return;
  }

  bootNormalCopy();
  bootLazyChat();

  function bootNormalCopy() {
    const forceNormalCopy = event => {
      if (!document.documentElement?.hasAttribute('data-cgfc-normal-text-copy')) return;
      // Leave native editor cut/copy and controls to their owners. Only a
      // selection wholly inside rendered chat text uses normal browser copy.
      const editable = node => {
        const element = node instanceof Element ? node : node?.parentElement;
        return element?.isContentEditable || element?.closest('input,textarea,[role="textbox"],button,[contenteditable]:not([contenteditable="false"])');
      };
      if ((event.composedPath?.() || [event.target]).some(editable)) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount || editable(selection.anchorNode) || editable(selection.focusNode)) return;
      const main = selection.anchorNode?.parentElement?.closest('main,[role="main"]');
      if (!main?.contains(selection.focusNode)) return;
      const range = selection.getRangeAt(0);
      // A selection can cross an editor even when both endpoints are outside it.
      if (Array.from(main.querySelectorAll('input,textarea,[contenteditable]:not([contenteditable="false"])')).some(node => {
        try { return range.intersectsNode(node); } catch { return true; }
      })) return;
      event.stopImmediatePropagation();
    };
    for (const name of ['copy', 'cut']) document.addEventListener(name, forceNormalCopy, true);
  }

  function bootTranslatePageTweaks() {
    const STYLE_ID = 'cgpt-translate-layout-style';
    const ROOT_ATTR = 'data-cgpt-translate-page';
    const MARK_ATTRS = [
      'data-cgpt-translate-main',
      'data-cgpt-translate-heading',
      'data-cgpt-translate-content',
      'data-cgpt-translate-controls',
      'data-cgpt-translate-panels',
      'data-cgpt-translate-source-col',
      'data-cgpt-translate-target-col',
      'data-cgpt-translate-target-wrap',
      'data-cgpt-translate-source',
      'data-cgpt-translate-target',
      'data-cgpt-translate-actions'
    ];

    let observer = null;
    let markRaf = 0;

    function ensureStyle() {
      if (document.getElementById(STYLE_ID)) return;

      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = `
        html[${ROOT_ATTR}="1"] {
          --cgpt-translate-desktop-height: clamp(420px, 80dvh, 960px);
          --cgpt-translate-mobile-top: 16.5dvh;
        }

        html[${ROOT_ATTR}="1"],
        html[${ROOT_ATTR}="1"] body {
          min-height: 100%;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-main] {
          width: 100% !important;
          max-width: min(1600px, 96vw) !important;
          min-height: calc(100dvh - var(--mkt-header-height, 0px)) !important;
          padding-inline: clamp(16px, 2vw, 24px) !important;
          padding-top: clamp(10px, 1.5dvh, 18px) !important;
          padding-bottom: clamp(10px, 2dvh, 22px) !important;
          gap: clamp(10px, 1.5dvh, 18px) !important;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-heading] {
          margin: 0 !important;
          padding-block: clamp(6px, 1.5dvh, 18px) !important;
          font-size: clamp(1.8rem, 3vw, 3rem) !important;
          line-height: 1.1 !important;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-content] {
          display: flex !important;
          flex-direction: column !important;
          flex: 1 1 auto !important;
          min-height: 0 !important;
          gap: clamp(12px, 1.75dvh, 20px) !important;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-controls] {
          flex: 0 0 auto !important;
          gap: clamp(8px, 1.2dvh, 14px) !important;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-controls] select,
        html[${ROOT_ATTR}="1"] [data-cgpt-translate-controls] button {
          min-height: clamp(42px, 4.75dvh, 52px) !important;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-panels] {
          display: flex !important;
          flex-direction: row !important;
          align-items: stretch !important;
          gap: clamp(12px, 2vw, 24px) !important;
          flex: 0 0 auto !important;
          height: var(--cgpt-translate-desktop-height) !important;
          min-height: var(--cgpt-translate-desktop-height) !important;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-source-col],
        html[${ROOT_ATTR}="1"] [data-cgpt-translate-target-col] {
          display: flex !important;
          flex-direction: column !important;
          flex: 1 1 0 !important;
          min-height: 0 !important;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-target-wrap] {
          position: relative !important;
          display: flex !important;
          flex: 1 1 auto !important;
          min-height: 0 !important;
        }

        html[${ROOT_ATTR}="1"] textarea[data-cgpt-translate-source],
        html[${ROOT_ATTR}="1"] textarea[data-cgpt-translate-target] {
          flex: 1 1 auto !important;
          width: 100% !important;
          min-height: 0 !important;
          height: 100% !important;
          max-height: none !important;
          overflow: auto !important;
          resize: none !important;
        }

        html[${ROOT_ATTR}="1"] [data-cgpt-translate-actions] {
          flex: 0 0 auto !important;
        }

        @media (max-width: 767.98px) {
          html[${ROOT_ATTR}="1"] [data-cgpt-translate-main] {
            max-width: 100vw !important;
            min-height: calc(100dvh - var(--mkt-header-height, 0px)) !important;
            padding-inline: 12px !important;
            padding-top: 8px !important;
            padding-bottom: 10px !important;
            gap: 8px !important;
          }

          html[${ROOT_ATTR}="1"] [data-cgpt-translate-heading] {
            padding-block: 2px !important;
            font-size: clamp(1rem, 5vw, 1.35rem) !important;
            line-height: 1.15 !important;
          }

          html[${ROOT_ATTR}="1"] [data-cgpt-translate-content] {
            gap: 8px !important;
          }

          html[${ROOT_ATTR}="1"] [data-cgpt-translate-controls] {
            gap: 6px !important;
          }

          html[${ROOT_ATTR}="1"] [data-cgpt-translate-controls] select,
          html[${ROOT_ATTR}="1"] [data-cgpt-translate-controls] button {
            min-height: 36px !important;
            height: 36px !important;
            font-size: 14px !important;
            padding-top: 6px !important;
            padding-bottom: 6px !important;
          }

          html[${ROOT_ATTR}="1"] [data-cgpt-translate-panels] {
            flex: 1 1 auto !important;
            flex-direction: column !important;
            height: calc(100dvh - var(--mkt-header-height, 0px) - var(--cgpt-translate-mobile-top) - 24px) !important;
            min-height: calc(100dvh - var(--mkt-header-height, 0px) - var(--cgpt-translate-mobile-top) - 24px) !important;
            gap: 8px !important;
          }

          html[${ROOT_ATTR}="1"] [data-cgpt-translate-actions] {
            display: none !important;
          }
        }
      `;

      document.head.appendChild(s);
    }

    function commonAncestor(a, b) {
      const seen = new Set();
      let cur = a;

      while (cur) {
        seen.add(cur);
        cur = cur.parentElement;
      }

      cur = b;
      while (cur) {
        if (seen.has(cur)) return cur;
        cur = cur.parentElement;
      }

      return null;
    }

    function childOfAncestor(node, ancestor) {
      let cur = node;
      let prev = node;

      while (cur && cur !== ancestor) {
        prev = cur;
        cur = cur.parentElement;
        if (cur === ancestor) return prev;
      }

      return null;
    }

    function clearMarks() {
      const selector = MARK_ATTRS.map((attr) => `[${attr}]`).join(',');
      document.querySelectorAll(selector).forEach((el) => {
        MARK_ATTRS.forEach((attr) => el.removeAttribute(attr));
      });
    }

    function mark(el, attr) {
      if (el) el.setAttribute(attr, '1');
    }

    function applyMarks() {
      if (!isTranslatePage()) {
        clearMarks();
        document.documentElement.removeAttribute(ROOT_ATTR);
        return;
      }

      document.documentElement.setAttribute(ROOT_ATTR, '1');

      const main = document.querySelector('main');
      if (!main) return;

      const heading = Array.from(main.querySelectorAll('h1')).find((el) =>
        /translate/i.test(el.textContent || '')
      );

      const textareas = Array.from(main.querySelectorAll('textarea'));
      const source = textareas.find((el) => !(el.readOnly || el.hasAttribute('readonly')));
      const target = textareas.find((el) => el.readOnly || el.hasAttribute('readonly'));

      const controls = Array.from(main.querySelectorAll('div')).find(
        (el) => el.querySelectorAll('select').length >= 2
      );

      const panels = source && target ? commonAncestor(source, target) : null;
      const content =
        controls && panels && controls.parentElement === panels.parentElement
          ? controls.parentElement
          : panels?.parentElement || controls?.parentElement || null;

      const sourceCol = panels && source ? childOfAncestor(source, panels) : null;
      const targetCol = panels && target ? childOfAncestor(target, panels) : null;
      const targetWrap = target && targetCol && target.parentElement !== targetCol ? target.parentElement : null;

      const actions =
        panels?.nextElementSibling?.tagName === 'SECTION'
          ? panels.nextElementSibling
          : Array.from(main.querySelectorAll('section')).find((el) => el.querySelectorAll('button').length >= 2) || null;

      if (!heading || !source || !target || !controls || !panels) return;

      clearMarks();
      mark(main, 'data-cgpt-translate-main');
      mark(heading, 'data-cgpt-translate-heading');
      mark(content, 'data-cgpt-translate-content');
      mark(controls, 'data-cgpt-translate-controls');
      mark(panels, 'data-cgpt-translate-panels');
      mark(sourceCol, 'data-cgpt-translate-source-col');
      mark(targetCol, 'data-cgpt-translate-target-col');
      mark(targetWrap, 'data-cgpt-translate-target-wrap');
      mark(source, 'data-cgpt-translate-source');
      mark(target, 'data-cgpt-translate-target');
      mark(actions, 'data-cgpt-translate-actions');
    }

    function scheduleApplyMarks() {
      cancelAnimationFrame(markRaf);
      markRaf = requestAnimationFrame(applyMarks);
    }

    function boot() {
      ensureStyle();
      scheduleApplyMarks();

      if (observer) observer.disconnect();
      observer = new MutationObserver(scheduleApplyMarks);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
    else window.addEventListener('DOMContentLoaded', boot, { once: true });
  }

  function bootLazyChat() {
    // ============================================================
    // ChatGPT Lazy Chat++ V2 — Adaptive Performance Engine
    //
    // Design goals:
    // 1) Preserve React-owned turns; do not detach live message nodes.
    // 2) Adapt the live-window size to turn count + browser pressure.
    // 3) Do zero non-essential DOM work while streaming / typing.
    // 4) Avoid fetch/API interception and avoid token/text scanning.
    // 5) Improve huge formula/code replies with conservative CSS containment.
    // 6) Stay invisible: no floating button / overlay.
    // ============================================================

    const VERSION = '2.0.0';
    const ROOT_FLAG = 'data-lcpp-v2';
    const ROOT_PRESSURE = 'data-lcpp-pressure';
    const ROOT_HOT = 'data-lcpp-hot';
    const ROOT_STREAMING = 'data-lcpp-streaming';

    // ---------- Adaptive window ----------
    const MIN_RETAIN = 8;
    const REVEAL_BATCH = 10;
    const MAX_DETACH_PER_IDLE = 18;
    const TOP_REVEAL_THRESHOLD = 150;       // px
    const BOTTOM_RECOLLAPSE_THRESHOLD = 850; // px: 可开始回收，但不代表视口应被强制吸到底部
    const BOTTOM_PIN_THRESHOLD = 96;         // px: 只有真正贴近底部时才维持 bottom pin
    const RECOLLAPSE_DELAY_MS = 850;

    // ---------- Scheduling ----------
    const OBS_DEBOUNCE_MS = 420;
    const STREAM_POLL_MS = 350;
    const STREAM_END_COOLDOWN_MS = 600;
    const PRESSURE_SCAN_MS = 6000;
    const ROUTE_POLL_MS = 1200;
    const INPUT_HOT_MS = 900;
    const ACTION_HOT_MS = 1400;

    // ---------- Pressure scan caps ----------
    const NODE_COUNT_CAP = 14000;
    const MATH_COUNT_CAP = 220;
    const CODE_COUNT_CAP = 60;
    const LONG_TASK_WINDOW_MS = 15000;

    // Prefer current ChatGPT turn hosts, then older/fallback selectors.
    const TURN_HOST_SELECTOR = [
      'section[data-testid^="conversation-turn-"]',
      'article[data-testid^="conversation-turn-"]'
    ].join(',');

    const TURN_FALLBACK_SELECTOR = [
      '[data-testid^="conversation-turn-"]',
      'article[data-turn-id]',
      'article[data-turn]',
      'div[data-testid^="conversation-turn"]',
      'li[data-testid^="conversation-turn"]'
    ].join(',');

    const STOP_BTN_SEL = [
      '#composer-submit-button[data-testid="stop-button"]',
      '[data-testid="stop-button"]',
      'button[aria-label*="stop streaming" i]',
      'button[aria-label*="stop generating" i]',
      'button[aria-label="停止生成" i]',
      'button[aria-label="停止回答" i]',
      'button[aria-label="停止输出" i]'
    ].join(',');

    const COMPOSER_SEL = [
      '#prompt-textarea',
      'textarea[name="prompt-textarea"]',
      '.ProseMirror[contenteditable="true"]',
      'form[class*="composer"] textarea',
      'form[class*="composer"] [contenteditable="true"]'
    ].join(',');

    const MATH_SELECTOR = '.katex, .katex-display, mjx-container, math';
    const CODE_SELECTOR = 'pre, table, .cm-editor, [data-testid*="code" i]';

    // ---------- State ----------
    let hiddenStore = []; // [{ placeholder, node }]
    const renderTurns = new Set();
    let renderResizeObserver = null;
    let renderMutationObserver = null;
    let renderMutationRoot = null;
    let pressureMetricsCache = new WeakMap();
    let pressureCacheHits = 0;
    let pressureCacheMisses = 0;
    let revealExtra = 0;
    let pressureLevel = 0;
    let lastMetrics = null;

    let observer = null;
    let observerRoot = null;
    let scrollContainer = null;
    let scrollAttachedTarget = null;

    let isStreaming = false;
    let streamEndTimer = 0;
    let inputHotUntil = 0;
    let hotReleaseTimer = 0;
    let recollapseTimer = 0;

    let pendingApply = null;
    let applyIdleHandle = 0;
    let applyTimeoutHandle = 0;

    let pressureTimer = 0;
    let routeTimer = 0;
    let routeKey = location.href;

    let longTaskObserver = null;
    let longTasks = []; // [{at, duration}]

    // ============================================================
    // Utilities
    // ============================================================

    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

    function setRootAttr(name, value) {
      try {
        const root = document.documentElement;
        if (!root) return;
        if (value === false || value === null || value === undefined) {
          if (root.hasAttribute(name)) root.removeAttribute(name);
        } else {
          const text = String(value);
          if (root.getAttribute(name) !== text) root.setAttribute(name, text);
        }
      } catch {}
    }

    function now() {
      return Date.now();
    }

    function isUnifiedNavigationActive() {
      return document.documentElement?.hasAttribute('data-cgpt-unified-navigation-active') === true;
    }

    function isInteractionHot() {
      // 目录跳转期间性能模块必须完全让路，避免刚恢复的目标轮次
      // 在长距离导航重试尚未结束时又被后台回收。
      return now() < inputHotUntil || isUnifiedNavigationActive();
    }

    function hasStopButton() {
      try {
        const generation = globalThis.__cgptUnifiedRuntimeV1?.readQueueResponseState;
        if (generation) return generation({ busyOnly: true }).busy === true;
        return Array.from(document.querySelectorAll(STOP_BTN_SEL)).some(node => node.isConnected && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
      } catch {
        return false;
      }
    }

    function isComposerTarget(target) {
      if (!(target instanceof Element)) return false;
      try {
        if (target.matches(COMPOSER_SEL)) return true;
        return !!target.closest(COMPOSER_SEL);
      } catch {
        return false;
      }
    }

    function isHeavyActionTarget(target) {
      if (!(target instanceof Element)) return false;
      const btn = target.closest('button');
      if (!btn || !btn.closest('main')) return false;
      const meta = [
        btn.getAttribute('aria-label') || '',
        btn.getAttribute('title') || '',
        btn.getAttribute('data-testid') || '',
        btn.textContent || ''
      ].join(' ').toLowerCase();

      return /edit|retry|regenerate|try again|stop|continue|pause|编辑|重试|重新生成|停止|继续/.test(meta);
    }

    function markInteractionHot(durationMs = INPUT_HOT_MS) {
      inputHotUntil = Math.max(inputHotUntil, now() + durationMs);
      setRootAttr(ROOT_HOT, '1');

      // Cancel optional background work, but never interrupt a detach already in-flight.
      if (hotReleaseTimer) clearTimeout(hotReleaseTimer);
      hotReleaseTimer = setTimeout(() => {
        hotReleaseTimer = 0;
        if (isInteractionHot()) {
          markInteractionHot(120);
          return;
        }
        setRootAttr(ROOT_HOT, '0');
        scheduleApply({ preserveAnchor: false, force: true });
        schedulePressureScan(450);
      }, durationMs + 40);
    }

    // ============================================================
    // Turn discovery
    // ============================================================

    function normalizeTurnCandidates(nodes) {
      const list = [];
      const seen = new Set();

      for (const el of nodes) {
        if (!(el instanceof HTMLElement)) continue;
        if (seen.has(el)) continue;

        // If a selected candidate sits inside another selected turn host,
        // keep only the outer host to avoid duplicate turns.
        let p = el.parentElement;
        let nested = false;
        while (p && p !== document.body) {
          if (seen.has(p)) {
            nested = true;
            break;
          }
          if (p.matches?.(TURN_HOST_SELECTOR)) {
            nested = true;
            break;
          }
          p = p.parentElement;
        }
        if (nested) continue;

        seen.add(el);
        list.push(el);
      }

      return list;
    }

    function getTurns() {
      try {
        const main = globalThis.__cgptUnifiedRuntimeV1?.dom?.main?.();
        if (!main) return [];
        const hosts = Array.from(main.querySelectorAll(TURN_HOST_SELECTOR));
        if (hosts.length) return normalizeTurnCandidates(hosts);

        const fallback = Array.from(main.querySelectorAll(`${TURN_FALLBACK_SELECTOR}, [data-turn-key]`));
        return normalizeTurnCandidates(fallback);
      } catch {
        return [];
      }
    }

    function getTotalTurns() {
      return hiddenStore.length + getTurns().length;
    }

    function pickFeedRoot() {
      const turns = getTurns();
      if (turns.length >= 2 && turns[0].parentElement && turns[0].parentElement === turns[1].parentElement) {
        return turns[0].parentElement;
      }
      return (
        document.querySelector('[role="feed"]') ||
        document.querySelector('main [role="feed"]') ||
        globalThis.__cgptUnifiedRuntimeV1?.dom?.main?.() ||
        document.body ||
        document.documentElement
      );
    }

    // ============================================================
    // Adaptive retention
    // ============================================================

    function baseRetainForTotal(total) {
      if (total <= 16) return total;
      if (total <= 32) return 20;
      if (total <= 64) return 16;
      if (total <= 120) return 12;
      return 10;
    }

    function pressureRetain(level) {
      if (level >= 3) return 8;
      if (level >= 2) return 12;
      if (level >= 1) return 18;
      return 9999;
    }

    function currentRetain(total = getTotalTurns()) {
      if (total <= 0) return 0;
      const byTurns = baseRetainForTotal(total);
      const byPressure = pressureRetain(pressureLevel);
      return clamp(Math.min(byTurns, byPressure), Math.min(total, MIN_RETAIN), total);
    }

    function desiredVisibleCount(total = getTotalTurns()) {
      const base = currentRetain(total);
      return Math.min(total, base + revealExtra);
    }

    // ============================================================
    // Styling
    // ============================================================

    function ensureStyle() {
      if (document.getElementById('lcpp-v2-style')) return;
      const s = document.createElement('style');
      s.id = 'lcpp-v2-style';
      s.textContent = `
        /* Measured outer turns only. Keep React nodes and real scroll extent. */
        [data-lcpp-render-auto] {
          content-visibility: auto !important;
          contain-intrinsic-size: auto none auto var(--lcpp-measured-height) !important;
        }
        html[data-cgpt-unified-navigation-active] [data-lcpp-render-auto],
        [data-lcpp-render-auto][data-cgpt-conversation-jump-target] {
          content-visibility: visible !important;
        }
        @media print {
          [data-lcpp-render-auto] { content-visibility: visible !important; }
        }
        html[${ROOT_FLAG}="1"] {
          --lcpp-turn-intrinsic: 640px;
        }

        /* Conservative turn containment for genuinely heavy pages. */
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="2"] main section[data-testid^="conversation-turn-"],
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="2"] main article[data-testid^="conversation-turn-"],
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="3"] main section[data-testid^="conversation-turn-"],
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="3"] main article[data-testid^="conversation-turn-"] {
          contain-intrinsic-size: auto var(--lcpp-turn-intrinsic);
        }

        /* Expensive code/table blocks: skip layout/paint when they are offscreen. */
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="2"] main pre,
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="2"] main table,
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="3"] main pre,
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="3"] main table {
        /* Keep real heights: nested estimated layout made old code/table replies blank. */
        content-visibility: visible;
        }

        /* Math is kept visible for reliability; only isolate its paint/style cost. */
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="2"] main .katex-display,
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="2"] main mjx-container,
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="3"] main .katex-display,
        html[${ROOT_FLAG}="1"][${ROOT_PRESSURE}="3"] main mjx-container {
          contain: paint style;
        }

        html[${ROOT_FLAG}="1"] main .katex-display > .katex {
          overflow-x: auto;
          overflow-y: hidden;
        }

        /* Keep site loading/thinking animations intact while typing. */
      `;
      document.head.appendChild(s);
    }

    // ============================================================
    // Scroll handling
    // ============================================================

    function findScrollableAncestor(node) {
      let el = node?.parentElement || null;
      while (el && el !== document.documentElement) {
        try {
          const cs = getComputedStyle(el);
          const oy = cs.overflowY;
          if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2) return el;
        } catch {}
        el = el.parentElement;
      }
      return null;
    }

    function resolveScrollContainer() {
      const turns = getTurns();
      const probe = turns.length ? turns[turns.length - 1] : document.body;
      const next = findScrollableAncestor(probe);

      if (next === scrollContainer) return;

      try {
        if (scrollAttachedTarget) scrollAttachedTarget.removeEventListener('scroll', onScroll);
      } catch {}
      try {
        window.removeEventListener('scroll', onScroll);
      } catch {}

      scrollContainer = next;
      const target = scrollContainer || window;
      target.addEventListener('scroll', onScroll, { passive: true });
      scrollAttachedTarget = target;
    }

    function getScrollTop() {
      return scrollContainer
        ? scrollContainer.scrollTop
        : (window.scrollY || document.documentElement.scrollTop || 0);
    }

    function setScrollTop(value) {
      const v = Math.max(0, value || 0);
      if (scrollContainer) scrollContainer.scrollTop = v;
      else window.scrollTo({ top: v, left: 0, behavior: 'auto' });
    }

    function getScrollHeight() {
      return scrollContainer
        ? scrollContainer.scrollHeight
        : (document.scrollingElement || document.documentElement || document.body).scrollHeight;
    }

    function getViewportHeight() {
      return scrollContainer ? scrollContainer.clientHeight : window.innerHeight;
    }

    function scrollToBottom() {
      setScrollTop(getScrollHeight());
    }

    function isNearBottom(threshold = BOTTOM_RECOLLAPSE_THRESHOLD) {
      const remaining = getScrollHeight() - (getScrollTop() + getViewportHeight());
      return remaining <= threshold;
    }

    function viewportTop() {
      return scrollContainer ? scrollContainer.getBoundingClientRect().top : 0;
    }

    function findAnchorElement() {
      const vt = viewportTop();
      for (const el of getTurns()) {
        try {
          const r = el.getBoundingClientRect();
          if (r.bottom > vt + 1 && r.height > 0) return el;
        } catch {}
      }
      return null;
    }

    function withAnchorCompensation(preserve, action) {
      if (!preserve) {
        action();
        return;
      }

      resolveScrollContainer();
      const anchor = findAnchorElement();
      const vt = viewportTop();
      let before = null;

      if (anchor) {
        try {
          before = anchor.getBoundingClientRect().top - vt;
        } catch {}
      }

      action();

      if (!anchor || !anchor.isConnected || before == null) return;

      try {
        const after = anchor.getBoundingClientRect().top - vt;
        const delta = after - before;
        if (Math.abs(delta) > 0.5) setScrollTop(getScrollTop() + delta);
      } catch {}
    }

    // ============================================================
    // Detach / restore
    // ============================================================

    function restoreSome(count) {
      if (!count || !hiddenStore.length) return 0;

      const start = Math.max(0, hiddenStore.length - count);
      const batch = hiddenStore.slice(start);
      hiddenStore.length = start;

      let restored = 0;
      for (const item of batch) {
        try {
          if (item.placeholder?.isConnected) {
            item.placeholder.replaceWith(item.node);
            restored += 1;
          }
        } catch {}
      }
      return restored;
    }

    function restoreAll() {
      return restoreSome(hiddenStore.length);
    }

    function getAllTurnNodes() {
      // Connected query results already have DOM order. Avoid sorting every time
      // the directory, token counter or exporter asks for the same intact feed.
      if (!hiddenStore.length) return getTurns();
      // Parked 节点本身已经脱离 DOM，但它的 placeholder 仍留在原位置。
      // 以 placeholder 作为排序锚点即可恢复“真实会话顺序”，而不是简单地
      // 把 parked + live 两组拼接。这样 DOM 回退导出和目录都不会乱序。
      const records = [
        ...hiddenStore.map((item, index) => ({
          node: item.node,
          anchor: item.placeholder,
          fallback: index,
        })),
        ...getTurns().map((node, index) => ({
          node,
          anchor: node,
          fallback: hiddenStore.length + index,
        })),
      ];
      const seen = new Set();
      const unique = records.filter(({ node }) =>
        node instanceof HTMLElement && !seen.has(node) && seen.add(node)
      );

      unique.sort((a, b) => {
        if (a.anchor === b.anchor) return a.fallback - b.fallback;
        if (a.anchor?.isConnected && b.anchor?.isConnected) {
          const relation = a.anchor.compareDocumentPosition(b.anchor);
          if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        }

        const getTurnNumber = (node) => {
          const match = /conversation-turn-(\d+)/i.exec(node?.getAttribute?.('data-testid') || '');
          return match ? Number.parseInt(match[1], 10) : null;
        };
        const an = getTurnNumber(a.node);
        const bn = getTurnNumber(b.node);
        if (an != null && bn != null && an !== bn) return an - bn;
        return a.fallback - b.fallback;
      });

      return unique.map(({ node }) => node);
    }

    function revealAllForNavigation() {
      if (!hiddenStore.length) return 0;
      const total = getTotalTurns();
      const base = currentRetain(total);
      revealExtra = Math.max(0, total - base);
      const restored = restoreAll();
      markInteractionHot(3200);
      resolveScrollContainer();
      publishDebugAttrs(total, total);
      requestAnimationFrame(() => {
        refreshObserverRoot();
        resolveScrollContainer();
      });
      return restored;
    }

    function exposeUnifiedBridge() {
      const runtime = globalThis.__cgptUnifiedRuntimeV1;
      if (!runtime) return;
      runtime.lazy = {
        getAllTurnNodes,
        revealAllForNavigation,
        getDebugState: () => ({
          totalTurns: getTotalTurns(),
          liveTurns: getTurns().length,
          parkedTurns: hiddenStore.length,
          optimizedTurns: [...renderTurns].filter((node) => !node.matches('pre, table')).length,
          optimizedBlocks: [...renderTurns].filter((node) => node.matches('pre, table')).length,
          optimizationMode: 'measured-render-window',
          pressureLevel,
          metrics: lastMetrics,
          pressureCache: { hits: pressureCacheHits, misses: pressureCacheMisses },
        }),
      };
    }

    function clearRenderTurn(node) {
      node.removeAttribute('data-lcpp-render-auto');
      node.style.removeProperty('--lcpp-measured-height');
      renderResizeObserver?.unobserve(node);
      renderTurns.delete(node);
    }

    function syncRenderWindow(turns, desired) {
      if (!window.CSS?.supports?.('content-visibility', 'auto')) return;
      const main = globalThis.__cgptUnifiedRuntimeV1?.dom?.main?.();
      if (main && main !== renderMutationRoot) {
        renderMutationObserver?.disconnect();
        renderMutationRoot = main;
        renderMutationObserver = new MutationObserver((records) => {
          let dirty = false;
          for (const record of records) {
            const target = record.target instanceof Element ? record.target : record.target.parentElement;
            if (record.type === 'childList' || record.type === 'attributes') {
              for (let parent = target; parent && parent !== main; parent = parent.parentElement) {
                pressureMetricsCache.delete(parent);
              }
            }
            const turn = target?.closest('[data-lcpp-render-auto]');
            if (turn && renderTurns.has(turn)) {
              // An edited/regenerated old reply must acquire its new real height.
              clearRenderTurn(turn);
              dirty = true;
            }
          }
          if (dirty) scheduleApply({ preserveAnchor: true });
        });
        renderMutationObserver.observe(main, { subtree: true, childList: true, characterData: true,
          attributes: true, attributeFilter: ['class', 'data-testid', 'data-turn-key'] });
      }
      if (!renderResizeObserver && typeof ResizeObserver === 'function') {
        renderResizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const node = entry.target;
            const height = entry.contentRect.height;
            if (renderTurns.has(node) && height > 0) {
              const before = parseFloat(node.style.getPropertyValue('--lcpp-measured-height'));
              if (!Number.isFinite(before) || Math.abs(before - height) > .5) {
                node.style.setProperty('--lcpp-measured-height', `${height}px`);
              }
            }
          }
        });
      }
      const cutoff = Math.max(0, turns.length - desired);
      const candidates = new Set(turns.slice(0, cutoff).filter((node) =>
        // New UI owns its virtual list and paired data-turn-key nodes. Do not
        // apply a second render window to that layout, or to focused content.
        !node.matches('[data-turn-key]') && !node.querySelector('[data-turn-key]')
        && !node.contains(document.activeElement)));
      if (pressureLevel >= 2 && main) {
        for (const block of main.querySelectorAll('pre, table')) {
          if (block.closest('[data-turn-key]') || block.contains(document.activeElement)) continue;
          // Keep the original heavy-block feature without nested render windows.
          let nested = false;
          for (let parent = block.parentElement; parent && parent !== main; parent = parent.parentElement) {
            if (candidates.has(parent)) { nested = true; break; }
          }
          if (!nested) candidates.add(block);
        }
      }
      for (const node of renderTurns) {
        if (!node.isConnected || !candidates.has(node)) clearRenderTurn(node);
      }
      for (const node of candidates) {
        if (renderTurns.has(node)) continue;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const numeric = (key) => parseFloat(style[key]) || 0;
        // Layout containment stops margin collapsing. A plain borderless block
        // with uncontained child margins cannot preserve its old geometry.
        const isolated = /^(?:inline-block|(?:inline-)?flex|(?:inline-)?grid|flow-root)$/.test(style.display)
          || /^(?:auto|scroll|hidden)$/.test(style.overflowY)
          || node.matches('table')
          || (node.matches('pre') && (!node.firstElementChild || node.firstElementChild.matches('code')))
          || (numeric('paddingTop') + numeric('borderTopWidth') > 0
            && numeric('paddingBottom') + numeric('borderBottomWidth') > 0);
        if (!isolated) continue;
        const height = rect.height - numeric('paddingTop') - numeric('paddingBottom')
          - numeric('borderTopWidth') - numeric('borderBottomWidth');
        if (!(height > 0)) continue;
        node.style.setProperty('--lcpp-measured-height', `${height}px`);
        node.setAttribute('data-lcpp-render-auto', '');
        renderTurns.add(node);
        renderResizeObserver?.observe(node);
      }
    }

    // ============================================================
    // Apply scheduler
    // ============================================================

    function mergePending(opts = {}) {
      if (!pendingApply) pendingApply = { preserveAnchor: false, force: false };
      pendingApply.preserveAnchor ||= !!opts.preserveAnchor;
      pendingApply.force ||= !!opts.force;
    }

    function scheduleApply(opts = {}) {
      mergePending(opts);

      if (isStreaming || isInteractionHot()) return;
      if (applyIdleHandle || applyTimeoutHandle) return;

      const run = () => {
        applyIdleHandle = 0;
        applyTimeoutHandle = 0;

        if (isStreaming || isInteractionHot()) return;

        const payload = pendingApply || {};
        pendingApply = null;
        apply(payload);
      };

      if ('requestIdleCallback' in window) {
        try {
          applyIdleHandle = requestIdleCallback(run, { timeout: 180 });
        } catch {
          applyTimeoutHandle = setTimeout(run, 60);
        }
      } else {
        applyTimeoutHandle = setTimeout(run, 60);
      }
    }

    function apply({ preserveAnchor = false, force = false } = {}) {
      if (isStreaming || isInteractionHot()) return;

      resolveScrollContainer();

      const turns = getTurns();
      const total = turns.length + hiddenStore.length;
      if (!total) {
        for (const node of renderTurns) clearRenderTurn(node);
        pressureLevel = 0;
        lastMetrics = null;
        pressureMetricsCache = new WeakMap();
        publishDebugAttrs(0, 0, 0);
        return;
      }

      const desired = desiredVisibleCount(total);
      const currentConnected = turns.length;
      const currentHidden = hiddenStore.length;
      const targetHidden = Math.max(0, total - desired);

      // Need more old turns visible.
      if (currentHidden > targetHidden) {
        const needRestore = currentHidden - targetHidden;
        withAnchorCompensation(preserveAnchor, () => restoreSome(needRestore));
      }

      // React owns these nodes. Removing them breaks reconciliation when a new
      // prompt is submitted, and comment placeholders collapse the scroll extent.
      // Preserve the adaptive window through measured browser rendering instead.
      const liveTurns = currentHidden > targetHidden ? getTurns() : turns;
      syncRenderWindow(liveTurns, desired);
      publishDebugAttrs(total, liveTurns.length, liveTurns.length);

      if (force) {
        // Re-resolve because ChatGPT may replace its scroll/feed container after large changes.
        requestAnimationFrame(resolveScrollContainer);
      }
    }

    // ============================================================
    // Infinite upward reveal + auto recollapse
    // ============================================================

    function revealMoreUp() {
      if (isStreaming || isInteractionHot()) return;

      const total = getTotalTurns();
      const base = currentRetain(total);
      const maxExtra = Math.max(0, total - base);
      if (revealExtra >= maxExtra) return;

      revealExtra = Math.min(maxExtra, revealExtra + REVEAL_BATCH);
      scheduleApply({ preserveAnchor: true, force: true });
    }

    function cancelRecollapse() {
      if (recollapseTimer) clearTimeout(recollapseTimer);
      recollapseTimer = 0;
    }

    function scheduleRecollapse() {
      if (revealExtra <= 0) return;
      cancelRecollapse();

      recollapseTimer = setTimeout(() => {
        recollapseTimer = 0;
        if (isStreaming || isInteractionHot() || !isNearBottom()) return;
        revealExtra = 0;
        scheduleApply({ preserveAnchor: false, force: true });
      }, RECOLLAPSE_DELAY_MS);
    }

    let scrollDebounceTimer = 0;
    function onScroll() {
      if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer);
      scrollDebounceTimer = setTimeout(() => {
        scrollDebounceTimer = 0;

        if (isStreaming || isInteractionHot()) return;

        if (getScrollTop() <= TOP_REVEAL_THRESHOLD) {
          cancelRecollapse();
          revealMoreUp();
          return;
        }

        if (revealExtra > 0 && isNearBottom()) scheduleRecollapse();
        else cancelRecollapse();
      }, 85);
    }

    // ============================================================
    // Streaming HARD PAUSE
    // ============================================================

    function recomputeStreamingState() {
      const next = hasStopButton();

      if (next) {
        if (!isStreaming) {
          isStreaming = true;
          setRootAttr(ROOT_STREAMING, '1');
        }
        if (streamEndTimer) clearTimeout(streamEndTimer);
        streamEndTimer = 0;
        return;
      }

      if (!isStreaming || streamEndTimer) return;

      streamEndTimer = setTimeout(() => {
        streamEndTimer = 0;
        isStreaming = false;
        setRootAttr(ROOT_STREAMING, '0');

        // Generation finished: if the user is at the bottom, immediately return
        // to the lean adaptive window.
        if (isNearBottom()) revealExtra = 0;
        scheduleApply({ preserveAnchor: false, force: true });
        schedulePressureScan(500);
      }, STREAM_END_COOLDOWN_MS);
    }

    // ============================================================
    // Pressure sensing
    // ============================================================

    function pruneLongTasks() {
      const cutoff = now() - LONG_TASK_WINDOW_MS;
      longTasks = longTasks.filter((x) => x.at >= cutoff);
      let max = 0;
      let total = 0;
      for (const x of longTasks) {
        max = Math.max(max, x.duration);
        total += x.duration;
      }
      return { count: longTasks.length, max, total };
    }

    function countElementNodesCapped(roots, cap = NODE_COUNT_CAP) {
      let count = 0;
      let capped = false;

      try {
        for (const root of roots) {
          if (!(root instanceof HTMLElement)) continue;
          count += 1;
          if (count >= cap) return { count, capped: true };

          const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
          while (walker.nextNode()) {
            count += 1;
            if (count >= cap) {
              capped = true;
              break;
            }
          }
          if (capped) break;
        }
      } catch {}

      return { count, capped };
    }

    function countSelectorCapped(roots, selector, cap) {
      let count = 0;
      const seen = new Set();

      try {
        for (const root of roots) {
          if (!(root instanceof HTMLElement)) continue;

          if (root.matches?.(selector) && !seen.has(root)) {
            seen.add(root);
            count += 1;
            if (count >= cap) return count;
          }

          const nodes = root.querySelectorAll(selector);
          for (const el of nodes) {
            if (seen.has(el)) continue;
            seen.add(el);
            count += 1;
            if (count >= cap) return count;
          }
        }
      } catch {}

      return count;
    }

    function classifyPressure(metrics) {
      let level = 0;

      if (
        metrics.totalTurns >= 90 ||
        metrics.nodeCount >= 12000 ||
        metrics.mathCount >= 160 ||
        metrics.longTaskMax >= 180
      ) {
        level = 3;
      } else if (
        metrics.totalTurns >= 45 ||
        metrics.nodeCount >= 7500 ||
        metrics.mathCount >= 80 ||
        metrics.codeCount >= 28 ||
        metrics.longTaskMax >= 100 ||
        metrics.longTaskCount >= 3
      ) {
        level = 2;
      } else if (
        metrics.totalTurns >= 20 ||
        metrics.nodeCount >= 3500 ||
        metrics.mathCount >= 30 ||
        metrics.codeCount >= 12 ||
        metrics.longTaskMax >= 50 ||
        metrics.longTaskCount >= 1
      ) {
        level = 1;
      }

      return level;
    }

    function publishDebugAttrs(total = getTotalTurns(), desired = desiredVisibleCount(total), live = getTurns().length) {
      setRootAttr(ROOT_FLAG, '1');
      setRootAttr(ROOT_PRESSURE, String(pressureLevel));
      setRootAttr(ROOT_HOT, isInteractionHot() ? '1' : '0');
      setRootAttr(ROOT_STREAMING, isStreaming ? '1' : '0');

      // Tiny diagnostic attributes only. No visible UI.
      setRootAttr('data-lcpp-total-turns', total);
      setRootAttr('data-lcpp-live-turns', live);
      setRootAttr('data-lcpp-parked-turns', hiddenStore.length);
      setRootAttr('data-lcpp-target-turns', desired);
      setRootAttr('data-lcpp-version', VERSION);
    }

    function getCachedPressureCount(root, kind, budget) {
      if (budget <= 0) return 0;
      let cached = pressureMetricsCache.get(root);
      if (!cached) { cached = {}; pressureMetricsCache.set(root, cached); }
      const entry = cached[kind];
      if (entry && (entry.exact || entry.cap >= budget)) {
        pressureCacheHits++;
        return Math.min(budget, entry.count);
      }
      pressureCacheMisses++;
      if (kind === 'nodes') {
        const result = countElementNodesCapped([root], budget);
        cached[kind] = { count: result.count, cap: budget, exact: !result.capped };
      } else {
        const count = countSelectorCapped([root], kind === 'math' ? MATH_SELECTOR : CODE_SELECTOR, budget);
        cached[kind] = { count, cap: budget, exact: count < budget };
      }
      return cached[kind].count;
    }

    function scanPressureNow() {
      if (document.hidden || isStreaming || isInteractionHot()) {
        schedulePressureScan(1400);
        return;
      }

      const roots = getTurns();
      const totalTurns = roots.length + hiddenStore.length;
      if (!totalTurns) {
        pressureLevel = 0;
        lastMetrics = null;
        publishDebugAttrs(0, 0, 0);
        schedulePressureScan(PRESSURE_SCAN_MS);
        return;
      }

      // Only scan currently connected turns. Parked/detached turns no longer
      // participate in layout/paint and should not inflate the live pressure score.
      let nodeCount = 0, mathCount = 0, codeCount = 0;
      for (const root of roots) {
        nodeCount += getCachedPressureCount(root, 'nodes', NODE_COUNT_CAP - nodeCount);
        mathCount += getCachedPressureCount(root, 'math', MATH_COUNT_CAP - mathCount);
        codeCount += getCachedPressureCount(root, 'code', CODE_COUNT_CAP - codeCount);
        if (nodeCount >= NODE_COUNT_CAP && mathCount >= MATH_COUNT_CAP && codeCount >= CODE_COUNT_CAP) break;
      }
      const lt = pruneLongTasks();

      const metrics = {
        at: now(),
        totalTurns,
        liveTurns: roots.length,
        parkedTurns: hiddenStore.length,
        nodeCount,
        nodeCountCapped: nodeCount >= NODE_COUNT_CAP,
        mathCount,
        codeCount,
        longTaskCount: lt.count,
        longTaskMax: Math.round(lt.max),
        longTaskTotal: Math.round(lt.total)
      };

      const nextPressure = classifyPressure(metrics);
      const changed = nextPressure !== pressureLevel;
      pressureLevel = nextPressure;
      lastMetrics = metrics;

      publishDebugAttrs(totalTurns, desiredVisibleCount(totalTurns), roots.length);

      // Only collapse harder automatically when at/near the bottom.
      // If the user is reading history, preserve the expanded window.
      if (changed && isNearBottom()) {
        revealExtra = 0;
        scheduleApply({ preserveAnchor: false, force: true });
      }

      schedulePressureScan(PRESSURE_SCAN_MS);
    }

    function schedulePressureScan(delay = PRESSURE_SCAN_MS) {
      if (pressureTimer) clearTimeout(pressureTimer);

      pressureTimer = setTimeout(() => {
        pressureTimer = 0;

        const run = () => scanPressureNow();
        if ('requestIdleCallback' in window && !isStreaming && !isInteractionHot()) {
          try {
            requestIdleCallback(run, { timeout: 900 });
          } catch {
            setTimeout(run, 0);
          }
        } else {
          setTimeout(run, 0);
        }
      }, Math.max(120, delay));
    }

    function startLongTaskObserver() {
      if (
        typeof PerformanceObserver !== 'function' ||
        !Array.isArray(PerformanceObserver.supportedEntryTypes) ||
        !PerformanceObserver.supportedEntryTypes.includes('longtask')
      ) return;

      try {
        longTaskObserver = new PerformanceObserver((list) => {
          const t = now();
          for (const entry of list.getEntries()) {
            const duration = Number(entry.duration || 0);
            if (duration >= 35) longTasks.push({ at: t, duration });
          }
          pruneLongTasks();

          // Don't scan immediately while the user is typing; just remember the signal.
          if (!isStreaming && !isInteractionHot()) schedulePressureScan(700);
        });
        longTaskObserver.observe({ type: 'longtask', buffered: false });
      } catch {
        longTaskObserver = null;
      }
    }

    // ============================================================
    // DOM observer
    // ============================================================

    let obsDebounceTimer = 0;

    function attachObserver(root) {
      try {
        observer?.disconnect();
      } catch {}
      observer = null;

      if (!(root instanceof Node)) root = document.documentElement;

      try {
        observer = new MutationObserver(() => {
          if (isStreaming || isInteractionHot()) return;

          if (obsDebounceTimer) clearTimeout(obsDebounceTimer);
          obsDebounceTimer = setTimeout(() => {
            obsDebounceTimer = 0;
            scheduleApply({ preserveAnchor: false, force: false });
          }, OBS_DEBOUNCE_MS);
        });

        // Child-list changes only. No characterData / attributes.
        // When possible, use the feed/list root so token-by-token streaming mutations
        // inside the last message do not trigger us.
        observer.observe(root, { childList: true, subtree: root === document.documentElement });
        observerRoot = root;
      } catch {
        observer = null;
        observerRoot = null;
      }
    }

    function refreshObserverRoot() {
      const root = pickFeedRoot();
      if (root && root !== observerRoot) {
        attachObserver(root);
        scheduleApply({ preserveAnchor: true, force: true });
      }
    }

    // ============================================================
    // Input/action hot-path listeners
    // ============================================================

    function installInteractionListeners() {
      window.addEventListener('pointerdown', (e) => {
        if (isComposerTarget(e.target)) {
          markInteractionHot(INPUT_HOT_MS);
          return;
        }
        if (isHeavyActionTarget(e.target)) markInteractionHot(ACTION_HOT_MS);
      }, true);

      document.addEventListener('input', (e) => {
        if (isComposerTarget(e.target)) markInteractionHot(INPUT_HOT_MS);
      }, true);

      document.addEventListener('keydown', (e) => {
        if (!isComposerTarget(e.target) && !isComposerTarget(document.activeElement)) return;
        markInteractionHot(e.key === 'Enter' ? ACTION_HOT_MS : INPUT_HOT_MS);
      }, true);

      document.addEventListener('focusin', (e) => {
        if (isComposerTarget(e.target)) markInteractionHot(700);
      }, true);

      document.addEventListener('focusout', (e) => {
        if (!isComposerTarget(e.target)) return;
        inputHotUntil = Math.min(inputHotUntil, now() + 180);
      }, true);
    }

    // ============================================================
    // SPA route handling
    // ============================================================

    function resetForRouteChange() {
      // The old page is being replaced by ChatGPT. Drop references to detached
      // nodes from the old route so the browser is free to collect them.
      hiddenStore.length = 0;
      pressureMetricsCache = new WeakMap();
      pressureCacheHits = 0;
      pressureCacheMisses = 0;
      for (const node of renderTurns) clearRenderTurn(node);
      renderResizeObserver?.disconnect();
      renderResizeObserver = null;
      renderMutationObserver?.disconnect();
      renderMutationObserver = null;
      renderMutationRoot = null;
      revealExtra = 0;
      pressureLevel = 0;
      lastMetrics = null;
      cancelRecollapse();

      try {
        observer?.disconnect();
      } catch {}
      observer = null;
      observerRoot = null;

      setTimeout(() => {
        refreshObserverRoot();
        resolveScrollContainer();
        scheduleApply({ preserveAnchor: false, force: true });
        schedulePressureScan(900);
      }, 320);
    }

    function startRouteWatch() {
      routeTimer = setInterval(() => {
        const next = location.href;
        if (next !== routeKey) {
          routeKey = next;
          resetForRouteChange();
          return;
        }

        // ChatGPT sometimes replaces the feed without changing the URL.
        refreshObserverRoot();
      }, ROUTE_POLL_MS);
    }

    // Preserve the original sidebar full-navigation behavior across UI versions.
    const SIDEBAR_SCOPE_SEL = 'nav[aria-label="Chat history"], #history, [class*="sidebar-width"]';

    function isInsideSidebar(node) {
      return !!(node && node.closest?.(SIDEBAR_SCOPE_SEL));
    }

    function isInternalHref(href) {
      if (!href || /^(mailto:|javascript:|data:)/i.test(href) || href.startsWith('#')) return false;
      if (href.startsWith('/')) return true;
      try {
        return new URL(href, location.origin).origin === location.origin;
      } catch {
        return false;
      }
    }

    function isInteractiveBeforeAnchor(target, anchor) {
      let el = target;
      while (el && el !== anchor) {
        try {
          if (el.matches('button, [role="button"], summary, input, select, textarea, label, [aria-expanded], [aria-haspopup], [data-trailing-button], [data-testid*="toggle"], [data-testid*="menu"]')) {
            return true;
          }
        } catch {}
        el = el.parentElement;
      }
      return false;
    }

    document.addEventListener('click', (ev) => {
      if (ev.defaultPrevented) return;
      if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;

      const target = ev.target;
      const link = target?.closest?.('a[href]');
      if (!link) return;
      if (!isInsideSidebar(target)) return;
      if (isInteractiveBeforeAnchor(target, link)) return;

      const href = link.getAttribute('href');
      if (!isInternalHref(href) || link.target === '_blank') return;

      ev.preventDefault();
      location.assign(href);
    }, true);

    // ============================================================
    // Boot
    // ============================================================

    function boot() {
      exposeUnifiedBridge();
      ensureStyle();
      setRootAttr(ROOT_FLAG, '1');
      setRootAttr(ROOT_PRESSURE, '0');
      setRootAttr(ROOT_HOT, '0');
      setRootAttr(ROOT_STREAMING, '0');

      installInteractionListeners();
      startLongTaskObserver();

      refreshObserverRoot();
      resolveScrollContainer();

      // First pass uses turn count immediately, without an expensive full scan.
      scheduleApply({ preserveAnchor: false, force: true });
      schedulePressureScan(1000);

      setInterval(recomputeStreamingState, STREAM_POLL_MS);
      startRouteWatch();

      // Hydration safety: locate the real feed as soon as it appears.
      let tries = 50;
      const hydrationPoll = setInterval(() => {
        refreshObserverRoot();
        resolveScrollContainer();

        if (!isStreaming && !isInteractionHot()) {
          scheduleApply({ preserveAnchor: false, force: false });
        }

        // Current ChatGPT uses data-turn-key without legacy turn hosts. Once
        // that layout is visible, further legacy hydration probes cannot help.
        if (getTurns().length > 0 || document.querySelector('main [data-turn-key]') || --tries <= 0) {
          clearInterval(hydrationPoll);
        }
      }, 260);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      boot();
    } else {
      window.addEventListener('DOMContentLoaded', boot, { once: true });
    }
  }
})();


/* ===== Module 3: typography, renderer fixes, and cooperative scroll lock ===== */

(function () {
  'use strict';

  const dom = globalThis.__cgptUnifiedRuntimeV1.dom;
  const chatContentSelector = `main :is(${dom.message}, ${dom.content})`;
  const proseTextSelector = `${chatContentSelector} :where(p, li, ul, ol, td, th, blockquote, details, summary, dt, dd):not(:where(.katex *, .MathJax *, mjx-container *, math *, pre *, code *, button *))`;
  // Intelligent UI text owns its font metrics rather than inheriting Markdown's.
  // Controls share the chosen typography; graphics, math and code keep their
  // own rendering metrics. Preserve control colors for contrast and state.
  const dilTextExclusions = ':not(:where(pre, pre *, code, code *, .katex, .katex *, .MathJax, .MathJax *, mjx-container, mjx-container *, math, math *, svg, svg *))';
  const dilTextSelector = `${chatContentSelector} :is([data-d-component="text"], [data-d-component="title"])${dilTextExclusions}`;
  const dilBodyTextSelector = `${chatContentSelector} [data-d-component="text"]${dilTextExclusions}`;
  const dilControlTextSelector = `${chatContentSelector} :is([data-d-component="caption"], [data-d-component="badge"], [data-d-component="button"], [data-d-component="popover-trigger"], [data-d-component="pressable"], [data-d-component="slider"])${dilTextExclusions}`;
  // Interactive cards may be siblings of Markdown, and their labels can own
  // native font declarations without a data-d-component attribute themselves.
  const dilSurfaceSelector = `main :is(${dom.turn}, ${dom.assistant}) :is([data-d-component], [role="radiogroup"], [role="radio"], [role="checkbox"], [role="tablist"], [role="tab"], [role="listbox"], [role="option"])`;
  const dilTypographyExclusions = `${dilTextExclusions}:not(:where(input, textarea, [contenteditable="true"], [contenteditable="true"] *, [data-cgpt-token-chip], [data-cgpt-token-chip] *))`;
  const dilAllTextSelector = `:is(${dilSurfaceSelector}:is([data-d-component="text"], [data-d-component="title"], [data-d-component="caption"], [data-d-component="badge"], [data-d-component="button"], [data-d-component="popover-trigger"], [data-d-component="pressable"], [role="radio"], [role="checkbox"], [role="tab"], [role="option"]), ${dilSurfaceSelector} :is(span, label, button, p, a, h1, h2, h3, h4, h5, h6, summary, small, strong, b, div:not(:has(*))))${dilTypographyExclusions}`;
  const dilChoiceSelector = `${dilSurfaceSelector}:is([data-d-component="caption"], [data-d-component="badge"], [data-d-component="button"], [data-d-component="popover-trigger"], [data-d-component="pressable"], [data-d-component="slider"], [data-d-component="radio"], [data-d-component="radio-group"], [data-d-component="checkbox"], [data-d-component="select"], [data-d-component="option"], [role="radiogroup"], [role="radio"], [role="checkbox"], [role="tablist"], [role="tab"], [role="listbox"], [role="option"])`;
  const dilAllControlTextSelector = `:is(${dilChoiceSelector}, ${dilChoiceSelector} :is(span, label, button, p, a, small, strong, b), ${dilSurfaceSelector} :is(label, button))${dilTypographyExclusions}`;
  const dilAllTitleTextSelector = `:is(${dilSurfaceSelector}:is([data-d-component="title"]), ${dilSurfaceSelector}:is([data-d-component="title"]) :is(span, strong, b), ${dilSurfaceSelector} :is(h1, h2, h3, h4, h5, h6))${dilTypographyExclusions}`;
  const citationHostSelector = [
    '[data-citation]', '[data-citation-id]', '[data-citation-type]',
    '[data-testid*="citation" i]', '[data-d-component="citation"]',
    '[data-d-component="file-citation"]', '.citation-pill', '.file-citation',
  ].join(',');
  // Current Intelligent UI source pills have no citation attribute. Match the
  // inline popover + pill + favicon structure, not arbitrary card popovers.
  const webCitationHostSelector = [
    '[data-d-component="popover-trigger"][data-d-inline-text]:has([data-d-component="badge"][data-pill] [data-d-component="favicon"])',
    '.inline-citation', '[data-testid="web-citation"]',
    '[data-citation-type="web"]', '[data-citation-type="url"]',
  ].join(',');
  const citationCandidateSelector = `${citationHostSelector}, ${webCitationHostSelector}, button, [role="button"], [role="link"], a, span[data-state], span[class*="cursor-pointer"]`;
  const citationExcludedSelector = `${dom.user}, pre, code, svg, math, .katex, .MathJax, mjx-container, [role="dialog"], form, [contenteditable="true"]`;
  const dilProseColorSelector = `${dilTextSelector}:not(:where(button, button *, [role="button"], [role="button"] *, [data-d-component="badge"] *, [data-d-component="button"] *, [data-d-component="pressable"] *, [data-d-component="slider"] *))`;
  const boldTextSelector = `${chatContentSelector} :is(strong, b, [data-d-component="text"][data-d-default-strong], [data-d-component="text"][data-d-weight="bold"], [data-d-component="text"][data-d-weight="semibold"])${dilTextExclusions}`;
  const STYLE_ID = 'cgfc-ophel-optimized-style';
  const TOGGLE_ID = 'cgfc-toggle';
  const PANEL_ID = 'cgfc-panel';
  const FONT_STATUS_ID = 'cgfc-font-scan-status';
  const CHATGPT_DISCLAIMER_KEYS = new Set([
    'ChatGPT 也可能会犯错。请核查重要信息。',
    'ChatGPT 可能会出错。工作空间数据不会用于训练模型。',
    'ChatGPT 可能会出错。请核查重要信息。',
  ].map((text) => text.replace(/\s+/g, '')));
  const CHATGPT_DISCLAIMER_SELECTOR = '[data-markdown-copy="exclude"]';
  const HIDDEN_DISCLAIMER_CLASS = 'ophel-chatgpt-disclaimer-hidden';
  const KATEX_STYLE_ID = 'cgfc-katex-resource-style';
  const RESIDUAL_WRAPPER_CLASS = 'cgfc-residual-latex';
  const RESIDUAL_ROOT_MARKER = 'data-cgfc-residual-root';
  // A full answer scan is expensive; wait for a short pause in streaming DOM updates.
  const RESIDUAL_DEBOUNCE_MS = 500;
  const RESIDUAL_MAX_TEXT_NODES = 300;
  const STORAGE_KEY = 'chatgpt_font_customizer_settings_v2';
  const THEME_PALETTE_MIGRATION_KEY = 'cgpt_unified_theme_palette_migration_v1';
  const USER_SCROLL_GRACE_MS = 700;
  const SCROLL_EPSILON_PX = 8;
  const GENERATION_CHECK_MS = 1000;
  const API_GUARD_MS = 2000;
  const FONT_BRIDGE_SOURCE = 'cgfc-font-bridge-v1';
  const FONT_BRIDGE_REQUEST = 'getFontList';
  const FONT_BRIDGE_TIMEOUT_MS = 2500;
  const FONT_FACE_VERIFY_TIMEOUT_MS = 900;
  const FONT_FACE_VERIFY_CONCURRENCY = 14;

  const defaults = {
    latinFont: '"Times New Roman", "Noto Serif"',
    chineseFont: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif',
    boldLatinFont: '"Times New Roman", "Noto Serif"',
    boldChineseFont: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif',
    mathFont: '"Cambria Math", "STIX Two Math", "Latin Modern Math", serif',
    mathFontMode: 'native',
    codeFont: '"JetBrains Mono"',
    fontSize: 26,
    thinkingOverviewFontSize: 18,
    citationFontSize: 18,
    webCitationFontSize: 14,
    intelligentFont: '"Times New Roman", "Noto Serif SC", "Source Han Serif SC", serif',
    intelligentFontSize: 26,
    intelligentTitleFontSize: 30,
    intelligentControlFontSize: 26,
    intelligentLineHeight: 1.6,
    formulaFontSize: 26,
    lineHeight: 1.9,
    codeFontSize: 18,
    codeLineHeight: 1.8,
    normalColor: '#ffffff',
    boldColor: '#e8e2d8',
    boldWeight: 750,
    stopAutoScrollWhileGenerating: true,
    wrapCode: true,
    enableFontSmoothing: true,
    fontSmoothingMode: 'antialiased',
    textRenderingMode: 'optimizeLegibility',
    enableResidualLatex: true,
    enableKatexLetterFont: true,
    enableFormulaCopy: true,
    formulaCopyDelimiters: true,
    formulaCopyBorderColor: '#6d5dfc',
    messageCopyIconColor: '#6d5dfc',
    toolboxFont: '"Segoe UI", "Microsoft YaHei", sans-serif',
    toolboxFontSize: 13,
    toolboxLineHeight: 1.4,
    toolboxPanelWidth: 300,
    bodyColumnLeftOffset: 0,
    bodyColumnRightOffset: 0,
    toolboxUseCustomColors: false,
    toolboxTextColor: '#f4f4f4',
    toolboxBackgroundColor: '#212121',
    toolboxAccentColor: '#6d5dfc',
    toolboxOpacity: 0.82,
    queueFont: '"Segoe UI", "Microsoft YaHei", sans-serif',
    queueFontSize: 12,
    queueLineHeight: 1.4,
    queuePanelWidth: 420,
    queueUseCustomColors: false,
    queueTextColor: '#f4f4f4',
    queueBackgroundColor: '#212121',
    queueAccentColor: '#6d5dfc',
    queueOpacity: 0.94,
    enableNeumorphicAppearance: true,
    enableAsciiOcean: true,
    asciiOceanOpacity: 0.65,
    asciiOceanFps: 12,
    asciiOceanSpecies: 'classic',
    asciiOceanCoverage: 'gutter',
    asciiOceanHomeCoverage: 'full',
    asciiOceanPointer: false,
    asciiOceanDensity: 90,
    asciiOceanQuality: 'balanced',
    asciiOceanRenderer: 'canvas',
    asciiOceanMotionMode: 'live',
    asciiOceanColorMode: 'auto',
    asciiOceanColorSeed: 0,
    asciiOceanBodyColor: '#7ed8f0',
    asciiOceanAccentColor: '#c79aff',
    asciiOceanFishColor: '#b8e7f7',
    asciiOceanWakeColor: '#55d8ea',
    asciiOceanPauseWhileGenerating: true,
    messageGlassStyle: 'soft',
    messageGlassRenderMode: 'balanced',
    messageGlassOpacity: 0.18,
    messageGlassBlur: 6,
    messageGlassStrength: 28,
    messageGlassThickness: 14,
    messageGlassCurvature: 0.5,
    messageGlassBend: 0.5,
    messageGlassChroma: 0.04,
    messageGlassGlare: 0.45,
    messageGlassRadius: 18,
    messageGlassSaturation: 1.12,
    messageGlassBrightness: 1,
    messageGlassTintMode: 'auto',
    messageGlassTint: '#15191f',
    enableComposerLiquidGlass: true,
    enableToolboxLiquidGlass: true,
    enableSettingsLiquidGlass: true,
    enableQueueLiquidGlass: true,
    enableSendLiquidGlass: true,
    enableScrollLiquidGlass: true,
    enableTokenLiquidGlass: true,
    enableToggleLiquidGlass: true,
    glassRenderMode: 'balanced',
    composerGlassStyle: 'clear',
    composerGlassStrength: 36,
    composerGlassBlur: 6,
    composerGlassOpacity: 0.12,
    composerGlassThickness: 14,
    composerGlassGlare: 0.45,
    composerGlassChroma: 0.04,
    composerGlassCurvature: 0.5,
    composerGlassBend: 0.5,
    showTokenStats: true,
    showTokenMessageChips: true,
    showTokenSummary: true,
    tokenSummaryPosition: 'auto',
    tokenSummaryOffsetX: 0,
    tokenSummaryOffsetY: 0,
    tokenSummaryCompactAlways: false,
    tokenSummaryCompactOnNarrow: true,
    tokenSummaryAvoidQueue: true,
    tokenSummaryTextColor: '#f4f4f4',
    tokenSummaryBackgroundColor: '#212121',
    tokenSummaryBorderColor: '#3f3f46',
  };

  // Appearance values are stored independently from whether the script is
  // currently allowed to override them. Turning an override off deliberately
  // removes the corresponding CSS declaration instead of substituting another
  // script default.
  const OVERRIDEABLE_SETTING_KEYS = new Set([
    'latinFont', 'chineseFont', 'boldLatinFont', 'boldChineseFont',
    'mathFont', 'mathFontMode', 'codeFont',
    'fontSize', 'thinkingOverviewFontSize', 'citationFontSize', 'webCitationFontSize', 'formulaFontSize', 'lineHeight', 'codeFontSize', 'codeLineHeight',
    'intelligentFont', 'intelligentFontSize', 'intelligentTitleFontSize', 'intelligentControlFontSize', 'intelligentLineHeight',
    'normalColor', 'boldColor', 'boldWeight',
    'fontSmoothingMode', 'textRenderingMode', 'formulaCopyBorderColor', 'messageCopyIconColor',
    'toolboxFont', 'toolboxFontSize', 'toolboxLineHeight', 'toolboxPanelWidth',
    'bodyColumnLeftOffset', 'bodyColumnRightOffset',
    'toolboxTextColor', 'toolboxBackgroundColor', 'toolboxAccentColor', 'toolboxOpacity',
    'queueFont', 'queueFontSize', 'queueLineHeight', 'queuePanelWidth',
    'queueTextColor', 'queueBackgroundColor', 'queueAccentColor', 'queueOpacity',
    'tokenSummaryTextColor', 'tokenSummaryBackgroundColor', 'tokenSummaryBorderColor',
  ]);
  const DEFAULT_DISABLED_OVERRIDE_KEYS = new Set([
    'intelligentFont', 'intelligentFontSize', 'intelligentTitleFontSize', 'intelligentControlFontSize', 'intelligentLineHeight',
    'normalColor', 'boldColor', 'formulaFontSize', 'messageCopyIconColor',
    'toolboxTextColor', 'toolboxBackgroundColor', 'toolboxAccentColor', 'toolboxOpacity',
    'queueTextColor', 'queueBackgroundColor', 'queueAccentColor', 'queueOpacity',
    'tokenSummaryTextColor', 'tokenSummaryBackgroundColor', 'tokenSummaryBorderColor',
  ]);
  const overrideEnabledKey = (key) => `${key}Enabled`;
  for (const key of OVERRIDEABLE_SETTING_KEYS) {
    defaults[overrideEnabledKey(key)] = !DEFAULT_DISABLED_OVERRIDE_KEYS.has(key);
  }

  const settingTypes = {
    latinFont: 'text',
    chineseFont: 'text',
    boldLatinFont: 'text',
    boldChineseFont: 'text',
    mathFont: 'text',
    mathFontMode: 'select',
    codeFont: 'text',
    fontSize: 'number',
    thinkingOverviewFontSize: 'number',
    citationFontSize: 'number',
    webCitationFontSize: 'number',
    intelligentFont: 'text',
    intelligentFontSize: 'number',
    intelligentTitleFontSize: 'number',
    intelligentControlFontSize: 'number',
    intelligentLineHeight: 'number',
    formulaFontSize: 'number',
    lineHeight: 'number',
    codeFontSize: 'number',
    codeLineHeight: 'number',
    normalColor: 'color',
    boldColor: 'color',
    boldWeight: 'number',
    stopAutoScrollWhileGenerating: 'boolean',
    wrapCode: 'boolean',
    enableFontSmoothing: 'boolean',
    fontSmoothingMode: 'select',
    textRenderingMode: 'select',
    enableResidualLatex: 'boolean',
    enableKatexLetterFont: 'boolean',
    enableFormulaCopy: 'boolean',
    formulaCopyDelimiters: 'boolean',
    formulaCopyBorderColor: 'color',
    messageCopyIconColor: 'color',
    toolboxFont: 'text',
    toolboxFontSize: 'number',
    toolboxLineHeight: 'number',
    toolboxPanelWidth: 'number',
    bodyColumnLeftOffset: 'number',
    bodyColumnRightOffset: 'number',
    toolboxUseCustomColors: 'boolean',
    toolboxTextColor: 'color',
    toolboxBackgroundColor: 'color',
    toolboxAccentColor: 'color',
    toolboxOpacity: 'number',
    queueFont: 'text',
    queueFontSize: 'number',
    queueLineHeight: 'number',
    queuePanelWidth: 'number',
    queueUseCustomColors: 'boolean',
    queueTextColor: 'color',
    queueBackgroundColor: 'color',
    queueAccentColor: 'color',
    queueOpacity: 'number',
    enableNeumorphicAppearance: 'boolean',
    enableAsciiOcean: 'boolean',
    asciiOceanOpacity: 'number',
    asciiOceanFps: 'number',
    asciiOceanSpecies: 'select',
    asciiOceanCoverage: 'select',
    asciiOceanHomeCoverage: 'select',
    asciiOceanPointer: 'boolean',
    asciiOceanDensity: 'number',
    asciiOceanQuality: 'select',
    asciiOceanRenderer: 'select',
    asciiOceanMotionMode: 'select',
    asciiOceanColorMode: 'select',
    asciiOceanColorSeed: 'number',
    asciiOceanBodyColor: 'color',
    asciiOceanAccentColor: 'color',
    asciiOceanFishColor: 'color',
    asciiOceanWakeColor: 'color',
    asciiOceanPauseWhileGenerating: 'boolean',
    messageGlassStyle: 'select',
    messageGlassRenderMode: 'select',
    messageGlassOpacity: 'number',
    messageGlassBlur: 'number',
    messageGlassStrength: 'number',
    messageGlassThickness: 'number',
    messageGlassCurvature: 'number',
    messageGlassBend: 'number',
    messageGlassChroma: 'number',
    messageGlassGlare: 'number',
    messageGlassRadius: 'number',
    messageGlassSaturation: 'number',
    messageGlassBrightness: 'number',
    messageGlassTintMode: 'select',
    messageGlassTint: 'color',
    enableComposerLiquidGlass: 'boolean',
    enableToolboxLiquidGlass: 'boolean',
    enableSettingsLiquidGlass: 'boolean',
    enableQueueLiquidGlass: 'boolean',
    enableSendLiquidGlass: 'boolean',
    enableScrollLiquidGlass: 'boolean',
    enableTokenLiquidGlass: 'boolean',
    enableToggleLiquidGlass: 'boolean',
    glassRenderMode: 'select',
    composerGlassStyle: 'select',
    composerGlassStrength: 'number',
    composerGlassBlur: 'number',
    composerGlassOpacity: 'number',
    composerGlassThickness: 'number',
    composerGlassGlare: 'number',
    composerGlassChroma: 'number',
    composerGlassCurvature: 'number',
    composerGlassBend: 'number',
    showTokenStats: 'boolean',
    showTokenMessageChips: 'boolean',
    showTokenSummary: 'boolean',
    tokenSummaryPosition: 'select',
    tokenSummaryOffsetX: 'number',
    tokenSummaryOffsetY: 'number',
    tokenSummaryCompactAlways: 'boolean',
    tokenSummaryCompactOnNarrow: 'boolean',
    tokenSummaryAvoidQueue: 'boolean',
    tokenSummaryTextColor: 'color',
    tokenSummaryBackgroundColor: 'color',
    tokenSummaryBorderColor: 'color',
  };
  for (const key of OVERRIDEABLE_SETTING_KEYS) {
    settingTypes[overrideEnabledKey(key)] = 'boolean';
  }

  const numberLimits = {
    asciiOceanOpacity: [0.15, 0.9],
    asciiOceanFps: [3, 30],
    asciiOceanDensity: [40, 160],
    messageGlassOpacity: [0, 0.9],
    messageGlassBlur: [0, 20],
    messageGlassStrength: [0, 60],
    messageGlassThickness: [4, 48],
    messageGlassCurvature: [0, 1],
    messageGlassBend: [0, 1],
    messageGlassChroma: [0, 0.6],
    messageGlassGlare: [0, 1.6],
    messageGlassRadius: [0, 48],
    messageGlassSaturation: [0.5, 2],
    messageGlassBrightness: [0.5, 1.5],
    asciiOceanColorSeed: [0, 2147483647],
    fontSize: [10, 40],
    thinkingOverviewFontSize: [10, 40],
    citationFontSize: [10, 40],
    webCitationFontSize: [10, 40],
    intelligentFontSize: [10, 64],
    intelligentTitleFontSize: [10, 72],
    intelligentControlFontSize: [10, 64],
    intelligentLineHeight: [1, 2.8],
    formulaFontSize: [10, 64],
    lineHeight: [1, 2.8],
    codeFontSize: [10, 32],
    codeLineHeight: [1, 2.8],
    boldWeight: [400, 1000],
    toolboxFontSize: [9, 24],
    toolboxLineHeight: [1, 2.2],
    toolboxPanelWidth: [160, 560],
    bodyColumnLeftOffset: [-400, 400],
    bodyColumnRightOffset: [-400, 400],
    toolboxOpacity: [0.2, 1],
    queueFontSize: [9, 24],
    queueLineHeight: [1, 2.2],
    queuePanelWidth: [280, 720],
    queueOpacity: [0.2, 1],
    composerGlassStrength: [0, 60],
    composerGlassBlur: [0, 20],
    composerGlassOpacity: [0.05, 0.85],
    composerGlassThickness: [4, 48],
    composerGlassGlare: [0, 1.6],
    composerGlassChroma: [0, 0.6],
    composerGlassCurvature: [0, 1],
    composerGlassBend: [0, 1],
    tokenSummaryOffsetX: [-600, 600],
    tokenSummaryOffsetY: [-600, 600],
  };

  const selectValues = {
    asciiOceanCoverage: ['gutter', 'full', 'glass'],
    messageGlassStyle: ['soft', 'clear'],
    messageGlassRenderMode: ['balanced', 'full', 'frosted'],
    messageGlassTintMode: ['auto', 'custom'],
    asciiOceanHomeCoverage: ['full', 'off'],
    asciiOceanQuality: ['eco', 'balanced', 'fine'],
    asciiOceanRenderer: ['canvas', 'gpu', 'compute'],
    asciiOceanMotionMode: ['live', 'replay15', 'replay30'],
    asciiOceanColorMode: ['auto', 'original', 'cyan', 'aurora', 'warm', 'random', 'custom'],
    asciiOceanSpecies: ['classic', 'mixed', 'hammerhead', 'tiger', 'zebra', 'greathammer', 'mako', 'thresher', 'nurse'],
    composerGlassStyle: ['clear', 'soft'],
    glassRenderMode: ['balanced', 'full', 'frosted'],
    mathFontMode: ['native', 'off'],
    fontSmoothingMode: ['auto', 'antialiased', 'subpixel-antialiased'],
    textRenderingMode: ['auto', 'optimizeLegibility', 'geometricPrecision'],
    tokenSummaryPosition: [
      'auto',
      'composer-top-center',
      'composer-top-left',
      'composer-top-right',
      'viewport-bottom-left',
      'viewport-bottom-right',
    ],
  };

  const FONT_SETTING_KEYS = new Set([
    'latinFont', 'chineseFont', 'boldLatinFont', 'boldChineseFont', 'mathFont', 'codeFont',
    'toolboxFont', 'queueFont', 'intelligentFont',
  ]);
  const LOCAL_FONT_RESCUE_GROUPS = [
    {
      label: 'Commit Mono',
      names: ['Commit Mono', 'CommitMono', 'CommitMonoV143', 'Commit Mono V143'],
    },
    {
      label: 'IBM Plex Mono',
      names: ['IBM Plex Mono'],
    },
    {
      label: 'Maple Mono',
      names: [
        'Maple Mono', 'Maple Mono NF', 'Maple Mono NF CN', 'Maple Mono CN',
        'Maple Mono NF Mono', 'Maple Mono Normal', 'Maple Mono Normal NF', 'Maple Mono Normal NF CN',
      ],
    },
  ];
  const LOCAL_FONT_RESCUE_CANDIDATE_NAMES = Array.from(new Set(
    LOCAL_FONT_RESCUE_GROUPS.flatMap((group) => group.names),
  ));

  const KNOWN_LOCAL_FONT_CANDIDATES = [
    'Arial', 'Bookerly', 'Calibri', 'Cambria', 'Cambria Math', 'Cascadia Code', 'Cascadia Mono',
    'Commit Mono', 'CommitMono', 'CommitMonoV143', 'IBM Plex Mono', 'Maple Mono', 'Maple Mono NF',
    'Maple Mono NF CN', 'Maple Mono CN',
    'Consolas', 'DengXian', 'FangSong', 'Georgia', 'JetBrains Mono', 'KaiTi', 'Latin Modern Math',
    'Microsoft JhengHei', 'Microsoft YaHei', 'Microsoft YaHei UI', 'Noto Sans CJK SC',
    'Noto Sans SC', 'Noto Serif CJK SC', 'Noto Serif SC', 'Palatino Linotype', 'Segoe UI',
    'SimHei', 'SimSun', 'Songti SC', 'Source Han Sans CN', 'Source Han Sans SC',
    'Source Han Serif CN', 'Source Han Serif SC', 'STIX Two Math', 'STSong', 'Times New Roman',
    // Supplemental CJK fallback names are tested at runtime; availability is
    // never assumed on another computer.
    '等线', '等线 Light', '方正屏显雅宋简体', '方正舒体', '方正宋圆 简', '方正新書宋',
    '方正姚体', '方正悠宋 简 508R', '仿宋', '黑体', '华文彩云', '华文仿宋', '华文琥珀',
    '华文楷体', '华文隶书', '华文宋体', '华文细黑', '华文新魏', '华文行楷', '华文中宋',
    '楷体', '隶书', '思源宋体 CN', '思源宋体 CN ExtraLight', '思源宋体 CN Heavy',
    '思源宋体 CN Light', '思源宋体 CN Medium', '思源宋体 CN SemiBold', '宋体', '微软雅黑',
    '微软雅黑 Light', '微軟正黑體', '微軟正黑體 Light', '細明體_HKSCS-ExtB',
    '細明體_MSCS-ExtB', '細明體-ExtB', '霞鹜新致宋', '霞鹜新致宋＋', '新宋体',
    '新細明體-ExtB', '幼圆', 'Microsoft JhengHei UI', 'Microsoft JhengHei UI Light',
    'Microsoft YaHei UI', 'Microsoft YaHei UI Light', 'Noto Sans SC Black',
    'Noto Sans SC DemiLight', 'Noto Sans SC Light', 'Noto Sans SC Medium', 'Noto Sans SC Thin',
    'Noto Serif SC Black', 'Noto Serif SC ExtraLight', 'Noto Serif SC Light',
    'Noto Serif SC Medium', 'Noto Serif SC SemiBold', 'SimSun-ExtB', 'SimSun-ExtG',
  ];

  // Generic fallback candidates only; no machine-specific font inventory is embedded.
  // The browser still verifies
  // each family at runtime, and API/extension results are merged without
  // deleting this fallback set.
  const WINDOWS_FONT_FAMILY_SNAPSHOT = KNOWN_LOCAL_FONT_CANDIDATES.slice();

  const glassSurfaceSpecs = [
    ['toolbox', '导航／提示词浮窗', 'toolboxGlass', 'enableToolboxLiquidGlass'],
    ['settings', 'Aa 设置面板', 'settingsGlass', 'enableSettingsLiquidGlass'],
    ['queue', '发送队列', 'queueGlass', 'enableQueueLiquidGlass'],
    ['send', '发送／语音／停止按钮', 'sendGlass', 'enableSendLiquidGlass'],
    ['tools', '输入框工具胶囊（模型／麦克风）', 'composerToolsGlass', 'enableComposerToolsLiquidGlass'],
    ['scroll', '跳转箭头', 'scrollGlass', 'enableScrollLiquidGlass'],
    ['stats', 'Token 统计贴片', 'statsGlass', 'enableTokenLiquidGlass'],
    ['toggle', 'Aa 启动按钮', 'toggleGlass', 'enableToggleLiquidGlass'],
    ['message', '模型回答正文', 'responseGlass', 'enableMessageLiquidGlass'],
  ].map(([kind, label, prefix, enabled]) => ({ kind, label, prefix, enabled }));
  const glassFields = [
    ['RenderMode', '渲染模式', 'select', ['balanced', 'full', 'frosted']],
    ['Style', '底色质感', 'select', ['clear', 'soft']],
    ['Finish', '光学风格', 'select', ['refined', 'classic']],
    ['Strength', '折射强度', 'number', [0, 60, 1]],
    ['Blur', '背景模糊 px', 'number', [0, 20, .2]],
    ['Thickness', '边缘厚度 px', 'number', [4, 48, 1]],
    ['Glare', '边缘高光', 'number', [0, 1.6, .05]],
    ['Opacity', '底色浓度（0 为透明）', 'number', [0, .85, .01]],
    ['Chroma', '色散强度（完整模式）', 'number', [0, .6, .01]],
    ['Curvature', '曲面强度（0 为基础曲面）', 'number', [0, 1, .02]],
    ['Bend', '边缘包裹（0 为最弱）', 'number', [0, 1, .02]],
  ];
  const composerKey = suffix => suffix === 'RenderMode' ? 'glassRenderMode' : suffix === 'Finish' ? 'glassOpticalFinish' : 'composerGlass' + suffix;
  defaults.glassOpticalFinish = 'refined'; settingTypes.glassOpticalFinish = 'select'; selectValues.glassOpticalFinish = ['refined', 'classic'];
  defaults.removeTopBarGap = true; settingTypes.removeTopBarGap = 'boolean';
  defaults.stabilizeScrollBoundary = true; settingTypes.stabilizeScrollBoundary = 'boolean';
  defaults.normalTextCopy = true; settingTypes.normalTextCopy = 'boolean';
  defaults.nativeLightBodyColors = true; settingTypes.nativeLightBodyColors = 'boolean';
  defaults.enableComposerToolsLiquidGlass = true; settingTypes.enableComposerToolsLiquidGlass = 'boolean';
  defaults.enableMessageLiquidGlass = defaults.enableAsciiOcean && defaults.asciiOceanCoverage === 'glass'; settingTypes.enableMessageLiquidGlass = 'boolean';
  for (const spec of glassSurfaceSpecs) for (const [suffix, , type, range] of glassFields) {
    const key = spec.prefix + suffix;
    defaults[key] = defaults[composerKey(suffix)]; settingTypes[key] = type;
    if (type === 'number') numberLimits[key] = range.slice(0, 2); else selectValues[key] = range;
  }
  function initializeGlassSurfaces(next, saved, persist = true) {
    // Fresh installations use the complete shipped preset, including each
    // surface's distinct values. Only migrate profiles for an existing store.
    if (!Object.keys(saved).length) return;
    let changed = false;
    for (const spec of glassSurfaceSpecs) for (const [suffix] of glassFields) {
      const key = spec.prefix + suffix;
      if (!Object.prototype.hasOwnProperty.call(saved, key)) { next[key] = normalizeSetting(key, next[composerKey(suffix)]); changed = true; }
    }
    if (!Object.prototype.hasOwnProperty.call(saved, 'enableMessageLiquidGlass')) { next.enableMessageLiquidGlass = Boolean(next.enableAsciiOcean && next.asciiOceanCoverage === 'glass'); changed = true; }
    if (changed && persist) writeStore(STORAGE_KEY, { ...saved, ...next });
  }
  function applyIndependentGlass(root) {
    const attribute = (name, value) => { if (root.getAttribute(name) !== String(value)) root.setAttribute(name, String(value)); };
    const flag = (name, value) => { if (root.hasAttribute(name) !== Boolean(value)) root.toggleAttribute(name, Boolean(value)); };
    const property = (name, value) => { if (root.style.getPropertyValue(name) !== String(value)) root.style.setProperty(name, String(value)); };
    attribute('data-cgfc-glass-finish', settings.glassOpticalFinish);
    flag('data-cgfc-topbar-overlap', settings.removeTopBarGap);
    flag('data-cgfc-stable-scroll-boundary', settings.stabilizeScrollBoundary);
    flag('data-cgfc-normal-text-copy', settings.normalTextCopy);
    flag('data-cgfc-light-native-normal', settings.nativeLightBodyColors && String(settings.normalColor).toLowerCase() === String(defaults.normalColor).toLowerCase());
    flag('data-cgfc-light-native-bold', settings.nativeLightBodyColors && String(settings.boldColor).toLowerCase() === String(defaults.boldColor).toLowerCase());
    flag('data-cgfc-composer-tools-liquid-glass', settings.enableComposerToolsLiquidGlass);
    flag('data-cgfc-message-glass', settings.enableMessageLiquidGlass);
    for (const spec of glassSurfaceSpecs) {
      for (const [suffix, , type] of glassFields) {
        const value = normalizeSetting(spec.prefix + suffix, settings[spec.prefix + suffix]);
        const slug = suffix === 'RenderMode' ? 'render-mode' : suffix.toLowerCase();
        if (type === 'select') attribute('data-cgfc-' + spec.kind + '-glass-' + slug, value);
        else property('--cgfc-' + spec.kind + '-glass-' + slug, value);
      }
    }
    attribute('data-cgfc-message-glass-style', settings.responseGlassStyle);
    for (const node of document.querySelectorAll('[data-cgfc-glass-settings-status]')) {
      const prefix = node.getAttribute('data-cgfc-glass-settings-status');
      const get = suffix => settings[prefix ? prefix + suffix : composerKey(suffix)];
      const mode = get('RenderMode'), text = mode === 'full' ? '完整折射 · RGB 色散' : mode === 'balanced' ? '单路折射 · 无 RGB 色散' : '仅磨砂 · 无折射／色散';
      const summary = text + '；模糊 ' + get('Blur') + 'px；高光 ' + get('Glare');
      if (node.textContent !== summary) node.textContent = summary;
    }
    globalThis.__cgptUnifiedRuntimeV1?.topBarFix?.refresh();
  }
  function createIndependentGlassControls(panel) {
    const group = createSettingsGroup(panel, '液态玻璃 · 各面板独立');
    const hint = document.createElement('p'); hint.className = 'cgfc-hint';
    hint.textContent = '首次升级时，各面板复制输入框当前参数；之后独立保存。完整模式才显示 RGB 色散。底色浓度 0 为透明，高光 0 为关闭；模糊和折射仍独立生效，折射强度 0 才关闭折射。'; group.appendChild(hint);
    const input = { label: '输入框', prefix: '', enabled: 'enableComposerLiquidGlass' };
    for (const spec of [input, ...glassSurfaceSpecs]) {
      const target = createSettingsGroup(group, spec.label);
      target.setAttribute('data-cgfc-glass-settings-panel', spec.prefix || 'composer');
      appendControl(target, { label: '启用此处液态玻璃', key: spec.enabled, type: 'checkbox' });
      const status = document.createElement('p'); status.className = 'cgfc-hint'; status.setAttribute('data-cgfc-glass-settings-status', spec.prefix); target.appendChild(status);
      for (const [suffix, label, type, range] of glassFields) {
        const key = spec.prefix ? spec.prefix + suffix : composerKey(suffix);
        const choices = type !== 'select' ? undefined : range.map(value => ({ value, label: ({ balanced: '单路折射（无 RGB 色散）', full: '完整折射 + RGB 色散', frosted: '仅磨砂（无折射／色散）', clear: '清透底色', soft: '柔和底色', refined: '精致 · 柔和边缘与高光', classic: '经典 · 保留原版光学' })[value] }));
        appendControl(target, { label, key, type, choices, ...(type === 'number' ? { min: range[0], max: range[1], step: range[2] } : {}) });
      }
      if (spec.prefix) {
        const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制输入框当前参数';
        copy.addEventListener('click', () => {
          const next = { ...settings }; for (const [suffix] of glassFields) next[spec.prefix + suffix] = settings[composerKey(suffix)];
          settings = next; writeStore(STORAGE_KEY, settings); applySettings(); syncPanelInputs(panel);
        }); target.appendChild(copy);
      }
      if (spec.kind === 'message') {
        const appearance = createSettingsGroup(target, '正文圆角与底色');
        for (const [suffix, label, min, max, step] of [['Radius', '圆角 px', 0, 48, 1], ['Saturation', '背景饱和度', .5, 2, .05], ['Brightness', '背景亮度', .5, 1.5, .05]]) appendControl(appearance, { key: 'messageGlass' + suffix, label, type: 'number', min, max, step });
        appendControl(appearance, { key: 'messageGlassTintMode', label: '正文底色来源', type: 'select', choices: [{ value: 'auto', label: '自动适配明暗' }, { value: 'custom', label: '自选颜色' }] });
        appendControl(appearance, { key: 'messageGlassTint', label: '自选正文底色', type: 'color' });
      }
    }
    return group;
  }

  // Curated defaults contain validated preference fields only. Prompts, usage
  // history, queue and directory data are excluded.
  // Apply after all profile schemas exist so per-surface values stay distinct.
  Object.assign(defaults, {
  "latinFont": "Lora",
  "chineseFont": "FZNewShuSong-Z10S",
  "boldLatinFont": "Lora",
  "boldChineseFont": "\"Noto Serif SC\", \"Source Han Serif SC\", \"Songti SC\", serif",
  "mathFont": "Latin Modern Math",
  "mathFontMode": "native",
  "codeFont": "\"JetBrains Mono\"",
  "fontSize": 25,
  "thinkingOverviewFontSize": 18,
  "citationFontSize": 13,
  "webCitationFontSize": 14,
  "intelligentFont": "\"Times New Roman\", \"Noto Serif SC\", \"Source Han Serif SC\", serif",
  "intelligentFontSize": 24,
  "intelligentTitleFontSize": 26,
  "intelligentControlFontSize": 26,
  "intelligentLineHeight": 1.6,
  "formulaFontSize": 25,
  "lineHeight": 1.9,
  "codeFontSize": 18,
  "codeLineHeight": 1.8,
  "normalColor": "#ffffff",
  "boldColor": "#e8e2d8",
  "boldWeight": 750,
  "stopAutoScrollWhileGenerating": true,
  "wrapCode": true,
  "enableFontSmoothing": true,
  "fontSmoothingMode": "antialiased",
  "textRenderingMode": "optimizeLegibility",
  "enableResidualLatex": true,
  "enableKatexLetterFont": true,
  "enableFormulaCopy": true,
  "formulaCopyDelimiters": true,
  "formulaCopyBorderColor": "#ffffff",
  "messageCopyIconColor": "#6d5dfc",
  "toolboxFont": "FZNewShuSong-Z10S",
  "toolboxFontSize": 13,
  "toolboxLineHeight": 1.4,
  "toolboxPanelWidth": 300,
  "bodyColumnLeftOffset": 0,
  "bodyColumnRightOffset": 0,
  "toolboxUseCustomColors": false,
  "toolboxTextColor": "#f4f4f4",
  "toolboxBackgroundColor": "#212121",
  "toolboxAccentColor": "#828282",
  "toolboxOpacity": 0.82,
  "queueFont": "FZNewShuSong-Z10S",
  "queueFontSize": 12,
  "queueLineHeight": 1.4,
  "queuePanelWidth": 420,
  "queueUseCustomColors": false,
  "queueTextColor": "#afafaf",
  "queueBackgroundColor": "#000000",
  "queueAccentColor": "#609e56",
  "queueOpacity": 0.94,
  "enableNeumorphicAppearance": false,
  "enableAsciiOcean": true,
  "asciiOceanOpacity": 0.65,
  "asciiOceanFps": 12,
  "asciiOceanSpecies": "mixed",
  "asciiOceanCoverage": "glass",
  "asciiOceanHomeCoverage": "full",
  "asciiOceanPointer": false,
  "asciiOceanDensity": 90,
  "asciiOceanQuality": "eco",
  "asciiOceanRenderer": "compute",
  "asciiOceanMotionMode": "replay30",
  "asciiOceanColorMode": "original",
  "asciiOceanColorSeed": 560765584,
  "asciiOceanBodyColor": "#7ed8f0",
  "asciiOceanAccentColor": "#c79aff",
  "asciiOceanFishColor": "#b8e7f7",
  "asciiOceanWakeColor": "#55d8ea",
  "asciiOceanPauseWhileGenerating": false,
  "messageGlassStyle": "clear",
  "messageGlassRenderMode": "frosted",
  "messageGlassOpacity": 0.18,
  "messageGlassBlur": 6,
  "messageGlassStrength": 28,
  "messageGlassThickness": 14,
  "messageGlassCurvature": 0.5,
  "messageGlassBend": 0.5,
  "messageGlassChroma": 0.04,
  "messageGlassGlare": 0.45,
  "messageGlassRadius": 18,
  "messageGlassSaturation": 1.12,
  "messageGlassBrightness": 1,
  "messageGlassTintMode": "auto",
  "messageGlassTint": "#15191f",
  "enableComposerLiquidGlass": true,
  "enableToolboxLiquidGlass": true,
  "enableSettingsLiquidGlass": true,
  "enableQueueLiquidGlass": true,
  "enableSendLiquidGlass": true,
  "enableScrollLiquidGlass": true,
  "enableTokenLiquidGlass": true,
  "enableToggleLiquidGlass": true,
  "glassRenderMode": "full",
  "composerGlassStyle": "clear",
  "composerGlassStrength": 36,
  "composerGlassBlur": 1,
  "composerGlassOpacity": 0.12,
  "composerGlassThickness": 14,
  "composerGlassGlare": 0.45,
  "composerGlassChroma": 0.04,
  "composerGlassCurvature": 0.5,
  "composerGlassBend": 0.5,
  "showTokenStats": false,
  "showTokenMessageChips": true,
  "showTokenSummary": true,
  "tokenSummaryPosition": "auto",
  "tokenSummaryOffsetX": 600,
  "tokenSummaryOffsetY": 34,
  "tokenSummaryCompactAlways": true,
  "tokenSummaryCompactOnNarrow": true,
  "tokenSummaryAvoidQueue": false,
  "tokenSummaryTextColor": "#5c5c5c",
  "tokenSummaryBackgroundColor": "#000000",
  "tokenSummaryBorderColor": "#000000",
  "latinFontEnabled": true,
  "chineseFontEnabled": true,
  "boldLatinFontEnabled": true,
  "boldChineseFontEnabled": true,
  "mathFontEnabled": false,
  "mathFontModeEnabled": true,
  "codeFontEnabled": true,
  "fontSizeEnabled": true,
  "thinkingOverviewFontSizeEnabled": true,
  "citationFontSizeEnabled": true,
  "webCitationFontSizeEnabled": true,
  "formulaFontSizeEnabled": true,
  "lineHeightEnabled": true,
  "codeFontSizeEnabled": true,
  "codeLineHeightEnabled": true,
  "intelligentFontEnabled": false,
  "intelligentFontSizeEnabled": true,
  "intelligentTitleFontSizeEnabled": true,
  "intelligentControlFontSizeEnabled": false,
  "intelligentLineHeightEnabled": false,
  "normalColorEnabled": true,
  "boldColorEnabled": true,
  "boldWeightEnabled": true,
  "fontSmoothingModeEnabled": true,
  "textRenderingModeEnabled": true,
  "formulaCopyBorderColorEnabled": true,
  "messageCopyIconColorEnabled": false,
  "toolboxFontEnabled": true,
  "toolboxFontSizeEnabled": true,
  "toolboxLineHeightEnabled": true,
  "toolboxPanelWidthEnabled": true,
  "bodyColumnLeftOffsetEnabled": false,
  "bodyColumnRightOffsetEnabled": false,
  "toolboxTextColorEnabled": false,
  "toolboxBackgroundColorEnabled": false,
  "toolboxAccentColorEnabled": false,
  "toolboxOpacityEnabled": false,
  "queueFontEnabled": true,
  "queueFontSizeEnabled": true,
  "queueLineHeightEnabled": true,
  "queuePanelWidthEnabled": true,
  "queueTextColorEnabled": true,
  "queueBackgroundColorEnabled": true,
  "queueAccentColorEnabled": true,
  "queueOpacityEnabled": true,
  "tokenSummaryTextColorEnabled": true,
  "tokenSummaryBackgroundColorEnabled": true,
  "tokenSummaryBorderColorEnabled": true,
  "glassOpticalFinish": "classic",
  "removeTopBarGap": true,
  "enableComposerToolsLiquidGlass": false,
  "enableMessageLiquidGlass": true,
  "toolboxGlassRenderMode": "full",
  "toolboxGlassStyle": "clear",
  "toolboxGlassFinish": "classic",
  "toolboxGlassStrength": 36,
  "toolboxGlassBlur": 2,
  "toolboxGlassThickness": 14,
  "toolboxGlassGlare": 0.45,
  "toolboxGlassOpacity": 0.12,
  "toolboxGlassChroma": 0.04,
  "toolboxGlassCurvature": 0.5,
  "toolboxGlassBend": 0.5,
  "settingsGlassRenderMode": "full",
  "settingsGlassStyle": "clear",
  "settingsGlassFinish": "classic",
  "settingsGlassStrength": 36,
  "settingsGlassBlur": 2,
  "settingsGlassThickness": 14,
  "settingsGlassGlare": 0.45,
  "settingsGlassOpacity": 0.12,
  "settingsGlassChroma": 0.04,
  "settingsGlassCurvature": 0.5,
  "settingsGlassBend": 0.5,
  "queueGlassRenderMode": "full",
  "queueGlassStyle": "clear",
  "queueGlassFinish": "classic",
  "queueGlassStrength": 36,
  "queueGlassBlur": 1,
  "queueGlassThickness": 14,
  "queueGlassGlare": 0.45,
  "queueGlassOpacity": 0.12,
  "queueGlassChroma": 0.04,
  "queueGlassCurvature": 0.5,
  "queueGlassBend": 0.5,
  "sendGlassRenderMode": "full",
  "sendGlassStyle": "clear",
  "sendGlassFinish": "classic",
  "sendGlassStrength": 36,
  "sendGlassBlur": 0,
  "sendGlassThickness": 14,
  "sendGlassGlare": 0.45,
  "sendGlassOpacity": 0.12,
  "sendGlassChroma": 0.04,
  "sendGlassCurvature": 0.5,
  "sendGlassBend": 0.5,
  "composerToolsGlassRenderMode": "full",
  "composerToolsGlassStyle": "clear",
  "composerToolsGlassFinish": "classic",
  "composerToolsGlassStrength": 36,
  "composerToolsGlassBlur": 0,
  "composerToolsGlassThickness": 14,
  "composerToolsGlassGlare": 0.45,
  "composerToolsGlassOpacity": 0.12,
  "composerToolsGlassChroma": 0.04,
  "composerToolsGlassCurvature": 0.5,
  "composerToolsGlassBend": 0.5,
  "scrollGlassRenderMode": "full",
  "scrollGlassStyle": "clear",
  "scrollGlassFinish": "classic",
  "scrollGlassStrength": 36,
  "scrollGlassBlur": 0.5,
  "scrollGlassThickness": 14,
  "scrollGlassGlare": 0.45,
  "scrollGlassOpacity": 0.12,
  "scrollGlassChroma": 0.04,
  "scrollGlassCurvature": 0.5,
  "scrollGlassBend": 0.5,
  "statsGlassRenderMode": "full",
  "statsGlassStyle": "clear",
  "statsGlassFinish": "classic",
  "statsGlassStrength": 36,
  "statsGlassBlur": 1,
  "statsGlassThickness": 14,
  "statsGlassGlare": 0.45,
  "statsGlassOpacity": 0.12,
  "statsGlassChroma": 0.04,
  "statsGlassCurvature": 0.5,
  "statsGlassBend": 0.5,
  "toggleGlassRenderMode": "full",
  "toggleGlassStyle": "clear",
  "toggleGlassFinish": "classic",
  "toggleGlassStrength": 36,
  "toggleGlassBlur": 1,
  "toggleGlassThickness": 14,
  "toggleGlassGlare": 0.45,
  "toggleGlassOpacity": 0.12,
  "toggleGlassChroma": 0.04,
  "toggleGlassCurvature": 0.5,
  "toggleGlassBend": 0.5,
  "responseGlassRenderMode": "full",
  "responseGlassStyle": "clear",
  "responseGlassFinish": "classic",
  "responseGlassStrength": 36,
  "responseGlassBlur": 1,
  "responseGlassThickness": 14,
  "responseGlassGlare": 0.45,
  "responseGlassOpacity": 0.12,
  "responseGlassChroma": 0.04,
  "responseGlassCurvature": 0.5,
  "responseGlassBend": 0.5
});

  let settings = loadSettings();
  let saveTimer = 0;
  let disclaimerTimer = 0;
  let shellGuardTimer = 0;
  let observersStarted = false;
  let residualLatexObserverStarted = false;
  let residualLatexTimer = 0;
  let formulaCopyInitialized = false;
  let detectedFontFamilies = [];
  const detectedFontAliases = new Map();
  const detectedFontLabels = new Map();
  const verifiedFontFamilies = new Set();
  const fallbackFontFamilies = new Set();
  let fontDetectionMode = 'candidate';
  let fontSearchQuery = '';
  let lastApiFontCount = 0;
  let lastApiFontFaceCount = 0;
  let lastFallbackVerifiedCount = 0;
  let lastRescueVerifiedCount = 0;
  let lastExtensionFontCount = 0;
  let lastExtensionStatus = 'not-detected';
  const residualLatexRoots = new Set();
  const residualRootWork = new WeakMap();
  const residualSelfMutationCounts = new WeakMap();
  let refreshAutoScrollLockState = () => {};

  function clamp(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  function sanitizeFontStack(value, fallback) {
    const text = String(value || '')
      .replace(/[\u0000-\u001f\u007f<>\\{};]/g, '')
      .replace(/!\s*important/gi, '')
      .slice(0, 300)
      .trim();
    if (!text) return fallback;
    if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('font-family', text)) return fallback;
    return text;
  }

  function stripGenericFontFallbacks(value, fallback) {
    const sanitized = sanitizeFontStack(value, fallback);
    const genericFamilies = new Set([
      'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
      'ui-serif', 'ui-sans-serif', 'ui-monospace', 'emoji', 'math', 'fangsong',
    ]);
    const specificFamilies = sanitized
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part && !genericFamilies.has(part.toLowerCase()));
    return specificFamilies.length ? specificFamilies.join(', ') : fallback;
  }

  function sanitizeColor(value, fallback) {
    const text = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
  }

  function colorWithAlpha(value, alpha, fallback) {
    const color = sanitizeColor(value, fallback);
    const opacity = clamp(alpha, 0, 1, 1);
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
  }

  function parseRgbColor(value) {
    const text = String(value || '').trim();
    const rgb = text.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
    if (rgb) {
      return {
        red: clamp(rgb[1], 0, 255, 0),
        green: clamp(rgb[2], 0, 255, 0),
        blue: clamp(rgb[3], 0, 255, 0),
        alpha: rgb[4] == null ? 1 : clamp(rgb[4], 0, 1, 1),
      };
    }
    const hex = text.match(/^#([0-9a-f]{6})$/i);
    if (!hex) return null;
    return {
      red: Number.parseInt(hex[1].slice(0, 2), 16),
      green: Number.parseInt(hex[1].slice(2, 4), 16),
      blue: Number.parseInt(hex[1].slice(4, 6), 16),
      alpha: 1,
    };
  }

  function detectPageTheme() {
    const root = document.documentElement;
    if (!root) return 'light';

    const explicit = [
      root.getAttribute('data-theme'),
      root.getAttribute('data-color-scheme'),
      document.body?.getAttribute?.('data-theme'),
    ].map((value) => String(value || '').toLowerCase());
    if (explicit.some((value) => value === 'dark')) return 'dark';
    if (explicit.some((value) => value === 'light')) return 'light';
    if (root.classList.contains('dark') || document.body?.classList?.contains('dark')) return 'dark';
    if (root.classList.contains('light') || document.body?.classList?.contains('light')) return 'light';

    try {
      const rootStyle = getComputedStyle(root);
      const bodyStyle = document.body ? getComputedStyle(document.body) : null;
      const candidates = [
        rootStyle.getPropertyValue('--main-surface-primary'),
        rootStyle.getPropertyValue('--bg-primary'),
        bodyStyle?.backgroundColor,
        rootStyle.backgroundColor,
      ];
      for (const candidate of candidates) {
        const rgb = parseRgbColor(candidate);
        if (!rgb || rgb.alpha < 0.2) continue;
        const luma = (rgb.red * 0.2126 + rgb.green * 0.7152 + rgb.blue * 0.0722) / 255;
        return luma < 0.48 ? 'dark' : 'light';
      }
      const colorScheme = `${rootStyle.colorScheme || ''} ${bodyStyle?.colorScheme || ''}`.toLowerCase();
      if (/\bdark\b/.test(colorScheme) && !/\blight\b/.test(colorScheme)) return 'dark';
    } catch (_) {}

    try {
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (_) {
      return 'light';
    }
  }

  function syncThemeMode() {
    const root = document.documentElement;
    if (!root) return 'light';
    const theme = detectPageTheme();
    if (root.dataset.cgfcTheme !== theme) root.dataset.cgfcTheme = theme;
    if (root.style.getPropertyValue('--cgfc-color-scheme') !== theme) root.style.setProperty('--cgfc-color-scheme', theme);
    return theme;
  }

  let themeSyncStarted = false;
  let themeSyncObserver = null;
  function startThemeSync() {
    syncThemeMode();
    if (themeSyncStarted) return;
    themeSyncStarted = true;

    const observeThemeTarget = (target) => {
      if (!(target instanceof Element)) return;
      themeSyncObserver?.observe(target, {
        attributes: true,
        attributeFilter: ['class', 'data-theme', 'data-color-scheme'],
      });
    };

    themeSyncObserver = new MutationObserver(() => syncThemeMode());
    observeThemeTarget(document.documentElement);
    observeThemeTarget(document.body);
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', () => {
        observeThemeTarget(document.body);
        syncThemeMode();
      }, { once: true });
    }

    try {
      const media = matchMedia('(prefers-color-scheme: dark)');
      media.addEventListener?.('change', syncThemeMode);
    } catch (_) {}
    window.addEventListener('pageshow', syncThemeMode);
  }

  function readStore(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
    } catch (_) {
      // Fall through to localStorage.
    }

    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return;
      }
    } catch (_) {
      // Fall through to localStorage.
    }

    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      // Ignore storage failures; the live UI still works for this page.
    }
  }

  function normalizeSetting(key, value) {
    const type = settingTypes[key];

    if (type === 'number') {
      const [min, max] = numberLimits[key];
      return clamp(value, min, max, defaults[key]);
    }

    if (type === 'boolean') {
      if (value === false || value === 0 || value === '0' || value === 'false') return false;
      if (value === true || value === 1 || value === '1' || value === 'true') return true;
      return defaults[key];
    }
    if (type === 'select') {
      return selectValues[key]?.includes(value) ? value : defaults[key];
    }
    if (type === 'color') return sanitizeColor(value, defaults[key]);
    if (FONT_SETTING_KEYS.has(key)) {
      return sanitizeFontStack(value, defaults[key]);
    }
    return String(value ?? defaults[key]);
  }

  function getMozFontSmoothing(mode) {
    return mode === 'antialiased' ? 'grayscale' : 'auto';
  }

  function loadSettings() {
    const stored = readStore(STORAGE_KEY, {});
    const saved = stored && typeof stored === 'object' ? { ...stored } : {};
    const next = { ...defaults };

    // v3 exposed KaTeX-wide font overrides. They could hide KaTeX private-use
    // glyphs (for example the slash used by \ne and \neq), so migrate both old
    // modes to the renderer-safe native MathML mode.
    if (saved?.mathFontMode === 'compatible' || saved?.mathFontMode === 'force') {
      saved.mathFontMode = 'native';
    }

    // v4.1 and earlier used one bodyFont setting. Preserve that choice as the
    // Chinese and bold-Chinese fallback while introducing independent Latin
    // and bold-Latin stacks.
    if (saved.bodyFont) {
      if (!saved.chineseFont) saved.chineseFont = saved.bodyFont;
      if (!saved.boldChineseFont) saved.boldChineseFont = saved.bodyFont;
    }

    // Preserve the v1.4.x palette behavior when migrating an existing
    // installation. Other appearance values were always active before v1.5.0,
    // so their new per-item switches intentionally default to on.
    const migrateLegacyPalette = (prefix) => {
      const legacyKey = `${prefix}UseCustomColors`;
      if (!Object.prototype.hasOwnProperty.call(saved, legacyKey)) return;
      const enabled = normalizeSetting(legacyKey, saved[legacyKey]);
      ['TextColor', 'BackgroundColor', 'AccentColor', 'Opacity'].forEach((suffix) => {
        const enabledKey = overrideEnabledKey(`${prefix}${suffix}`);
        if (!Object.prototype.hasOwnProperty.call(saved, enabledKey)) saved[enabledKey] = enabled;
      });
    };
    migrateLegacyPalette('toolbox');
    migrateLegacyPalette('queue');

    // Older builds enabled a fixed white body palette by default, which made
    // ChatGPT's light theme nearly unreadable. Migrate only the exact legacy
    // default pair once; any customized body palette remains untouched.
    const themePaletteMigrated = readStore(THEME_PALETTE_MIGRATION_KEY, false) === true;
    if (!themePaletteMigrated) {
      const legacyDefaultPair = String(saved.normalColor || '').toLowerCase() === '#ffffff'
        && String(saved.boldColor || '').toLowerCase() === '#e8e2d8';
      if (legacyDefaultPair) {
        if (!Object.hasOwn(saved, overrideEnabledKey('normalColor'))) saved[overrideEnabledKey('normalColor')] = false;
        if (!Object.hasOwn(saved, overrideEnabledKey('boldColor'))) saved[overrideEnabledKey('boldColor')] = false;
      }
      writeStore(THEME_PALETTE_MIGRATION_KEY, true);
    }

    Object.keys(defaults).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(saved || {}, key)) {
        next[key] = normalizeSetting(key, saved[key]);
      }
    });

    initializeGlassSurfaces(next, saved);
    return next;
  }

  // Only script-owned data is portable; never enumerate ChatGPT account storage.
  const BACKUP_FORMAT = 'chatgpt-unified-toolbox-backup';
  const BACKUP_LOCAL_KEYS = ['cgpt-answer-toc-position-v1', 'cgpt-answer-toc-size-v1',
    'cgpt-answer-toc-view-v1', 'cgpt-answer-toc-collapsed'];
  const BACKUP_LABEL_PREFIX = 'cgpt-unified-conversation-labels-v1:';
  const BACKUP_MAX_BYTES = 128 * 1024 * 1024;
  const backupRuntime = () => globalThis.__cgptUnifiedRuntimeV1;
  const backupRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

  function collectBackupStorage(store, keys) {
    return Object.fromEntries(keys.map((key) => [key, store.getItem(key)]));
  }

  async function buildToolboxBackup() {
    const rt = backupRuntime();
    const savedSettings = { ...settings };
    const savedPrompts = JSON.parse(JSON.stringify(rt.promptLibrary?.prompts || []));
    const savedQueue = (rt.messageQueue?.items || []).map((item) => ({ ...item,
      metadata: { ...item.metadata }, attachments: [...(item.attachments || [])] }));
    // Snapshot current in-memory values, including edits not yet persisted by debounce.
    const labels = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i))
      .filter((key) => key?.startsWith(BACKUP_LABEL_PREFIX));
    const queue = [];
    for (const item of savedQueue) {
      const attachments = [];
      for (const attachment of item.attachments || []) {
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(new Error('无法读取队列附件：' + attachment.name));
          reader.readAsDataURL(attachment.file);
        });
        attachments.push({ name: attachment.name, type: attachment.type,
          lastModified: attachment.lastModified, data });
      }
      queue.push({ content: item.content, metadata: item.metadata, createdAt: item.createdAt, attachments });
    }
    return { format: BACKUP_FORMAT, schemaVersion: 1, scriptVersion: rt.version,
      exportedAt: new Date().toISOString(), settings: savedSettings,
      prompts: savedPrompts,
      local: collectBackupStorage(localStorage, BACKUP_LOCAL_KEYS),
      session: collectBackupStorage(sessionStorage, labels), queue };
  }

  function downloadToolboxBackup(backup, suffix = '') {
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    if (blob.size > BACKUP_MAX_BYTES) throw new Error('备份超过 128 MB，请减少队列附件后重试。');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chatgpt-toolbox-backup${suffix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function validateToolboxBackup(value) {
    if (!backupRecord(value) || value.format !== BACKUP_FORMAT || value.schemaVersion !== 1)
      throw new Error('不是支持的工具箱备份文件（格式版本 1）。');
    if (!backupRecord(value.settings) || !Array.isArray(value.prompts)
      || !backupRecord(value.local) || !backupRecord(value.session) || !Array.isArray(value.queue))
      throw new Error('备份数据不完整。');
    if (!BACKUP_LOCAL_KEYS.every((key) => Object.hasOwn(value.local, key)))
      throw new Error('备份缺少目录布局数据。');
    const nextSettings = { ...defaults };
    for (const key of Object.keys(defaults)) {
      if (Object.hasOwn(value.settings, key)) nextSettings[key] = normalizeSetting(key, value.settings[key]);
    }
    initializeGlassSurfaces(nextSettings, value.settings, false);
    for (const item of value.prompts) {
      if (!backupRecord(item) || typeof item.content !== 'string' || !item.content.trim())
        throw new Error('提示词数据无效。');
    }
    for (const [key, raw] of Object.entries(value.local)) {
      if (!BACKUP_LOCAL_KEYS.includes(key) || (raw !== null && typeof raw !== 'string'))
        throw new Error('包含不支持的本地存储项。');
      if (raw === null) continue;
      if (key.endsWith('collapsed') && !['0', '1'].includes(raw)) throw new Error('折叠状态无效。');
      if (key.includes('-view-') && !['headings', 'conversation', 'prompts'].includes(raw))
        throw new Error('目录视图无效。');
      if (key.includes('-position-') || key.includes('-size-')) {
        const geometry = JSON.parse(raw);
        const fields = key.includes('-position-') ? ['left', 'top'] : ['width', 'height'];
        if (!backupRecord(geometry) || !fields.every((field) => typeof geometry[field] === 'number'
          && Number.isFinite(geometry[field]) && (field === 'left' || field === 'top' || geometry[field] > 0)))
          throw new Error('目录位置或尺寸无效。');
      }
    }
    for (const [key, raw] of Object.entries(value.session)) {
      if (!key.startsWith(BACKUP_LABEL_PREFIX) || typeof raw !== 'string') throw new Error('目录缓存无效。');
      const labels = JSON.parse(raw);
      if (!Array.isArray(labels) || labels.length > 500 || !labels.every((entry) => Array.isArray(entry)
        && Number.isInteger(entry[0]) && entry[0] >= 0 && typeof entry[1] === 'string'))
        throw new Error('目录标签数据无效。');
    }
    const nextQueue = value.queue.map((item, index) => {
      if (!backupRecord(item) || typeof item.content !== 'string' || !Array.isArray(item.attachments))
        throw new Error('队列数据无效。');
      const attachments = item.attachments.map((attachment) => {
        if (!backupRecord(attachment) || typeof attachment.name !== 'string'
          || typeof attachment.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(attachment.data))
          throw new Error('队列附件数据无效。');
        const bytes = Uint8Array.from(atob(attachment.data), (char) => char.charCodeAt(0));
        const file = new File([bytes], attachment.name, { type: String(attachment.type || ''),
          lastModified: Number(attachment.lastModified) || Date.now() });
        return { file, name: file.name, type: file.type, size: file.size, lastModified: file.lastModified };
      });
      if (!item.content.trim() && !attachments.length) throw new Error('队列包含空消息。');
      return { id: `import-${Date.now()}-${index}`, content: item.content, attachments,
        metadata: backupRecord(item.metadata) ? { ...item.metadata } : {},
        createdAt: Number(item.createdAt) || Date.now(), status: 'pending', error: '' };
    });
    return { settings: nextSettings, prompts: backupRuntime().promptLibrary.normalizeLibrary(value.prompts),
      local: value.local, session: value.session, queue: nextQueue };
  }

  function commitToolboxBackup(next, panel) {
    const rt = backupRuntime();
    const queue = rt.messageQueue;
    if (queue.isDispatching || queue.awaitingResponse || queue.items.some((item) => item.status === 'sending'))
      throw new Error('队列正在发送或等待回复，请结束后再导入。');
    const writes = [
      { key: STORAGE_KEY, value: next.settings },
      { key: 'cgpt-unified-prompt-library-v1', value: next.prompts },
      { key: THEME_PALETTE_MIGRATION_KEY, value: true },
    ];
    const undo = [];
    try {
      for (const item of writes) {
        const useGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
        const previous = useGM ? GM_getValue(item.key, null) : localStorage.getItem(item.key);
        undo.push(() => useGM ? GM_setValue(item.key, previous)
          : previous === null ? localStorage.removeItem(item.key) : localStorage.setItem(item.key, previous));
        if (useGM) GM_setValue(item.key, item.value);
        else localStorage.setItem(item.key, JSON.stringify(item.value));
      }
      for (const [store, entries] of [[localStorage, next.local], [sessionStorage, next.session]]) {
        for (const [key, raw] of Object.entries(entries)) {
          const previous = store.getItem(key);
          undo.push(() => previous === null ? store.removeItem(key) : store.setItem(key, previous));
          if (raw === null) store.removeItem(key);
          else store.setItem(key, raw);
        }
      }
    } catch (error) {
      for (const rollback of undo.reverse()) { try { rollback(); } catch {} }
      throw new Error('存储写入失败，已尝试回滚：' + error.message);
    }
    clearTimeout(saveTimer);
    clearTimeout(rt.promptLibrary.usagePersistTimer);
    rt.promptLibrary.usagePersistTimer = 0;
    settings = next.settings;
    rt.promptLibrary.prompts = next.prompts;
    rt.promptLibrary.onCountChange?.(next.prompts.length);
    if (rt.promptLibrary.list) rt.promptLibrary.render();
    queue.pause();
    queue.items = next.queue;
    queue.editingItemId = '';
    queue.idleCount = 0;
    queue.emit();
    applySettings();
    refreshFontSelects();
    syncPanelInputs(panel);
    const toc = rt.answerToc;
    if (toc) {
      toc.savedPosition = toc.readPositionState();
      toc.savedSize = toc.readSizeState();
      if (toc.savedPosition) toc.setManualPosition(toc.savedPosition.left, toc.savedPosition.top);
      if (toc.savedSize) toc.setPanelSize(toc.savedSize.width, toc.savedSize.height);
      toc.collapsed = toc.readCollapsedState();
      toc.activeView = toc.readViewState();
      toc.applyCollapsedState();
      toc.applyActiveView();
      toc.conversationLabelCache.clear();
      toc.restoreConversationLabelSnapshot();
    }
  }

  function createBackupControls(panel) {
    const group = createSettingsGroup(panel, '全部设置 / 数据备份');
    const hint = document.createElement('p');
    hint.className = 'cgfc-hint';
    hint.textContent = '备份所有功能与排版设置、提示词、目录布局/标签缓存、发送队列及附件。JSON 含提示词和附件原文，请妥善保存；聊天正文请使用会话导出。导入覆盖设置、提示词和队列，队列保持暂停；目录缓存按会话合并。';
    const actions = document.createElement('div');
    actions.className = 'cgfc-backup-actions';
    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.textContent = '一键导出全部';
    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.textContent = '导入备份文件';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;
    const status = document.createElement('p');
    status.className = 'cgfc-hint';
    status.setAttribute('role', 'status');
    const busy = (value) => { exportButton.disabled = value; importButton.disabled = value; };
    exportButton.addEventListener('click', async () => {
      busy(true);
      status.textContent = '正在打包备份…';
      try { downloadToolboxBackup(await buildToolboxBackup()); status.textContent = '全部备份已生成，请确认浏览器下载完成。'; }
      catch (error) { status.textContent = '导出失败：' + error.message; }
      finally { busy(false); }
    });
    importButton.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      busy(true);
      try {
        if (file.size > BACKUP_MAX_BYTES) throw new Error('文件超过 128 MB。');
        const next = validateToolboxBackup(JSON.parse(await file.text()));
        if (!window.confirm(`导入将覆盖全部设置、提示词和当前发送队列。\n提示词：${next.prompts.length} 条；队列：${next.queue.length} 条。\n导入前会自动下载旧数据备份，恢复队列保持暂停。继续？`)) {
          status.textContent = '已取消导入。'; return;
        }
        downloadToolboxBackup(await buildToolboxBackup(), '-before-import');
        commitToolboxBackup(next, panel);
        status.textContent = '导入成功，设置已生效；发送队列已暂停，请检查消息及所属会话后手动继续。';
      } catch (error) { status.textContent = '导入失败：' + error.message; }
      finally { busy(false); }
    });
    actions.append(exportButton, importButton);
    group.append(hint, actions, input, status);
  }

  function persistSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => writeStore(STORAGE_KEY, settings), 180);
  }

  function installStaticStyles() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
    }

    const parent = document.head || document.documentElement;
    if (!parent) return false;
    if (style.parentNode !== parent) parent.appendChild(style);
    if (style.textContent === STATIC_CSS) return true;

    style.textContent = STATIC_CSS;
    return true;
  }

  function applySettings() {
    const root = document.documentElement;
    if (!root) return false;
    syncThemeMode();
    installStaticStyles();

    const enabled = (key) => Boolean(settings[overrideEnabledKey(key)]);
    const setOrRemove = (property, shouldApply, value) => {
      if (shouldApply) root.style.setProperty(property, value);
      else root.style.removeProperty(property);
    };
    const toggleOverrideAttr = (name, shouldApply) => root.toggleAttribute(name, Boolean(shouldApply));

    // Font-family is a stack, so Latin and CJK cannot be split perfectly once
    // one half is customized. If only one half is enabled, use ChatGPT's native
    // family stack as the other half rather than a userscript default. If both
    // halves are off, the font-family rule itself is disabled completely.
    const nativeFamily = (selector, attrName, fallback = 'system-ui') => {
      const had = root.hasAttribute(attrName);
      root.removeAttribute(attrName);
      let value = fallback;
      try {
        const target = document.querySelector(selector) || document.querySelector('main') || document.body || root;
        value = getComputedStyle(target).fontFamily || fallback;
      } catch (_) {}
      if (had) root.setAttribute(attrName, '');
      return value;
    };

    const latinEnabled = enabled('latinFont');
    const chineseEnabled = enabled('chineseFont');
    const bodyFontEnabled = latinEnabled || chineseEnabled;
    if (bodyFontEnabled) {
      const nativeBodyFont = (!latinEnabled || !chineseEnabled)
        ? nativeFamily(chatContentSelector, 'data-cgfc-body-font')
        : 'system-ui';
      root.style.setProperty('--cgfc-latin-font', latinEnabled
        ? stripGenericFontFallbacks(settings.latinFont, defaults.latinFont)
        : stripGenericFontFallbacks(nativeBodyFont, 'system-ui'));
      root.style.setProperty('--cgfc-chinese-font', chineseEnabled
        ? sanitizeFontStack(settings.chineseFont, defaults.chineseFont)
        : sanitizeFontStack(nativeBodyFont, 'system-ui'));
    } else {
      root.style.removeProperty('--cgfc-latin-font');
      root.style.removeProperty('--cgfc-chinese-font');
    }
    toggleOverrideAttr('data-cgfc-body-font', bodyFontEnabled);

    const boldLatinEnabled = enabled('boldLatinFont');
    const boldChineseEnabled = enabled('boldChineseFont');
    const boldFontEnabled = boldLatinEnabled || boldChineseEnabled;
    if (boldFontEnabled) {
      const nativeBoldFont = (!boldLatinEnabled || !boldChineseEnabled)
        ? nativeFamily(boldTextSelector, 'data-cgfc-bold-font')
        : 'system-ui';
      root.style.setProperty('--cgfc-bold-latin-font', boldLatinEnabled
        ? stripGenericFontFallbacks(settings.boldLatinFont, defaults.boldLatinFont)
        : stripGenericFontFallbacks(nativeBoldFont, 'system-ui'));
      root.style.setProperty('--cgfc-bold-chinese-font', boldChineseEnabled
        ? sanitizeFontStack(settings.boldChineseFont, defaults.boldChineseFont)
        : sanitizeFontStack(nativeBoldFont, 'system-ui'));
    } else {
      root.style.removeProperty('--cgfc-bold-latin-font');
      root.style.removeProperty('--cgfc-bold-chinese-font');
    }
    toggleOverrideAttr('data-cgfc-bold-font', boldFontEnabled);

    setOrRemove('--cgfc-code-font', enabled('codeFont'), sanitizeFontStack(settings.codeFont, defaults.codeFont));
    toggleOverrideAttr('data-cgfc-code-font', enabled('codeFont'));
    setOrRemove('--cgfc-math-font', enabled('mathFont'), sanitizeFontStack(settings.mathFont, defaults.mathFont));
    toggleOverrideAttr('data-cgfc-math-font', enabled('mathFont'));

    setOrRemove('--cgfc-font-size', enabled('fontSize'), `${normalizeSetting('fontSize', settings.fontSize)}px`);
    toggleOverrideAttr('data-cgfc-font-size', enabled('fontSize'));
    setOrRemove('--cgfc-thinking-overview-font-size', enabled('thinkingOverviewFontSize'), `${normalizeSetting('thinkingOverviewFontSize', settings.thinkingOverviewFontSize)}px`);
    toggleOverrideAttr('data-cgfc-thinking-overview-font-size', enabled('thinkingOverviewFontSize'));
    setOrRemove('--cgfc-citation-font-size', enabled('citationFontSize'), `${normalizeSetting('citationFontSize', settings.citationFontSize)}px`);
    toggleOverrideAttr('data-cgfc-citation-size', enabled('citationFontSize'));
    setOrRemove('--cgfc-web-citation-font-size', enabled('webCitationFontSize'), `${normalizeSetting('webCitationFontSize', settings.webCitationFontSize)}px`);
    toggleOverrideAttr('data-cgfc-web-citation-size', enabled('webCitationFontSize'));
    setOrRemove('--cgfc-formula-font-size', enabled('formulaFontSize'), `${normalizeSetting('formulaFontSize', settings.formulaFontSize)}px`);
    toggleOverrideAttr('data-cgfc-formula-font-size', enabled('formulaFontSize'));
    setOrRemove('--cgfc-line-height', enabled('lineHeight'), String(normalizeSetting('lineHeight', settings.lineHeight)));
    toggleOverrideAttr('data-cgfc-line-height', enabled('lineHeight'));
    setOrRemove('--cgfc-intelligent-font', enabled('intelligentFont'), sanitizeFontStack(settings.intelligentFont, defaults.intelligentFont));
    toggleOverrideAttr('data-cgfc-intelligent-font', enabled('intelligentFont'));
    for (const [key, suffix] of [
      ['intelligentFontSize', 'size'], ['intelligentTitleFontSize', 'title-size'],
      ['intelligentControlFontSize', 'control-size'], ['intelligentLineHeight', 'line-height'],
    ]) {
      const value = normalizeSetting(key, settings[key]);
      setOrRemove(`--cgfc-intelligent-${suffix}`, enabled(key), key === 'intelligentLineHeight' ? String(value) : `${value}px`);
      toggleOverrideAttr(`data-cgfc-intelligent-${suffix}`, enabled(key));
    }
    const adjustBodyColumn = enabled('bodyColumnLeftOffset') || enabled('bodyColumnRightOffset');
    setOrRemove('--cgfc-body-column-left-offset', enabled('bodyColumnLeftOffset'), `${normalizeSetting('bodyColumnLeftOffset', settings.bodyColumnLeftOffset)}px`);
    setOrRemove('--cgfc-body-column-right-offset', enabled('bodyColumnRightOffset'), `${normalizeSetting('bodyColumnRightOffset', settings.bodyColumnRightOffset)}px`);
    toggleOverrideAttr('data-cgfc-body-column-adjust', adjustBodyColumn);
    setOrRemove('--cgfc-code-font-size', enabled('codeFontSize'), `${normalizeSetting('codeFontSize', settings.codeFontSize)}px`);
    toggleOverrideAttr('data-cgfc-code-font-size', enabled('codeFontSize'));
    setOrRemove('--cgfc-code-line-height', enabled('codeLineHeight'), String(normalizeSetting('codeLineHeight', settings.codeLineHeight)));
    toggleOverrideAttr('data-cgfc-code-line-height', enabled('codeLineHeight'));
    setOrRemove('--cgfc-normal-color', enabled('normalColor'), normalizeSetting('normalColor', settings.normalColor));
    toggleOverrideAttr('data-cgfc-normal-color', enabled('normalColor'));
    setOrRemove('--cgfc-bold-color', enabled('boldColor'), normalizeSetting('boldColor', settings.boldColor));
    toggleOverrideAttr('data-cgfc-bold-color', enabled('boldColor'));
    setOrRemove('--cgfc-bold-weight', enabled('boldWeight'), String(normalizeSetting('boldWeight', settings.boldWeight)));
    toggleOverrideAttr('data-cgfc-bold-weight', enabled('boldWeight'));

    const smoothingEnabled = Boolean(settings.enableFontSmoothing) && enabled('fontSmoothingMode');
    setOrRemove('--cgfc-font-smoothing', smoothingEnabled, normalizeSetting('fontSmoothingMode', settings.fontSmoothingMode));
    setOrRemove('--cgfc-moz-font-smoothing', smoothingEnabled, getMozFontSmoothing(settings.fontSmoothingMode));
    toggleOverrideAttr('data-cgfc-font-smoothing-mode', smoothingEnabled);
    const textRenderingEnabled = Boolean(settings.enableFontSmoothing) && enabled('textRenderingMode');
    setOrRemove('--cgfc-text-rendering', textRenderingEnabled, normalizeSetting('textRenderingMode', settings.textRenderingMode));
    toggleOverrideAttr('data-cgfc-text-rendering-mode', textRenderingEnabled);
    root.removeAttribute('data-cgfc-font-smoothing');

    setOrRemove('--cgfc-formula-copy-border-color', enabled('formulaCopyBorderColor'), normalizeSetting('formulaCopyBorderColor', settings.formulaCopyBorderColor));
    setOrRemove('--cgfc-message-copy-icon-color', enabled('messageCopyIconColor'), normalizeSetting('messageCopyIconColor', settings.messageCopyIconColor));

    const applyWidgetBase = (prefix) => {
      setOrRemove(`--cgfc-${prefix}-font`, enabled(`${prefix}Font`), sanitizeFontStack(settings[`${prefix}Font`], defaults[`${prefix}Font`]));
      setOrRemove(`--cgfc-${prefix}-font-size`, enabled(`${prefix}FontSize`), `${normalizeSetting(`${prefix}FontSize`, settings[`${prefix}FontSize`])}px`);
      setOrRemove(`--cgfc-${prefix}-line-height`, enabled(`${prefix}LineHeight`), String(normalizeSetting(`${prefix}LineHeight`, settings[`${prefix}LineHeight`])));
      setOrRemove(`--cgfc-${prefix}-panel-width`, enabled(`${prefix}PanelWidth`), `${normalizeSetting(`${prefix}PanelWidth`, settings[`${prefix}PanelWidth`])}px`);
    };
    applyWidgetBase('toolbox');
    applyWidgetBase('queue');

    const applyWidgetPalette = (prefix) => {
      const textEnabled = enabled(`${prefix}TextColor`);
      const backgroundEnabled = enabled(`${prefix}BackgroundColor`);
      const accentEnabled = enabled(`${prefix}AccentColor`);
      const opacityEnabled = enabled(`${prefix}Opacity`);

      if (textEnabled) {
        const textColor = normalizeSetting(`${prefix}TextColor`, settings[`${prefix}TextColor`]);
        root.style.setProperty(`--cgfc-${prefix}-text-color`, textColor);
        root.style.setProperty(`--cgfc-${prefix}-muted-color`, colorWithAlpha(textColor, 0.68, defaults[`${prefix}TextColor`]));
      } else {
        root.style.removeProperty(`--cgfc-${prefix}-text-color`);
        root.style.removeProperty(`--cgfc-${prefix}-muted-color`);
      }

      setOrRemove(`--cgfc-${prefix}-accent-color`, accentEnabled, normalizeSetting(`${prefix}AccentColor`, settings[`${prefix}AccentColor`]));

      if (!backgroundEnabled && !opacityEnabled) {
        root.style.removeProperty(`--cgfc-${prefix}-panel-background`);
        if (prefix === 'toolbox') root.style.removeProperty('--cgfc-toolbox-launcher-background');
        return;
      }

      const opacity = normalizeSetting(`${prefix}Opacity`, settings[`${prefix}Opacity`]);
      let panelBackground;
      if (backgroundEnabled) {
        const background = normalizeSetting(`${prefix}BackgroundColor`, settings[`${prefix}BackgroundColor`]);
        panelBackground = opacityEnabled
          ? colorWithAlpha(background, opacity, defaults[`${prefix}BackgroundColor`])
          : background;
      } else {
        const percent = Math.round(opacity * 100);
        panelBackground = `color-mix(in srgb, var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #fff))) ${percent}%, transparent)`;
      }
      root.style.setProperty(`--cgfc-${prefix}-panel-background`, panelBackground);
      if (prefix === 'toolbox') {
        if (backgroundEnabled) {
          const background = normalizeSetting('toolboxBackgroundColor', settings.toolboxBackgroundColor);
          root.style.setProperty('--cgfc-toolbox-launcher-background', opacityEnabled
            ? colorWithAlpha(background, Math.min(1, opacity + 0.08), defaults.toolboxBackgroundColor)
            : background);
        } else {
          const percent = Math.round(Math.min(1, opacity + 0.08) * 100);
          root.style.setProperty('--cgfc-toolbox-launcher-background', `color-mix(in srgb, var(--cgfc-theme-surface-primary, var(--main-surface-primary, var(--bg-primary, #fff))) ${percent}%, transparent)`);
        }
      }
    };
    applyWidgetPalette('toolbox');
    applyWidgetPalette('queue');

    root.dataset.cgfcMathMode = enabled('mathFontMode')
      ? normalizeSetting('mathFontMode', settings.mathFontMode)
      : 'off';
    root.toggleAttribute('data-cgfc-wrap-code', settings.wrapCode);
    root.toggleAttribute('data-cgfc-katex-letter-font', settings.enableKatexLetterFont && enabled('mathFont'));
    root.toggleAttribute('data-cgfc-formula-copy', settings.enableFormulaCopy);
    root.toggleAttribute('data-cgfc-neumorphic-appearance', settings.enableNeumorphicAppearance);
    root.toggleAttribute('data-cgfc-ascii-ocean', settings.enableAsciiOcean);
    root.toggleAttribute('data-cgfc-ascii-pause-busy', settings.asciiOceanPauseWhileGenerating);
    root.setAttribute('data-cgfc-ascii-opacity', String(normalizeSetting('asciiOceanOpacity', settings.asciiOceanOpacity)));
    root.setAttribute('data-cgfc-ascii-fps', String(normalizeSetting('asciiOceanFps', settings.asciiOceanFps)));
    root.setAttribute('data-cgfc-ascii-species', normalizeSetting('asciiOceanSpecies', settings.asciiOceanSpecies));
    root.setAttribute('data-cgfc-ascii-coverage', normalizeSetting('asciiOceanCoverage', settings.asciiOceanCoverage));
    root.setAttribute('data-cgfc-ascii-home-coverage', normalizeSetting('asciiOceanHomeCoverage', settings.asciiOceanHomeCoverage));
    root.toggleAttribute('data-cgfc-ascii-pointer', settings.asciiOceanPointer);
    root.setAttribute('data-cgfc-ascii-density', String(normalizeSetting('asciiOceanDensity', settings.asciiOceanDensity)));
    root.setAttribute('data-cgfc-ascii-quality', normalizeSetting('asciiOceanQuality', settings.asciiOceanQuality));
    root.setAttribute('data-cgfc-ascii-renderer', normalizeSetting('asciiOceanRenderer', settings.asciiOceanRenderer));
    root.setAttribute('data-cgfc-ascii-motion-mode', normalizeSetting('asciiOceanMotionMode', settings.asciiOceanMotionMode));
    root.setAttribute('data-cgfc-ascii-color-mode', normalizeSetting('asciiOceanColorMode', settings.asciiOceanColorMode));
    root.setAttribute('data-cgfc-ascii-color-seed', String(normalizeSetting('asciiOceanColorSeed', settings.asciiOceanColorSeed)));
    for (const [key, attribute] of [['asciiOceanBodyColor', 'body'], ['asciiOceanAccentColor', 'accent'], ['asciiOceanFishColor', 'fish'], ['asciiOceanWakeColor', 'wake']]) root.setAttribute('data-cgfc-ascii-' + attribute + '-color', normalizeSetting(key, settings[key]));
    root.toggleAttribute('data-cgfc-message-glass', settings.enableAsciiOcean && settings.asciiOceanCoverage === 'glass');
    root.setAttribute('data-cgfc-message-glass-style', settings.messageGlassStyle);
    root.setAttribute('data-cgfc-message-glass-render-mode', settings.messageGlassRenderMode);
    root.toggleAttribute('data-cgfc-message-glass-custom-tint', settings.messageGlassTintMode === 'custom');
    const messageTint = normalizeSetting('messageGlassTint', settings.messageGlassTint);
    root.style.setProperty('--cgfc-message-glass-custom-rgb', [1,3,5].map(i => parseInt(messageTint.slice(i,i+2),16)).join(','));
    for (const [key, css] of [['Opacity','opacity'],['Blur','blur'],['Strength','strength'],['Thickness','thickness'],['Curvature','curvature'],['Bend','bend'],['Chroma','chroma'],['Glare','glare'],['Radius','radius'],['Saturation','saturation'],['Brightness','brightness']]) root.style.setProperty('--cgfc-message-glass-' + css, String(normalizeSetting('messageGlass' + key, settings['messageGlass' + key])) + (key === 'Radius' ? 'px' : ''));
    root.toggleAttribute('data-cgfc-liquid-glass', settings.enableComposerLiquidGlass);
    root.toggleAttribute('data-cgfc-toolbox-liquid-glass', settings.enableToolboxLiquidGlass);
    root.toggleAttribute('data-cgfc-settings-liquid-glass', settings.enableSettingsLiquidGlass);
    root.toggleAttribute('data-cgfc-queue-liquid-glass', settings.enableQueueLiquidGlass);
    root.toggleAttribute('data-cgfc-send-liquid-glass', settings.enableSendLiquidGlass);
    root.toggleAttribute('data-cgfc-scroll-liquid-glass', settings.enableScrollLiquidGlass);
    root.toggleAttribute('data-cgfc-token-liquid-glass', settings.enableTokenLiquidGlass);
    root.toggleAttribute('data-cgfc-toggle-liquid-glass', settings.enableToggleLiquidGlass);
    const glassEnabled = settings.enableComposerLiquidGlass || settings.enableToolboxLiquidGlass || settings.enableSettingsLiquidGlass || settings.enableQueueLiquidGlass || settings.enableSendLiquidGlass || settings.enableScrollLiquidGlass || settings.enableTokenLiquidGlass || settings.enableToggleLiquidGlass;
    if (glassEnabled) root.setAttribute('data-cgfc-glass-render-mode', normalizeSetting('glassRenderMode', settings.glassRenderMode));
    else root.removeAttribute('data-cgfc-glass-render-mode');
    if (glassEnabled) root.setAttribute('data-cgfc-glass-style', normalizeSetting('composerGlassStyle', settings.composerGlassStyle));
    else root.removeAttribute('data-cgfc-glass-style');
    setOrRemove('--cgfc-glass-strength', glassEnabled, String(normalizeSetting('composerGlassStrength', settings.composerGlassStrength)));
    setOrRemove('--cgfc-glass-blur', glassEnabled, String(normalizeSetting('composerGlassBlur', settings.composerGlassBlur)));
    setOrRemove('--cgfc-glass-opacity', glassEnabled, String(normalizeSetting('composerGlassOpacity', settings.composerGlassOpacity)));
    setOrRemove('--cgfc-glass-thickness', glassEnabled, String(normalizeSetting('composerGlassThickness', settings.composerGlassThickness)));
    setOrRemove('--cgfc-glass-glare', glassEnabled, String(normalizeSetting('composerGlassGlare', settings.composerGlassGlare)));
    setOrRemove('--cgfc-glass-chroma', glassEnabled, String(normalizeSetting('composerGlassChroma', settings.composerGlassChroma)));
    setOrRemove('--cgfc-glass-curvature', glassEnabled, String(normalizeSetting('composerGlassCurvature', settings.composerGlassCurvature)));
    setOrRemove('--cgfc-glass-bend', glassEnabled, String(normalizeSetting('composerGlassBend', settings.composerGlassBend)));
    root.toggleAttribute('data-cgpt-token-stats-enabled', settings.showTokenStats);
    root.toggleAttribute('data-cgpt-token-message-chips-enabled', settings.showTokenMessageChips);
    root.toggleAttribute('data-cgpt-token-summary-enabled', settings.showTokenSummary);
    root.setAttribute('data-cgpt-token-summary-position', normalizeSetting('tokenSummaryPosition', settings.tokenSummaryPosition));
    root.setAttribute('data-cgpt-token-summary-offset-x', String(normalizeSetting('tokenSummaryOffsetX', settings.tokenSummaryOffsetX)));
    root.setAttribute('data-cgpt-token-summary-offset-y', String(normalizeSetting('tokenSummaryOffsetY', settings.tokenSummaryOffsetY)));
    root.toggleAttribute('data-cgpt-token-summary-compact-always', settings.tokenSummaryCompactAlways);
    root.toggleAttribute('data-cgpt-token-summary-compact-narrow', settings.tokenSummaryCompactOnNarrow);
    root.toggleAttribute('data-cgpt-token-summary-avoid-queue', settings.tokenSummaryAvoidQueue);
    setOrRemove('--cgfc-token-summary-text-color', enabled('tokenSummaryTextColor'), normalizeSetting('tokenSummaryTextColor', settings.tokenSummaryTextColor));
    setOrRemove('--cgfc-token-summary-background-color', enabled('tokenSummaryBackgroundColor'), normalizeSetting('tokenSummaryBackgroundColor', settings.tokenSummaryBackgroundColor));
    setOrRemove('--cgfc-token-summary-border-color', enabled('tokenSummaryBorderColor'), normalizeSetting('tokenSummaryBorderColor', settings.tokenSummaryBorderColor));
    applyIndependentGlass(root);
    document.dispatchEvent(new CustomEvent('cgpt-unified-ui-settings-change'));
    return true;
  }

  function getPageWindow() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
    } catch (_) {
      // Fall back to the userscript window.
    }
    return window;
  }

  function installAutoScrollLock() {
    const win = getPageWindow();
    if (win.__cgfcAutoScrollLockInstalledV410) return;
    win.__cgfcAutoScrollLockInstalledV410 = true;

    const ElementCtor = win.Element || Element;
    const HTMLElementCtor = win.HTMLElement || HTMLElement;
    const elementProto = ElementCtor.prototype;
    const SEND_GUARD_MS = 2800;
    const POST_GENERATION_GUARD_MS = 3000;
    const NAVIGATION_END_GRACE_MS = 520;
    const SEND_BUTTON_SELECTOR = [
      '#composer-submit-button:not([data-testid="stop-button"])',
      'button[data-testid="send-button"]',
      'button[data-testid="composer-send-button"]',
      'button[aria-label*="send" i]',
      'button[aria-label*="发送" i]',
    ].join(',');
    const COMPOSER_EDITOR_SELECTOR = [
      '#prompt-textarea',
      'textarea[name="prompt-textarea"]',
      '.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]',
    ].join(',');

    const state = {
      generating: false,
      sendGuardUntil: 0,
      postGenerationUntil: 0,
      lastUserScrollAt: 0,
      scrollbarPointerId: null,
      windowY: 0,
      elements: new WeakMap(),
      settleTimer: 0,
      restoring: false,
      navigationActive: false,
      route: win.location.pathname,
      revision: 0,
      conversationRoot: null,
      conversationTop: 0,
      readingAnchor: null,
      generationCheckedAt: 0,
      generationStopButton: null,
      manualSnapshotFrame: 0,
    };

    function isUnifiedNavigationActive() {
      return document.documentElement?.hasAttribute('data-cgpt-unified-navigation-active') === true;
    }

    function isLockEnabled() {
      return Boolean(settings.stopAutoScrollWhileGenerating);
    }

    function isSendGuardActive() {
      return Date.now() < state.sendGuardUntil;
    }

    function isPostGenerationGuardActive() {
      return Date.now() < state.postGenerationUntil;
    }

    function isAutoScrollLockActive() {
      return state.generating || isSendGuardActive() || isPostGenerationGuardActive();
    }

    function snapshotPositions(captureAnchor = true) {
      state.revision++;
      state.windowY = win.scrollY || document.documentElement.scrollTop || 0;
      collectScrollableElements().forEach((el) => {
        state.elements.set(el, el.scrollTop || 0);
      });
      if (state.conversationRoot) state.conversationTop = state.conversationRoot.scrollTop || 0;
      const main = dom.main();
      const viewportTop = state.conversationRoot?.getBoundingClientRect().top || 0;
      const viewportBottom = state.conversationRoot
        ? viewportTop + state.conversationRoot.clientHeight : win.innerHeight;
      state.readingAnchor = null;
      if (!captureAnchor) return;
      // Hit testing is bounded by viewport probes, independent of history size.
      // Avoid reading thousands of offscreen paragraph rects on every wheel tick.
      const top = Math.max(0, viewportTop);
      const bottom = Math.min(win.innerHeight, viewportBottom);
      const width = document.documentElement.clientWidth;
      for (const ratio of [0.15, 0.35, 0.6, 0.85]) {
        const y = top + Math.max(1, bottom - top) * ratio;
        for (const xRatio of [0.5, 0.35, 0.65]) {
          const hits = document.elementsFromPoint(width * xRatio, y);
          for (const hit of hits) {
            if (!main?.contains(hit)) continue;
            const node = hit.closest('p, pre') || hit.closest(dom.message) || hit.closest(dom.turn);
            if (!node || !main.contains(node)) continue;
            const rect = node.getBoundingClientRect();
            if (rect.height <= 0 || rect.bottom <= top || rect.top >= bottom) continue;
            if (!state.readingAnchor || node.matches('p, pre')) state.readingAnchor = { node, y: rect.top };
            if (node.matches('p, pre')) return;
          }
        }
      }
    }

    function scheduleManualSnapshot() {
      // Invalidate already queued restorations immediately, capture the actual
      // gesture destination once per paint while the manual grace is active.
      state.revision++;
      if (state.manualSnapshotFrame) return;
      state.manualSnapshotFrame = win.requestAnimationFrame(() => {
        state.manualSnapshotFrame = 0;
        snapshotPositions(false);
      });
    }

    function isTypingTarget(target) {
      return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
    }

    function isComposerEditor(target) {
      return Boolean(target?.closest?.(COMPOSER_EDITOR_SELECTOR));
    }

    function isSendButton(target) {
      const button = target?.closest?.(SEND_BUTTON_SELECTOR);
      if (!(button instanceof HTMLElementCtor)) return false;
      if (button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return false;

      // Avoid accidentally treating unrelated “Send feedback” buttons elsewhere
      // on the page as a chat submission.
      const form = button.closest('form');
      if (form?.querySelector?.(COMPOSER_EDITOR_SELECTOR)) return true;
      const composerShell = button.closest('[data-testid*="composer"], [class*="composer"]');
      return Boolean(composerShell?.querySelector?.(COMPOSER_EDITOR_SELECTOR));
    }

    function armSendGuard() {
      if (!isLockEnabled()) return;
      scrollableCacheAt = 0;

      // Capture BEFORE ChatGPT handles the submit. This closes the small gap where
      // the UI scrolls to the newly appended turn before the stop/generating button
      // appears and the old generation detector notices it.
      if (!isAutoScrollLockActive()) snapshotPositions();
      state.sendGuardUntil = Math.max(state.sendGuardUntil, Date.now() + SEND_GUARD_MS);
      state.postGenerationUntil = 0;
    }

    function isSubmitKey(event) {
      if (event.key !== 'Enter' || event.isComposing) return false;
      if (event.shiftKey || event.altKey) return false;
      return isComposerEditor(event.target) || isComposerEditor(document.activeElement);
    }

    function markUserScroll(event) {
      if (!isLockEnabled() || !isAutoScrollLockActive()) return;
      if (event?.type === 'keydown') {
        const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
        if (!scrollKeys.has(event.key) || isTypingTarget(event.target)) return;
      }

      state.lastUserScrollAt = Date.now();
      scheduleManualSnapshot();
      win.clearTimeout(state.settleTimer);
      state.settleTimer = win.setTimeout(snapshotPositions, 360);
    }

    function isUserScrollWindowOpen() {
      return state.scrollbarPointerId !== null || Date.now() - state.lastUserScrollAt < USER_SCROLL_GRACE_MS;
    }

    function getTopArg(first, second, currentTop) {
      if (typeof first === 'object' && first !== null && typeof first.top === 'number') return first.top;
      if (typeof second === 'number') return second;
      if (typeof first === 'number') return first;
      return currentTop;
    }

    function getDeltaArg(first, second) {
      if (typeof first === 'object' && first !== null && typeof first.top === 'number') return first.top;
      if (typeof second === 'number') return second;
      return 0;
    }

    function shouldProtectViewport() {
      if (!isLockEnabled()) return false;
      syncRouteState();
      return isLockEnabled()
        && isAutoScrollLockActive()
        && !isUserScrollWindowOpen()
        && !isUnifiedNavigationActive();
    }

    function shouldBlockWindowTop(nextTop) {
      if (!shouldProtectViewport()) return false;
      return typeof nextTop === 'number' && Math.abs(nextTop - state.windowY) > 1;
    }

    function shouldBlockElementTop(el, nextTop) {
      if (!shouldProtectViewport()) return false;
      const baseline = getLockedElementTop(el);
      return typeof baseline === 'number' && typeof nextTop === 'number' && Math.abs(nextTop - baseline) > 1;
    }

    function getLockedElementTop(el) {
      const baseline = state.elements.get(el);
      if (typeof baseline !== 'number') return undefined;
      const anchor = state.readingAnchor;
      if (el === state.conversationRoot && anchor?.node.isConnected && el.contains(anchor.node)) {
        // Thinking panels can collapse above the viewport without a scroll API.
        // Preserve the visible text's screen offset, rather than an obsolete top.
        const top = el.scrollTop + anchor.node.getBoundingClientRect().top - anchor.y;
        return globalThis.__cgptUnifiedRuntimeV1?.dom?.clampScrollTop?.(el, top) ?? Math.max(0, top);
      }
      return globalThis.__cgptUnifiedRuntimeV1?.dom?.clampScrollTop?.(el, baseline) ?? baseline;
    }

    function handleScroll(event) {
      if (state.restoring) return;
      // Wheel/touch momentum and a held scrollbar can outlive the initial
      // gesture snapshot. Adopt the actual manual destination during its grace.
      if (isUserScrollWindowOpen() && (event.target === state.conversationRoot
        || event.target === document || event.target === document.documentElement)) {
        scheduleManualSnapshot();
        return;
      }
      if (!shouldProtectViewport()) return;

      const target = event.target;
      const isWindowScroll = target === document || target === document.documentElement || target === document.body;
      const currentTop = isWindowScroll ? win.scrollY || document.documentElement.scrollTop || 0 : target?.scrollTop;

      if (typeof currentTop !== 'number') return;
      const baseline = isWindowScroll ? state.windowY : getLockedElementTop(target);
      if (typeof baseline !== 'number' || Math.abs(currentTop - baseline) <= 1) return;

      state.restoring = true;
      const revision = state.revision;
      win.requestAnimationFrame(() => {
        // A user gesture, TOC jump or route change may occur before this frame.
        // Never restore a snapshot belonging to the previous reading position.
        syncRouteState();
        if (revision === state.revision && shouldProtectViewport()) {
          if (isWindowScroll) win.scrollTo({ top: baseline, behavior: 'instant' });
          else if (target instanceof HTMLElementCtor && target.isConnected) {
            state.elements.set(target, baseline);
            if (target === state.conversationRoot) state.conversationTop = baseline;
            target.scrollTop = baseline;
          }
        }
        win.requestAnimationFrame(() => {
          state.restoring = false;
        });
      });
    }

    function isScrollableElement(el) {
      if (!(el instanceof HTMLElementCtor) || !el.isConnected) return false;
      const style = win.getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`)) return false;
      return el.scrollHeight > el.clientHeight + 24;
    }

    let scrollableCache = [], scrollableCacheAt = 0;
    function collectScrollableElements() {
      const time = Date.now();
      if (time - scrollableCacheAt < 500 && state.conversationRoot?.isConnected
        && scrollableCache.every(el => el.isConnected)) return scrollableCache;
      scrollableCacheAt = time;
      const root = document.body || document.documentElement;
      if (!root) return [];
      // Walk actual feed ancestors, including overflow containers which have no
      // scrollbar yet. A new chat acquires overflow only after its first turn.
      const main = dom.main();
      const probe = main?.querySelector('[data-testid^="conversation-turn-"], [data-turn-key]') || main;
      const elements = new Set();
      let conversationRoot = null;
      for (let el = probe; el instanceof HTMLElementCtor; el = el.parentElement) {
        const style = win.getComputedStyle(el);
        if (/(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`)) {
          elements.add(el);
          if (!conversationRoot) conversationRoot = el;
        }
      }
      if (conversationRoot !== state.conversationRoot) {
        const previous = state.conversationRoot;
        state.conversationRoot = conversationRoot;
        if (conversationRoot) {
          const top = previous && !previous.isConnected && shouldProtectViewport()
            ? state.conversationTop : conversationRoot.scrollTop || 0;
          state.elements.set(conversationRoot, top);
          state.conversationTop = top;
          if (Math.abs((conversationRoot.scrollTop || 0) - top) > 1) {
            handleScroll({ target: conversationRoot });
          }
        }
      }
      scrollableCache = Array.from(elements);
      return scrollableCache;
    }

    function syncRouteState() {
      const route = win.location.pathname;
      if (route === state.route) return;
      // First submit promotes / (or a GPT landing page) to /c/id. Retain its
      // pre-submit baseline, but discard all baselines on other chat switches.
      const promotedNewChat = !/\/c\//.test(state.route) && /\/c\//.test(route)
        && isAutoScrollLockActive();
      state.route = route;
      scrollableCacheAt = 0;
      state.revision++;
      if (promotedNewChat) return;
      state.generating = false;
      state.sendGuardUntil = 0;
      state.postGenerationUntil = 0;
      state.elements = new WeakMap();
      state.conversationRoot = null;
      state.conversationTop = 0;
      state.readingAnchor = null;
      win.clearTimeout(state.settleTimer);
      snapshotPositions();
    }

    function markScrollbarDrag(event) {
      if (event.button !== 0 && event.button !== 1) return;
      const target = event.composedPath?.().find((node) => node instanceof HTMLElementCtor && isScrollableElement(node));
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const nearVerticalScrollbar = event.clientX >= rect.right - 22;
      if (event.button === 1 || nearVerticalScrollbar) {
        state.scrollbarPointerId = event.pointerId;
        markUserScroll(event);
      }
    }

    function releaseScrollbarDrag(event) {
      if (state.scrollbarPointerId === null) return;
      if (event.type !== 'blur' && event.pointerId !== state.scrollbarPointerId) return;
      state.scrollbarPointerId = null;
      markUserScroll(event);
    }

    function isVisible(el) {
      if (!(el instanceof HTMLElementCtor) || !el.isConnected) return false;
      const rect = el.getBoundingClientRect();
      const style = win.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }

    function isGenerating() {
      const directStop = document.querySelector(
        '[data-testid="stop-button"], [data-testid="composer-stop-button"], [data-testid*="stop-generating"]'
      );
      state.generationStopButton = null;
      if (directStop && isVisible(directStop)) { state.generationStopButton = directStop; return true; }

      const composer = document.querySelector(COMPOSER_EDITOR_SELECTOR)?.closest('form, [data-chatgpt-composer], [data-testid*="composer"], [class*="composer"]');
      const buttons = composer?.querySelectorAll('button, [role="button"]') || [];
      for (const button of buttons) {
        if (!isVisible(button)) continue;
        const label = [
          button.getAttribute('aria-label') || '',
          button.getAttribute('title') || '',
          button.getAttribute('data-testid') || '',
          button.textContent || '',
        ].join(' ');

        if (/\b(?:stop (?:generating|streaming|response)|generating)\b|停止(?:生成|回答|流式传输|输出)|中止生成|生成中/i.test(label)
          || /^(?:停止|stop)$/i.test((button.getAttribute('aria-label') || '').trim())) {
          state.generationStopButton = button;
          return true;
        }
      }
      // The queue's detector also recognises the latest response's thinking,
      // tool/status and streaming markers when the composer stop button is absent.
      return globalThis.__cgptUnifiedRuntimeV1?.readQueueResponseState?.({ busyOnly: true }).busy === true;
    }

    function syncNavigationState() {
      const active = isUnifiedNavigationActive();
      if (active === state.navigationActive) return;
      state.navigationActive = active;

      if (active) {
        state.revision++;
        // Navigation has explicit priority. Do not fight a TOC jump with the
        // pre-send/generation baseline.
        return;
      }

      // Once the lease ends, adopt the destination as the new baseline. If a
      // response is still streaming, subsequent ChatGPT auto-follow attempts are
      // blocked relative to the place the user intentionally navigated to.
      snapshotPositions();
      state.lastUserScrollAt = Date.now() - USER_SCROLL_GRACE_MS + NAVIGATION_END_GRACE_MS;
    }

    function refreshGenerationState() {
      if (!isLockEnabled()) {
        state.generating = false; state.sendGuardUntil = 0; state.postGenerationUntil = 0;
        state.generationStopButton = null;
        return;
      }
      state.generationCheckedAt = Date.now();
      syncRouteState();
      const nextGenerating = isGenerating();
      const wasGenerating = state.generating;

      if (nextGenerating && !wasGenerating) {
        // If submit guard is already armed, its pre-submit snapshot is the one we
        // want. Re-snapshotting here would capture ChatGPT's unwanted jump.
        if (!isSendGuardActive() && !isPostGenerationGuardActive() && !isUnifiedNavigationActive()) {
          snapshotPositions();
        }
        state.postGenerationUntil = 0;
      }

      state.generating = nextGenerating;

      if (!nextGenerating && wasGenerating) {
        // Keep a short tail guard because ChatGPT and the performance module can
        // perform final layout/scroll work just after the stop button disappears.
        state.postGenerationUntil = Date.now() + POST_GENERATION_GUARD_MS;
      }
    }

    function tagWrapper(fn) {
      try {
        Object.defineProperty(fn, '__cgfcAutoScrollLockWrapper', { value: true });
      } catch (_) {
        fn.__cgfcAutoScrollLockWrapper = true;
      }
      return fn;
    }

    function isWrapped(fn) {
      return Boolean(fn && fn.__cgfcAutoScrollLockWrapper);
    }

    function installWrapper(target, key, createWrapper) {
      try {
        const current = target?.[key];
        if (typeof current !== 'function' || isWrapped(current)) return;
        target[key] = tagWrapper(createWrapper(current));
      } catch (_) {
        // Some page realms expose non-writable host methods. Scroll-event
        // recovery still works even when a particular API cannot be wrapped.
      }
    }

    function wrapScrollApis() {
      installWrapper(win, 'scrollTo', (original) => function (first, second) {
        const nextTop = getTopArg(first, second, win.scrollY || 0);
        if (shouldBlockWindowTop(nextTop)) return original.call(win, 0, state.windowY);
        return original.apply(win, arguments);
      });

      installWrapper(win, 'scroll', (original) => function (first, second) {
        const nextTop = getTopArg(first, second, win.scrollY || 0);
        if (shouldBlockWindowTop(nextTop)) return original.call(win, 0, state.windowY);
        return original.apply(win, arguments);
      });

      installWrapper(win, 'scrollBy', (original) => function (first, second) {
        const delta = getDeltaArg(first, second);
        if (shouldBlockWindowTop((win.scrollY || 0) + delta)) return original.call(win, 0, 0);
        return original.apply(win, arguments);
      });

      installWrapper(elementProto, 'scrollTo', (original) => function (first, second) {
        const nextTop = getTopArg(first, second, this.scrollTop || 0);
        if (shouldBlockElementTop(this, nextTop)) return;
        return original.apply(this, arguments);
      });

      installWrapper(elementProto, 'scroll', (original) => function (first, second) {
        const nextTop = getTopArg(first, second, this.scrollTop || 0);
        if (shouldBlockElementTop(this, nextTop)) return;
        return original.apply(this, arguments);
      });

      installWrapper(elementProto, 'scrollBy', (original) => function (first, second) {
        const delta = getDeltaArg(first, second);
        if (shouldBlockElementTop(this, (this.scrollTop || 0) + delta)) return;
        return original.apply(this, arguments);
      });

      installWrapper(elementProto, 'scrollIntoView', (original) => function (options) {
        if (!shouldProtectViewport()) return original.call(this, options);

        // Even a visible element can jump to the top with block: 'start'. Only
        // intercept elements belonging to the conversation scroll chain.
        const main = dom.main();
        if (!main?.contains(this)) return original.call(this, options);
      });
    }

    // Share the same generation detector and pre-submit scroll guard with the
    // message queue. Programmatic button.click() does not emit pointerdown, so the
    // queue explicitly arms this guard before requesting submission.
    const coordinatorRuntime = globalThis.__cgptUnifiedRuntimeV1;
    if (coordinatorRuntime) {
      coordinatorRuntime.isGenerating = isGenerating;
      coordinatorRuntime.armSendGuard = armSendGuard;
    }

    // Arm before ChatGPT's own handlers run. `submit` is the semantic path;
    // pointerdown and Enter are early fallbacks for React/composer variants that
    // mutate the conversation before a native submit event is observable.
    document.addEventListener('submit', (event) => {
      const form = event.target;
      if (form instanceof ElementCtor && form.querySelector?.(COMPOSER_EDITOR_SELECTOR)) armSendGuard();
    }, true);

    document.addEventListener('pointerdown', (event) => {
      if (isSendButton(event.target)) armSendGuard();
    }, true);

    document.addEventListener('click', (event) => {
      if (isSendButton(event.target)) armSendGuard();
    }, true);

    document.addEventListener('keydown', (event) => {
      if (isSubmitKey(event)) armSendGuard();
    }, true);

    ['wheel', 'touchstart', 'touchmove', 'keydown'].forEach((eventName) => {
      win.addEventListener(eventName, markUserScroll, { capture: true, passive: true });
    });
    win.addEventListener('pointerdown', markScrollbarDrag, { capture: true, passive: true });
    for (const type of ['pointerup', 'pointercancel', 'blur']) {
      win.addEventListener(type, releaseScrollbarDrag, { capture: true, passive: true });
    }
    document.addEventListener('scroll', handleScroll, { capture: true, passive: true });

    wrapScrollApis();
    refreshAutoScrollLockState = () => {
      syncNavigationState();
      refreshGenerationState();
    };

    let generationRefreshTimer = 0, pendingGenerationRefresh = false;
    const lockOwnUI = '#cgfc-panel, #cgfc-toggle, #cgpt-answer-toc-host, #cgpt-unified-queue-dock, #cgfc-formula-copy-toast, [data-cgpt-token-chip], .cgpt-unified-copy-message-md';
    const queueStateRefresh = (records) => {
      if (!isLockEnabled()) return;
      const liveStop = state.generating && state.generationStopButton?.isConnected;
      let relevant = false, checkGeneration = false;
      for (const record of records) {
        const target = record.target instanceof ElementCtor ? record.target : record.target.parentElement;
        if (target?.closest(lockOwnUI)) continue;
        const changed = [...(record.addedNodes || []), ...(record.removedNodes || [])];
        if (record.type === 'childList' && changed.length && changed.every(node => node instanceof ElementCtor && node.matches(lockOwnUI))) continue;
        relevant = true;
        // A live stop button already proves that the answer is still busy.
        // Text/paragraph insertions inside that answer cannot change this fact.
        // Composer changes, button removal/hiding and routes still check promptly.
        if (!liveStop || !target?.closest(dom.assistant)) checkGeneration = true;
      }
      if (!relevant) return;
      pendingGenerationRefresh ||= checkGeneration;
      if (generationRefreshTimer || (!pendingGenerationRefresh && !shouldProtectViewport())) return;
      generationRefreshTimer = win.setTimeout(() => {
        generationRefreshTimer = 0;
        const check = pendingGenerationRefresh; pendingGenerationRefresh = false;
        if (!isLockEnabled()) return;
        syncNavigationState();
        syncRouteState();
        if (check) refreshGenerationState();
        if (!shouldProtectViewport()) return;
        collectScrollableElements();
        if (state.conversationRoot) handleScroll({ target: state.conversationRoot });
      }, 36);
    };
    const observer = new MutationObserver(queueStateRefresh);

    const start = () => {
      syncNavigationState();
      refreshGenerationState();
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'aria-label',
          'data-testid',
          'disabled',
          'data-cgpt-unified-navigation-active',
          'hidden', 'aria-hidden', 'class', 'aria-busy', 'data-is-streaming', 'data-is-generating',
        ],
      });
      win.setInterval(() => {
        syncNavigationState();
        syncRouteState();
        if (!isLockEnabled()) return;
        if (Date.now() - state.generationCheckedAt >= GENERATION_CHECK_MS) refreshGenerationState();
        if (!shouldProtectViewport()) return;
        collectScrollableElements();
        if (state.conversationRoot) handleScroll({ target: state.conversationRoot });
      }, 200);
      win.setInterval(wrapScrollApis, API_GUARD_MS);
    };

    onReady(start);
  }

  function startCitationTypography() {
    let scanTimer = 0;
    const pendingRoots = new Set();
    const scan = (scope) => {
      const selector = `${citationCandidateSelector}, [data-cgfc-citation], [data-cgfc-web-citation]`;
      const roots = scope ? [scope] : document.querySelectorAll('main, [role="main"]');
      const candidates = new Set();
      for (const root of roots) {
        if (!root.isConnected) continue;
        if (root.matches(selector)) candidates.add(root);
        for (const element of root.querySelectorAll(selector)) candidates.add(element);
      }
      for (const element of candidates) {
        const inResponse = Boolean(element.closest(`${dom.assistant}, ${dom.turn}`));
        const excluded = Boolean(element.closest(citationExcludedSelector));
        const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
        // Some file pills expose only a Radix trigger/clickable span. Restrict
        // this fallback to short interactive filenames, never prose or code.
        const fileTrigger = element.matches(citationCandidateSelector)
          && !element.closest('[role="radiogroup"], [role="radio"], [role="checkbox"], [role="tablist"], [role="option"]')
          && text.length > 0 && text.length <= 240
          && /\.(?:pdf|md|markdown|txt|docx?|xlsx?|pptx?|csv|tsv|json|ya?ml|rtf|epub)(?:\s*[）)]?)$/i.test(text);
        const webCitation = inResponse && !excluded && element.matches(webCitationHostSelector);
        // Do not apply the file setting again to descendants of a web source.
        const citation = inResponse && !excluded && !element.closest(webCitationHostSelector)
          && (element.matches(citationHostSelector) || fileTrigger);
        if (element.hasAttribute('data-cgfc-citation') !== citation) {
          element.toggleAttribute('data-cgfc-citation', citation);
        }
        if (element.hasAttribute('data-cgfc-web-citation') !== webCitation) {
          element.toggleAttribute('data-cgfc-web-citation', webCitation);
        }
      }
    };
    const queueScan = (node) => {
      if (!(node instanceof Element) || !node.isConnected) return;
      for (const root of pendingRoots) if (root.contains(node)) return;
      for (const root of pendingRoots) if (node.contains(root)) pendingRoots.delete(root);
      pendingRoots.add(node);
      if (scanTimer) return;
      scanTimer = setTimeout(() => {
        scanTimer = 0;
        const roots = [...pendingRoots]; pendingRoots.clear();
        for (const root of roots) scan(root);
      }, 120);
    };
    onReady(() => {
      scan();
      new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
          if (!target?.closest('main, [role="main"]')) {
            for (const added of mutation.addedNodes || []) if (added instanceof Element && (added.matches('main, [role="main"]') || added.querySelector('main, [role="main"]'))) queueScan(added);
            continue;
          }
          const citation = target.closest(citationCandidateSelector + ', [data-cgfc-citation], [data-cgfc-web-citation]');
          if (citation) queueScan(citation);
          if (mutation.type === 'attributes') {
            if (target.matches(citationCandidateSelector + ', [data-cgfc-citation], [data-cgfc-web-citation]')) queueScan(target);
          } else if (mutation.type === 'childList') {
            for (const added of mutation.addedNodes) if (added instanceof Element) queueScan(added);
          }
        }
      }).observe(document.documentElement, {
        childList: true, characterData: true, subtree: true, attributes: true,
        attributeFilter: ['data-testid', 'data-citation', 'data-citation-id', 'data-citation-type', 'data-d-component', 'data-d-inline-text', 'data-pill', 'data-state', 'role', 'class'],
      });
    });
  }

  function updateSetting(key, value) {
    settings = { ...settings, [key]: normalizeSetting(key, value) };
    if (key === 'citationFontSize' || key === 'webCitationFontSize') {
      settings[overrideEnabledKey(key)] = true;
      const control = document.querySelector(`.cgfc-control[data-override-key="${key}"]`);
      if (control) syncOverrideVisual(control, key);
    }
    if (key.startsWith('intelligent') && OVERRIDEABLE_SETTING_KEYS.has(key)) {
      settings[overrideEnabledKey(key)] = true;
      const control = document.querySelector(`.cgfc-control[data-override-key="${key}"]`);
      if (control) syncOverrideVisual(control, key);
    }
    applySettings();
    persistSoon();

    if (key === 'stopAutoScrollWhileGenerating') refreshAutoScrollLockState();
    if (key === 'enableResidualLatex' && settings.enableResidualLatex) {
      installKatexCss();
      scanAssistantRoots();
    }
  }

  function quoteFontFamily(family) {
    const safe = String(family || '').replace(/["\\<>\u0000-\u001f\u007f]/g, '').trim();
    return safe ? `"${safe}"` : '';
  }

  function primaryFontFamily(value) {
    return String(value || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
  }

  function fontAppearsAvailable(family) {
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return false;
      const probe = 'mmmmmmmmmmlliWW00汉字α∑∫';
      const fallbacks = ['monospace', 'serif', 'sans-serif'];
      return fallbacks.some((fallback) => {
        context.font = `72px ${fallback}`;
        const baseline = context.measureText(probe).width;
        context.font = `72px ${quoteFontFamily(family)}, ${fallback}`;
        return Math.abs(context.measureText(probe).width - baseline) > 0.1;
      });
    } catch (_) {
      return false;
    }
  }

  function sanitizeFontFamilyName(value) {
    if (typeof value !== 'string') return '';
    const text = value
      .normalize?.('NFKC')
      .replace(/[\u0000-\u001f\u007f<>"\\;]/g, '')
      .split('{').join('')
      .split('}').join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
    if (!text || text === 'undefined' || text === 'null') return '';
    return text;
  }

  function normalizeFontSearchText(value) {
    const text = sanitizeFontFamilyName(value)
      .toLocaleLowerCase('zh-Hans')
      .replace(/[‐‑‒–—―−]/g, '-')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text;
  }

  function fontSearchVariants(value) {
    const normalized = normalizeFontSearchText(value);
    if (!normalized) return [];
    const variants = new Set([normalized, normalized.replace(/\s+/g, '')]);
    // Windows CJK families can report either traditional 書 or simplified 书.
    // This conservative pair is enough to bridge localized labels without
    // inventing unrelated transliterations.
    variants.add(normalized.replace(/書/g, '书'));
    variants.add(normalized.replace(/书/g, '書'));
    variants.add(normalized.replace(/書/g, '书').replace(/\s+/g, ''));
    variants.add(normalized.replace(/书/g, '書').replace(/\s+/g, ''));
    return Array.from(variants).filter(Boolean);
  }

  function isVerifiedFontSource(source) {
    return source === 'local-font-access' || source === 'extension' || source === 'local-face';
  }

  function addDetectedFontCandidate(candidate, aliases = [], source = 'candidate') {
    const object = candidate && typeof candidate === 'object' ? candidate : { family: candidate };
    const canonical = sanitizeFontFamilyName(object.family || object.canonical || object.fontId || object.displayName);
    if (!canonical) return false;

    if (!detectedFontAliases.has(canonical)) detectedFontAliases.set(canonical, new Set());
    const aliasSet = detectedFontAliases.get(canonical);
    [
      canonical,
      object.displayName,
      object.fullName,
      object.postscriptName,
      object.localizedName,
      object.style,
      object.fontId,
      ...(Array.isArray(aliases) ? aliases : []),
      ...(Array.isArray(object.aliases) ? object.aliases : []),
    ]
      .map(sanitizeFontFamilyName)
      .filter(Boolean)
      .forEach((alias) => aliasSet.add(alias));

    const displayLabel = sanitizeFontFamilyName(
      object.displayName || object.localizedName || object.fullName || canonical,
    );
    const previousLabel = detectedFontLabels.get(canonical);
    if (displayLabel && (!previousLabel || isVerifiedFontSource(source))) {
      detectedFontLabels.set(canonical, displayLabel);
    } else if (!previousLabel) {
      detectedFontLabels.set(canonical, canonical);
    }

    if (isVerifiedFontSource(source)) verifiedFontFamilies.add(canonical);
    else fallbackFontFamilies.add(canonical);
    return true;
  }

  function mergeDetectedFontFamilies(families, source = 'candidate') {
    const configured = Array.from(FONT_SETTING_KEYS, (key) => primaryFontFamily(settings[key])).filter(Boolean);
    configured.forEach((candidate) => addDetectedFontCandidate(candidate, [], 'configured'));
    (Array.isArray(families) ? families : []).forEach((candidate) => addDetectedFontCandidate(candidate, [], source));
    detectedFontFamilies = Array.from(detectedFontAliases.keys())
      .sort((left, right) => left.localeCompare(right, ['zh-Hans', 'en'], { sensitivity: 'base', numeric: true }));
  }

  function getSelectableFontFamilies() {
    // Once a real browser/extension/local() scan succeeds, only show verified
    // installed families. The historical Windows snapshot remains in memory as
    // a fallback, but can no longer pollute an authoritative result.
    if ((fontDetectionMode === 'full-api' || fontDetectionMode === 'verified-fallback') && verifiedFontFamilies.size) {
      return Array.from(verifiedFontFamilies)
        .sort((left, right) => left.localeCompare(right, ['zh-Hans', 'en'], { sensitivity: 'base', numeric: true }));
    }
    return detectedFontFamilies;
  }

  function fontOptionLabel(family) {
    const display = detectedFontLabels.get(family) || family;
    if (!display || normalizeFontSearchText(display) === normalizeFontSearchText(family)) return family;
    return `${display}（${family}）`;
  }

  function detectKnownLocalFonts() {
    mergeDetectedFontFamilies(
      KNOWN_LOCAL_FONT_CANDIDATES.filter(fontAppearsAvailable),
      'canvas-candidate',
    );
    // Keep the generated snapshot as a no-permission safety net. It is never
    // treated as authoritative and disappears from the picker after a verified
    // scan succeeds.
    mergeDetectedFontFamilies(WINDOWS_FONT_FAMILY_SNAPSHOT, 'windows-snapshot');
    if (fontDetectionMode !== 'full-api' && fontDetectionMode !== 'verified-fallback') {
      fontDetectionMode = 'candidate';
    }
    return detectedFontFamilies;
  }

  function escapeCssLocalName(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  async function fontFaceLocalAppearsAvailable(family) {
    if (typeof FontFace !== 'function') return null;
    const safeFamily = sanitizeFontFamilyName(family);
    if (!safeFamily) return false;
    const probeFamily = `cgfc-probe-${createBridgeToken('font').replace(/[^a-z0-9-]/gi, '')}`;
    let timer = 0;
    try {
      const face = new FontFace(probeFamily, `local("${escapeCssLocalName(safeFamily)}")`);
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('font probe timeout')), FONT_FACE_VERIFY_TIMEOUT_MS);
      });
      await Promise.race([face.load(), timeout]);
      return face.status === 'loaded';
    } catch (_) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function verifyKnownFontCandidatesWithLocalFace() {
    const candidates = Array.from(new Set([
      ...Array.from(FONT_SETTING_KEYS, (key) => primaryFontFamily(settings[key])).filter(Boolean),
      ...KNOWN_LOCAL_FONT_CANDIDATES,
      ...LOCAL_FONT_RESCUE_CANDIDATE_NAMES,
      ...WINDOWS_FONT_FAMILY_SNAPSHOT,
    ].map(sanitizeFontFamilyName).filter(Boolean)));

    if (typeof FontFace !== 'function' || !candidates.length) return { supported: false, records: [] };

    const records = [];
    let index = 0;
    const worker = async () => {
      while (index < candidates.length) {
        const currentIndex = index++;
        const family = candidates[currentIndex];
        const available = await fontFaceLocalAppearsAvailable(family);
        if (available) records.push({ family, displayName: family });
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(FONT_FACE_VERIFY_CONCURRENCY, candidates.length) },
      () => worker(),
    ));
    return { supported: true, records };
  }

  function verifiedFontSearchKeys() {
    const keys = new Set();
    for (const family of verifiedFontFamilies) {
      fontSearchVariants(family).forEach((variant) => keys.add(variant));
      const aliases = detectedFontAliases.get(family) || new Set();
      for (const alias of aliases) fontSearchVariants(alias).forEach((variant) => keys.add(variant));
    }
    return keys;
  }

  async function verifyRescueFontCandidates() {
    if (typeof FontFace !== 'function') return { supported: false, records: [] };
    const knownKeys = verifiedFontSearchKeys();
    const records = [];

    const groupAlreadyKnown = (group) => group.names.some((name) =>
      fontSearchVariants(name).some((variant) => knownKeys.has(variant)),
    );

    let groupIndex = 0;
    const worker = async () => {
      while (groupIndex < LOCAL_FONT_RESCUE_GROUPS.length) {
        const currentIndex = groupIndex++;
        const group = LOCAL_FONT_RESCUE_GROUPS[currentIndex];
        if (groupAlreadyKnown(group)) continue;

        for (const rawName of group.names) {
          const family = sanitizeFontFamilyName(rawName);
          if (!family) continue;
          const available = await fontFaceLocalAppearsAvailable(family);
          if (!available) continue;
          records.push({
            family,
            displayName: group.label,
            aliases: group.names,
          });
          fontSearchVariants(family).forEach((variant) => knownKeys.add(variant));
          group.names.flatMap(fontSearchVariants).forEach((variant) => knownKeys.add(variant));
          break;
        }
      }
    };

    await Promise.all(Array.from(
      { length: Math.min(3, LOCAL_FONT_RESCUE_GROUPS.length) },
      () => worker(),
    ));
    return { supported: true, records };
  }

  function populateFontSelect(select) {
    if (!(select instanceof HTMLSelectElement)) return;
    const key = select.dataset.key;
    const current = settings[key];
    select.replaceChildren();

    const values = new Set();
    const appendOption = (value, label, family) => {
      if (!value || values.has(value)) return;
      values.add(value);
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      if (family) option.style.fontFamily = quoteFontFamily(family);
      select.appendChild(option);
    };

    appendOption(current, `当前：${primaryFontFamily(current) || current}`, primaryFontFamily(current));
    const normalizedQuery = fontSearchVariants(fontSearchQuery);
    getSelectableFontFamilies()
      .filter((family) => {
        if (!normalizedQuery.length) return true;
        const aliases = detectedFontAliases.get(family) || new Set([family]);
        const searchable = Array.from(aliases).flatMap(fontSearchVariants);
        return normalizedQuery.some((query) => searchable.some((alias) => alias.includes(query)));
      })
      // Values always remain CSS family names. Full names, PostScript names and
      // style/localized names are display/search aliases only.
      .forEach((family) => appendOption(family, fontOptionLabel(family), family));
    select.value = current;
  }

  function refreshFontSelects() {
    document.querySelectorAll(`#${PANEL_ID} select[data-font-picker="true"]`).forEach(populateFontSelect);
  }

  function setFontScanStatus(message, isError = false) {
    const status = document.getElementById(FONT_STATUS_ID);
    if (!status) return;
    status.textContent = message;
    status.toggleAttribute('data-error', isError);
  }

  function fontDetectionStatusText() {
    const selectable = getSelectableFontFamilies();
    if (fontSearchQuery) {
      const queryVariants = fontSearchVariants(fontSearchQuery);
      const count = selectable.filter((family) => {
        const aliases = detectedFontAliases.get(family) || new Set([family]);
        const searchable = Array.from(aliases).flatMap(fontSearchVariants);
        return queryVariants.some((query) => searchable.some((alias) => alias.includes(query)));
      }).length;
      const extensionText = lastExtensionStatus === 'ok'
        ? `扩展 ${lastExtensionFontCount} 个家族`
        : '扩展未检测到';
      return `搜索“${fontSearchQuery}”：匹配 ${count} / ${selectable.length} 个可选字体家族；浏览器 API ${lastApiFontCount} 个家族；${extensionText}。`;
    }
    if (fontDetectionMode === 'full-api') {
      const extensionText = lastExtensionStatus === 'ok'
        ? `；扩展补充 ${lastExtensionFontCount} 个家族`
        : '';
      const rescueText = lastRescueVerifiedCount
        ? `；local() 补探测 ${lastRescueVerifiedCount} 个`
        : '';
      const faceText = lastApiFontFaceCount > lastApiFontCount
        ? `（${lastApiFontFaceCount} 个字体文件/字重）`
        : '';
      return `精确扫描成功：浏览器读取 ${lastApiFontCount} 个本机字体家族${faceText}${rescueText}${extensionText}；当前仅显示已验证字体，共 ${selectable.length} 个。`;
    }
    if (fontDetectionMode === 'verified-fallback') {
      const rescueText = lastRescueVerifiedCount ? `；额外补探测 ${lastRescueVerifiedCount} 个` : '';
      return `浏览器 Local Font Access 未成功，已用 CSS local() 逐个验证 ${lastFallbackVerifiedCount} 个真实可用字体${rescueText}；当前仅显示验证通过的 ${selectable.length} 个。`;
    }
    return `已载入 Windows 字体候选快照 ${WINDOWS_FONT_FAMILY_SNAPSHOT.length} 个；当前列表共 ${detectedFontFamilies.length} 个候选家族。点击“扫描全部本机字体”后会优先改为真实本机字体列表。`;
  }

  function applyFontSearch(value) {
    fontSearchQuery = String(value || '').trim();
    refreshFontSelects();
    setFontScanStatus(fontDetectionStatusText());
  }

  function createBridgeToken(prefix) {
    const randomPart = (() => {
      try {
        const bytes = new Uint32Array(2);
        if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
        return Array.from(bytes).map((value) => value.toString(36)).join('');
      } catch (_) {
        return Math.random().toString(36).slice(2);
      }
    })();
    return `${prefix}-${Date.now().toString(36)}-${randomPart}`.slice(0, 180);
  }

  function sanitizeExtensionFontRecords(payload) {
    const raw = Array.isArray(payload) ? payload : payload?.fonts;
    if (!Array.isArray(raw)) return [];
    const records = [];
    for (const item of raw.slice(0, 5000)) {
      if (!item || typeof item !== 'object') continue;
      const displayName = sanitizeFontFamilyName(item.displayName || item.localizedName || item.fullName);
      const fontId = sanitizeFontFamilyName(item.fontId || item.family);
      if (!displayName && !fontId) continue;
      // chrome.fontSettings.displayName is the human-facing label while fontId
      // is the CSS family identifier. Keep fullName/PostScript/style searchable.
      records.push({
        family: fontId || displayName,
        displayName: displayName || fontId,
        aliases: [fontId, item.localizedName, item.style, item.fullName, item.postscriptName],
      });
    }
    return records;
  }

  function requestExtensionFonts() {
    return new Promise((resolve) => {
      const pageWindow = getPageWindow();
      if (!pageWindow || typeof pageWindow.postMessage !== 'function' || typeof pageWindow.addEventListener !== 'function') {
        resolve({ ok: false, status: 'not-detected', records: [], reason: 'page messaging unavailable' });
        return;
      }
      const requestId = createBridgeToken('request');
      const nonce = createBridgeToken('nonce');
      const origin = String(location.origin || '');
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pageWindow.removeEventListener('message', onMessage, false);
        resolve(result);
      };
      const onMessage = (event) => {
        if (event.source !== pageWindow || event.origin !== origin) return;
        const data = event.data;
        if (!data || data.source !== FONT_BRIDGE_SOURCE || data.type !== 'response' || data.requestId !== requestId || data.nonce !== nonce) return;
        if (data.action !== FONT_BRIDGE_REQUEST) return;
        if (data.ok !== true) {
          finish({ ok: false, status: 'error', records: [], reason: String(data.error || 'extension request failed').slice(0, 240) });
          return;
        }
        const records = sanitizeExtensionFontRecords(data.fonts);
        finish({ ok: true, status: 'ok', records, reason: '' });
      };
      const timer = setTimeout(() => finish({ ok: false, status: 'not-detected', records: [], reason: 'extension timeout' }), FONT_BRIDGE_TIMEOUT_MS);
      pageWindow.addEventListener('message', onMessage, false);
      pageWindow.postMessage({
        source: FONT_BRIDGE_SOURCE,
        type: 'request',
        action: FONT_BRIDGE_REQUEST,
        requestId,
        nonce,
      }, origin);
    });
  }

  function getLocalFontProviders() {
    const providers = [];
    const seen = [];
    const addProvider = (owner, label) => {
      try {
        const method = owner?.queryLocalFonts;
        if (typeof method !== 'function' || seen.some((entry) => entry.owner === owner && entry.method === method)) return;
        seen.push({ owner, method });
        providers.push({ owner, method, label });
      } catch (_) {
        // Ignore inaccessible realms and continue to the next provider.
      }
    };

    let pageWindow = null;
    try {
      pageWindow = getPageWindow();
    } catch (_) {
      // Fall through to the userscript realm.
    }
    // Match the extension's successful strategy: prefer the page API itself,
    // and invoke it directly from the originating click without any prior await.
    addProvider(pageWindow, 'page/unsafeWindow');
    addProvider(window, 'userscript sandbox window');
    if (typeof globalThis !== 'undefined') addProvider(globalThis, 'userscript globalThis');
    addProvider(document.defaultView, 'document.defaultView');
    return providers;
  }

  function describeFontScanError(error) {
    const name = typeof error?.name === 'string' ? error.name.trim() : '';
    const message = typeof error?.message === 'string' ? error.message.trim() : String(error || '');
    if (name && message && !message.toLowerCase().startsWith(name.toLowerCase())) return `${name}: ${message}`;
    return message || name || 'unknown error';
  }

  async function scanAllLocalFonts(button) {
    const providers = getLocalFontProviders();
    // Every explicit scan is fresh. Old verified results must not survive a
    // later uninstall/font change and masquerade as current machine state.
    verifiedFontFamilies.clear();
    lastApiFontCount = 0;
    lastApiFontFaceCount = 0;
    lastFallbackVerifiedCount = 0;
    lastRescueVerifiedCount = 0;
    lastExtensionFontCount = 0;
    lastExtensionStatus = 'not-detected';
    button.disabled = true;
    setFontScanStatus('正在请求浏览器 Local Font Access，本次调用会保持在按钮点击的原始用户手势中……');

    const failures = [];
    let launchedQuery = null;
    // Crucial detail copied from the extension approach: call queryLocalFonts()
    // synchronously first. Do not await permission checks or other providers
    // before starting it, otherwise Chromium may consume user activation.
    for (const provider of providers) {
      try {
        const queryResult = Reflect.apply(provider.method, provider.owner, []);
        launchedQuery = { provider, queryResult };
        break;
      } catch (error) {
        failures.push(`${provider.label}: ${describeFontScanError(error)}`);
      }
    }

    let records = null;
    if (launchedQuery) {
      try {
        records = await launchedQuery.queryResult;
      } catch (error) {
        failures.push(`${launchedQuery.provider.label}: ${describeFontScanError(error)}`);
      }
    } else if (!providers.length) {
      failures.push('当前页面未暴露 queryLocalFonts()');
    }

    if (Array.isArray(records) && records.length) {
      const apiRecords = Array.from(records)
        .filter((record) => record && typeof record === 'object')
        .map((record) => ({
          family: record.family,
          displayName: record.fullName || record.family,
          fullName: record.fullName,
          postscriptName: record.postscriptName,
          style: record.style,
          localizedName: record.localizedName,
          aliases: [record.fullName, record.postscriptName, record.style, record.localizedName],
        }))
        .filter((record) => sanitizeFontFamilyName(record.family));
      const apiFamilies = Array.from(new Set(
        apiRecords.map((record) => sanitizeFontFamilyName(record.family)).filter(Boolean),
      ));
      mergeDetectedFontFamilies(apiRecords, 'local-font-access');
      fontDetectionMode = 'full-api';
      lastApiFontCount = apiFamilies.length;
      lastApiFontFaceCount = apiRecords.length;
      lastFallbackVerifiedCount = 0;
    } else {
      lastApiFontCount = 0;
      lastApiFontFaceCount = 0;
      setFontScanStatus('Local Font Access 未返回字体，正在用 CSS local() 对候选字体逐个做本机验证……');
      const localFaceResult = await verifyKnownFontCandidatesWithLocalFace();
      if (localFaceResult.supported && localFaceResult.records.length) {
        mergeDetectedFontFamilies(localFaceResult.records, 'local-face');
        lastFallbackVerifiedCount = localFaceResult.records.length;
        fontDetectionMode = 'verified-fallback';
      } else {
        lastFallbackVerifiedCount = 0;
        detectKnownLocalFonts();
      }
    }

    // Local Font Access can occasionally expose a usable but incomplete or
    // version-renamed set. Probe a tiny alias-aware rescue list even after an
    // API success. This is intentionally small, so normal scans stay fast.
    setFontScanStatus('正在补探测 Commit Mono / IBM Plex Mono / Maple Mono 的本机内部名称……');
    const rescueResult = await verifyRescueFontCandidates();
    if (rescueResult.supported && rescueResult.records.length) {
      lastRescueVerifiedCount = rescueResult.records.length;
      mergeDetectedFontFamilies(rescueResult.records, 'local-face');
      if (fontDetectionMode === 'candidate') fontDetectionMode = 'verified-fallback';
    } else {
      lastRescueVerifiedCount = 0;
    }

    // Optional MV3 bridge remains additive. It is useful when the page's
    // Permissions-Policy blocks Local Font Access but a companion extension is
    // installed. It never deletes browser/local() results.
    setFontScanStatus('正在请求字体扩展补充列表……');
    const extensionResult = await requestExtensionFonts();
    lastExtensionStatus = extensionResult.status;
    if (extensionResult.ok && extensionResult.records.length) {
      const extensionFamilies = Array.from(new Set(
        extensionResult.records.map((record) => sanitizeFontFamilyName(record.family)).filter(Boolean),
      ));
      lastExtensionFontCount = extensionFamilies.length;
      mergeDetectedFontFamilies(extensionResult.records, 'extension');
      fontDetectionMode = 'full-api';
    } else {
      lastExtensionFontCount = 0;
    }

    refreshFontSelects();
    if (fontDetectionMode === 'full-api' || fontDetectionMode === 'verified-fallback') {
      const detail = failures.length ? `；Local Font Access 备注：${failures.join('；')}` : '';
      setFontScanStatus(`${fontDetectionStatusText()}${detail}`, false);
    } else {
      const apiFailure = failures.length ? failures.join('；') : '浏览器 API 不可用或未授权';
      setFontScanStatus(
        `${apiFailure}；CSS local() 也未能建立可靠验证列表；已保留 Windows 候选快照 ${WINDOWS_FONT_FAMILY_SNAPSHOT.length} 个，不影响其他功能。`,
        true,
      );
    }
    button.disabled = false;
  }

  function syncOverrideVisual(control, key) {
    if (!(control instanceof HTMLElement) || !OVERRIDEABLE_SETTING_KEYS.has(key)) return;
    const enabledKey = overrideEnabledKey(key);
    const isEnabled = Boolean(settings[enabledKey]);
    control.toggleAttribute('data-override-disabled', !isEnabled);
    const button = control.querySelector('.cgfc-override-switch');
    if (!(button instanceof HTMLButtonElement)) return;
    button.setAttribute('aria-pressed', String(isEnabled));
    button.title = isEnabled ? '脚本正在覆盖此项，点击改为跟随系统' : '当前跟随 ChatGPT / 浏览器 / 设备，点击启用脚本覆盖';
    const label = control.querySelector('.cgfc-control-caption')?.textContent || key;
    if (key.startsWith('intelligent')) button.title = isEnabled ? '当前使用独立设置，点击恢复跟随正文' : '当前跟随正文设置，点击启用独立覆盖';
    button.setAttribute('aria-label', `${label}：${isEnabled ? '脚本覆盖' : key.startsWith('intelligent') ? '跟随正文' : '跟随系统'}`);
  }

  function restoreSettingDefault(key) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) return;
    settings = { ...settings, [key]: normalizeSetting(key, defaults[key]) };
    if (OVERRIDEABLE_SETTING_KEYS.has(key)) settings[overrideEnabledKey(key)] = defaults[overrideEnabledKey(key)];
    if (key === 'asciiOceanColorMode') settings.asciiOceanColorSeed = defaults.asciiOceanColorSeed;
    applySettings(); persistSoon(); refreshFontSelects();
    const panel = document.getElementById(PANEL_ID); if (panel) syncPanelInputs(panel);
    if (key === 'stopAutoScrollWhileGenerating') refreshAutoScrollLockState();
    if (key === 'enableResidualLatex' && settings.enableResidualLatex) { installKatexCss(); scanAssistantRoots(); }
  }

  function createSettingReset(options) {
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'cgfc-setting-reset'; button.dataset.resetKey = options.key;
    button.textContent = '恢复默认'; button.title = options.key === 'asciiOceanColorMode' ? '恢复默认配色方案及随机种子，不改变其他设置' : '恢复此项默认值及其覆盖开关，不改变其他设置';
    button.setAttribute('aria-label', options.label + '：恢复默认');
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); restoreSettingDefault(options.key); });
    return button;
  }

  function appendControl(parent, options) {
    if (options.type === 'checkbox') {
      const label = document.createElement('label');
      label.className = 'cgfc-check';
      const caption = document.createElement('span');
      caption.textContent = options.label;
      const input = document.createElement('input');
      input.dataset.key = options.key;
      input.type = 'checkbox';
      input.checked = Boolean(settings[options.key]);
      input.addEventListener('change', () => updateSetting(options.key, input.checked));
      label.append(input, caption);
      const row = document.createElement('div'); row.className = 'cgfc-check-row';
      row.append(label, createSettingReset(options)); parent.appendChild(row);
      return input;
    }

    const control = document.createElement('div');
    control.className = 'cgfc-control';
    const head = document.createElement('div');
    head.className = 'cgfc-control-head';
    const caption = document.createElement('span');
    caption.className = 'cgfc-control-caption';
    caption.textContent = options.label;
    head.appendChild(caption);

    if (OVERRIDEABLE_SETTING_KEYS.has(options.key)) {
      control.dataset.overrideKey = options.key;
      const switchButton = document.createElement('button');
      switchButton.type = 'button';
      switchButton.className = 'cgfc-override-switch';
      switchButton.dataset.overrideKey = options.key;
      switchButton.setAttribute('role', 'switch');
      const knob = document.createElement('span');
      knob.className = 'cgfc-override-switch-knob';
      switchButton.appendChild(knob);
      switchButton.addEventListener('click', (event) => {
        event.preventDefault();
        const enabledKey = overrideEnabledKey(options.key);
        updateSetting(enabledKey, !Boolean(settings[enabledKey]));
        syncOverrideVisual(control, options.key);
      });
      head.appendChild(switchButton);
    }

    const input = ['select', 'font-select'].includes(options.type) ? document.createElement('select') : document.createElement('input');
    input.dataset.key = options.key;
    input.setAttribute('aria-label', options.label);

    if (options.type === 'select') {
      options.choices.forEach((choice) => {
        const option = document.createElement('option');
        option.value = choice.value;
        option.textContent = choice.label;
        input.appendChild(option);
      });
      input.value = settings[options.key];
      input.addEventListener('change', () => updateSetting(options.key, input.value));
    } else if (options.type === 'font-select') {
      input.dataset.fontPicker = 'true';
      populateFontSelect(input);
      input.addEventListener('change', () => updateSetting(options.key, input.value));
    } else {
      input.type = options.type;
      input.value = settings[options.key];
      if (options.min !== undefined) input.min = options.min;
      if (options.max !== undefined) input.max = options.max;
      if (options.step !== undefined) input.step = options.step;
      input.addEventListener('input', () => updateSetting(options.key, input.value));
    }

    head.appendChild(createSettingReset(options));
    control.append(head, input);
    parent.appendChild(control);
    if (OVERRIDEABLE_SETTING_KEYS.has(options.key)) syncOverrideVisual(control, options.key);
    return input;
  }

  function createRow(parent) {
    const row = document.createElement('div');
    row.className = 'cgfc-row';
    parent.appendChild(row);
    return row;
  }

  function createSettingsGroup(parent, title, open = false) {
    const group = document.createElement('details');
    group.className = 'cgfc-settings-group';
    group.open = open;
    const summary = document.createElement('summary');
    summary.textContent = title;
    group.appendChild(summary);
    parent.appendChild(group);
    return group;
  }

  function syncPanelInputs(panel) {
    panel.querySelectorAll('input[data-key], select[data-key]').forEach((input) => {
      const key = input.dataset.key;
      if (!key) return;
      if (input.type === 'checkbox') input.checked = Boolean(settings[key]);
      else input.value = settings[key];
    });
    panel.querySelectorAll('.cgfc-control[data-override-key]').forEach((control) => {
      syncOverrideVisual(control, control.dataset.overrideKey);
    });
  }

  function createPanel() {
    if (!document.body) return;

    const existingToggle = document.getElementById(TOGGLE_ID);
    const existingPanel = document.getElementById(PANEL_ID);
    if (existingToggle instanceof HTMLElement && existingPanel instanceof HTMLElement) return;

    existingToggle?.remove();
    existingPanel?.remove();

    const toggle = document.createElement('button');
    toggle.id = TOGGLE_ID;
    toggle.type = 'button';
    toggle.title = 'ChatGPT 字体与颜色设置';
    toggle.setAttribute('aria-label', '打开 ChatGPT 字体与颜色设置');
    toggle.setAttribute('aria-controls', PANEL_ID);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = 'Aa';

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.hidden = true;

    const title = document.createElement('h2');
    title.id = `${PANEL_ID}-title`;
    title.textContent = 'ChatGPT 工具箱设置';
    panel.setAttribute('aria-labelledby', title.id);
    panel.appendChild(title);
    const resetStyle = document.createElement('style');
    resetStyle.textContent = '.cgfc-setting-reset{flex-shrink:0;font:inherit;font-size:12px;line-height:1.4;padding:4px 7px;border:1px solid #7775;border-radius:6px;color:inherit;background:transparent;cursor:pointer;white-space:nowrap}.cgfc-setting-reset:hover{background:#8882}.cgfc-setting-reset:focus-visible{outline:2px solid currentColor;outline-offset:2px}.cgfc-check-row{display:flex;align-items:center;gap:8px;min-width:0}.cgfc-check-row>.cgfc-check{flex:1;min-width:0}.cgfc-control-head>.cgfc-control-caption{flex:1;min-width:0}';
    panel.appendChild(resetStyle);
    const oceanGroup = createSettingsGroup(panel, 'ASCII 鲨鱼海洋（独立装饰）');
    appendControl(oceanGroup, { label: '启用 ASCII 鲨鱼海洋', key: 'enableAsciiOcean', type: 'checkbox' });
    appendControl(oceanGroup, { label: '生成回答时暂停动画', key: 'asciiOceanPauseWhileGenerating', type: 'checkbox' });
    appendControl(oceanGroup, { label: '鼠标扰动（关闭更省资源）', key: 'asciiOceanPointer', type: 'checkbox' });
    appendControl(oceanGroup, { label: '主页动画（还未发送消息）', key: 'asciiOceanHomeCoverage', type: 'select', choices: [
      { value: 'full', label: '全页背景 · 文字与输入框在上方' }, { value: 'off', label: '主页不显示动画' },
    ] });
    appendControl(oceanGroup, { label: '对话页动画（已发送消息）', key: 'asciiOceanCoverage', type: 'select', choices: [
      { value: 'gutter', label: '两侧空白 · 从顶部开始避开正文' },
      { value: 'full', label: '全页背景 · 文字与贴片在上方' },
      { value: 'glass', label: '回答玻璃 · 仅模型回答，文字在玻璃上方' },
    ] });
    appendControl(oceanGroup, { label: '鲨鱼种类', key: 'asciiOceanSpecies', type: 'select', choices: [
      { value: 'classic', label: '经典鲨鱼 · 原版组合' }, { value: 'mixed', label: '混合 · 双髻 / 虎鲨 / 灰鲭 / 长尾' },
      { value: 'hammerhead', label: '双髻鲨' }, { value: 'tiger', label: '虎鲨' },
      { value: 'zebra', label: '豹纹鲨' }, { value: 'greathammer', label: '无沟双髻鲨' },
      { value: 'mako', label: '灰鲭鲨' }, { value: 'thresher', label: '长尾鲨' }, { value: 'nurse', label: '护士鲨' },
    ] });
    const oceanRow = createRow(oceanGroup);
    appendControl(oceanRow, { label: '装饰不透明度', key: 'asciiOceanOpacity', type: 'number', min: 0.15, max: 0.9, step: 0.05 });
    appendControl(oceanRow, { label: '帧率上限（默认 12，范围 3–30）', key: 'asciiOceanFps', type: 'number', min: 3, max: 30, step: 1 });
    appendControl(oceanGroup, { label: '鱼群数量', key: 'asciiOceanDensity', type: 'number', min: 40, max: 160, step: 10 });
    appendControl(oceanGroup, { label: '画质与负载', key: 'asciiOceanQuality', type: 'select', choices: [
      { value: 'eco', label: '节能 · 较低画质，最多 18 帧' }, { value: 'balanced', label: '均衡 · 保留完整边缘细节' }, { value: 'fine', label: '精细 · 更高屏幕分辨率' },
    ] });
    appendControl(oceanGroup, { label: '绘制方式', key: 'asciiOceanRenderer', type: 'select', choices: [
      { value: 'canvas', label: '标准 · 保留原有字形绘制' }, { value: 'gpu', label: 'GPU 批量绘制' }, { value: 'compute', label: 'GPU 计算 + 绘制（实验）' },
    ] });
    appendControl(oceanGroup, { label: '运动模式', key: 'asciiOceanMotionMode', type: 'select', choices: [
      { value: 'live', label: '实时模拟 · 支持鼠标互动' }, { value: 'replay15', label: '预计算回放 · 15 分钟一轮' }, { value: 'replay30', label: '预计算回放 · 30 分钟一轮' },
    ] });
    const modesHint = document.createElement('p'); modesHint.className = 'cgfc-hint';
    modesHint.textContent = '两项可以组合：绘制方式决定每帧如何画；运动模式决定轨迹来自实时模拟还是缓存回放。GPU 计算 + 回放可进一步减少持续的 CPU 工作，但并非纯 GPU。15／30 分钟只改变轨迹循环长度和缓存占用，不改变画质。它们不控制液态玻璃。'; oceanGroup.appendChild(modesHint);
    const replayHint = document.createElement('p'); replayHint.className = 'cgfc-hint';
    replayHint.textContent = '回放首次在后台准备，之后复用本地轨迹；轨迹以 12Hz 预演并平滑插值，画面仍按当前帧率、尺寸和画质绘制。回放不响应鼠标扰动，切回实时恢复。默认鱼群下 15/30 分钟约占 26/52 MiB，最多保留两份缓存。精细画质与颜色可独立调整。GPU 模式保留造型、颜色和边缘采样，文字抗锯齿可能略有不同。'; oceanGroup.appendChild(replayHint);
    const replayStatus = document.createElement('p'); replayStatus.className = 'cgfc-hint'; replayStatus.setAttribute('data-cgpt-ocean-status', ''); replayStatus.textContent = document.documentElement.getAttribute('data-cgfc-ocean-status') || '实时模拟'; oceanGroup.appendChild(replayStatus);
    const clearReplay = document.createElement('button'); clearReplay.type = 'button'; clearReplay.textContent = '清除回放缓存';
    clearReplay.addEventListener('click', () => globalThis.__cgptUnifiedRuntimeV1?.asciiSharks?.clearReplayCache()); oceanGroup.appendChild(clearReplay);
    const oceanColors = createSettingsGroup(oceanGroup, '海洋配色');
    appendControl(oceanColors, { label: '配色方案', key: 'asciiOceanColorMode', type: 'select', choices: [
      { value: 'auto', label: '自动适配明暗背景' }, { value: 'original', label: '仓库原版' },
      { value: 'cyan', label: '青蓝' }, { value: 'aurora', label: '极光紫' }, { value: 'warm', label: '暖金' },
      { value: 'random', label: '随机和谐配色' }, { value: 'custom', label: '自选颜色' },
    ] });
    for (const [key, label] of [['asciiOceanBodyColor', '鲨鱼颜色'], ['asciiOceanAccentColor', '点缀颜色'], ['asciiOceanFishColor', '鱼群颜色'], ['asciiOceanWakeColor', '尾迹颜色']]) {
      const input = appendControl(oceanColors, { label, key, type: 'color' });
      input.addEventListener('input', () => { if (settings.asciiOceanColorMode !== 'custom') { updateSetting('asciiOceanColorMode', 'custom'); syncPanelInputs(panel); } });
    }
    const randomColors = document.createElement('button');
    randomColors.type = 'button'; randomColors.textContent = '换一组随机颜色';
    randomColors.addEventListener('click', () => {
      settings = { ...settings, asciiOceanColorMode: 'random', asciiOceanColorSeed: Math.floor(Math.random() * 2147483646) + 1 };
      writeStore(STORAGE_KEY, settings); applySettings(); syncPanelInputs(panel);
    });
    oceanColors.appendChild(randomColors);
    const gpuComputeHint = document.createElement('p'); gpuComputeHint.className = 'cgfc-hint';
    gpuComputeHint.textContent = 'GPU 计算模式把轮廓、阴影、尾迹扩散与字符选色交给显卡，保持原画质和采样数。显卡或浏览器不支持浮点纹理时自动回退；状态栏显示实际运行方式。'; oceanGroup.appendChild(gpuComputeHint);
    const oceanHint = document.createElement('p');
    oceanHint.className = 'cgfc-hint';
    oceanHint.textContent = '主页与对话页独立设置，所有模式都位于文字、输入框和贴片下方，并避开最左侧导航栏和滚动条。避开正文模式从顶部起按实际正文边界避让。滚动时连续游动；鼠标扰动默认关闭，关闭时不监听鼠标事件。被挡住的区域跳过绘制。默认 12 帧，可调至 3–30 帧；3–5 帧更省但跳格更明显，游动速度与尾迹衰减不随帧率减慢。鱼群默认 90 条；可选节能档。正文玻璃为每条消息独立设置，仅处理屏幕附近的消息。随机颜色每次生成后保持稳定，可再次换色。改编自 stackedlol/ascii-sharks。';
    oceanGroup.appendChild(oceanHint);

    const fontGroup = createSettingsGroup(panel, '字体与排版');
    panel.insertBefore(fontGroup, oceanGroup);
    const fontBasics = createSettingsGroup(fontGroup, '字体选择与本机扫描');
    const fontFormula = createSettingsGroup(fontGroup, '公式显示与复制');
    const fontCode = createSettingsGroup(fontGroup, '代码显示');
    const fontLayout = createSettingsGroup(fontGroup, '正文字号、行高与列宽');
    const fontColors = createSettingsGroup(fontGroup, '颜色、粗细与平滑');
    appendControl(fontColors, { label: '浅色主题默认正文配色跟随站点（自定义颜色保留）', key: 'nativeLightBodyColors', type: 'checkbox' });
    let fontTarget = fontBasics;
    detectKnownLocalFonts();

    const fontScanRow = document.createElement('div');
    fontScanRow.className = 'cgfc-font-scan';
    const fontScanButton = document.createElement('button');
    fontScanButton.type = 'button';
    fontScanButton.textContent = '扫描全部本机字体';
    fontScanButton.addEventListener('click', () => scanAllLocalFonts(fontScanButton));
    const fontSearchInput = document.createElement('input');
    fontSearchInput.type = 'search';
    fontSearchInput.placeholder = '搜索字体（中文 / English）';
    fontSearchInput.setAttribute('aria-label', '搜索本机字体');
    fontSearchInput.value = fontSearchQuery;
    fontSearchInput.addEventListener('input', () => applyFontSearch(fontSearchInput.value));
    const fontScanStatus = document.createElement('p');
    fontScanStatus.id = FONT_STATUS_ID;
    fontScanStatus.className = 'cgfc-hint';
    fontScanStatus.textContent = fontDetectionStatusText();
    fontScanRow.append(fontScanButton, fontSearchInput, fontScanStatus);
    fontTarget.appendChild(fontScanRow);

    const overrideHint = document.createElement('p');
    overrideHint.className = 'cgfc-hint cgfc-override-hint';
    overrideHint.textContent = '每项右侧开关只控制脚本是否覆盖该项；关闭后跟随 ChatGPT、浏览器与当前设备的原生样式。关闭不会丢失你已经选好的值。';
    fontTarget.appendChild(overrideHint);

    appendControl(fontTarget, { label: '英文字体（Latin / 数字优先）', key: 'latinFont', type: 'font-select' });
    appendControl(fontTarget, { label: '中文字体（中文字形回退）', key: 'chineseFont', type: 'font-select' });
    appendControl(fontTarget, { label: '英文加粗字体', key: 'boldLatinFont', type: 'font-select' });
    appendControl(fontTarget, { label: '中文加粗字体', key: 'boldChineseFont', type: 'font-select' });

    const fontHint = document.createElement('p');
    fontHint.className = 'cgfc-hint';
    fontHint.textContent = '浏览器先尝试英文字体，再把缺少的中文字形回退到中文字体；若英文字体本身包含完整中文字符，它可能不会触发中文回退。';
    fontTarget.appendChild(fontHint);

    fontTarget = fontFormula;
    appendControl(fontTarget, { label: '公式字母字体（MathML / KaTeX 普通字母）', key: 'mathFont', type: 'font-select' });
    appendControl(fontTarget, {
      label: '公式字体策略',
      key: 'mathFontMode',
      type: 'select',
      choices: [
        { label: '仅原生 MathML（推荐）', value: 'native' },
        { label: '不覆盖公式字体', value: 'off' },
      ],
    });

    const mathHint = document.createElement('p');
    mathHint.className = 'cgfc-hint';
    mathHint.textContent = 'ChatGPT 通常使用 KaTeX，因此仅修改原生 MathML 往往看不出变化。下面的兼容选项只修改 KaTeX 普通字母，不触碰 ≠、∉、根号、运算符和伸缩符号。';
    fontTarget.appendChild(mathHint);

    const formulaSizeInput = appendControl(fontTarget, { label: '公式字号 px（行内与块公式）', key: 'formulaFontSize', type: 'number', min: 10, max: 64, step: 1 });
    formulaSizeInput.addEventListener('input', () => {
      if (settings.formulaFontSizeEnabled) return;
      updateSetting('formulaFontSizeEnabled', true);
      syncOverrideVisual(formulaSizeInput.parentElement, 'formulaFontSize');
    });
    const formulaSizeHint = document.createElement('p');
    formulaSizeHint.className = 'cgfc-hint';
    formulaSizeHint.textContent = '输入新字号会自动启用覆盖；关闭右侧开关即可恢复网页原有公式大小。';
    fontTarget.appendChild(formulaSizeHint);

    appendControl(fontTarget, { label: '将所选公式字体用于 KaTeX 普通字母', key: 'enableKatexLetterFont', type: 'checkbox' });

    appendControl(fontTarget, { label: '修复助手消息中未解析的 $...$ 公式', key: 'enableResidualLatex', type: 'checkbox' });
    const residualHint = document.createElement('p');
    residualHint.className = 'cgfc-hint';
    residualHint.textContent = '仅处理助手消息里仍显示为纯文本的 $...$、\\(...\\)、$$...$$、\\[...\\]；不会扫描你的提问或输入框。';
    fontTarget.appendChild(residualHint);

    appendControl(fontTarget, { label: '双击公式复制 LaTeX', key: 'enableFormulaCopy', type: 'checkbox' });
    appendControl(fontTarget, { label: '复制公式时保留 $ / $$ 定界符', key: 'formulaCopyDelimiters', type: 'checkbox' });
    appendControl(fontTarget, { label: '公式复制边框颜色', key: 'formulaCopyBorderColor', type: 'color' });
    appendControl(fontTarget, { label: '回答复制 MD 图标颜色', key: 'messageCopyIconColor', type: 'color' });
    const formulaCopyHint = document.createElement('p');
    formulaCopyHint.className = 'cgfc-hint';
    formulaCopyHint.textContent = '参考 Ophel Atlas：优先读取 KaTeX 内置的 application/x-tex 原始源码；行内公式复制为 $...$，块公式复制为 $$...$$。';
    fontTarget.appendChild(formulaCopyHint);

    fontTarget = fontCode;
    appendControl(fontTarget, { label: '代码字体', key: 'codeFont', type: 'font-select' });

    fontTarget = fontLayout;
    let row = createRow(fontTarget);
    appendControl(row, { label: '正文字号 px', key: 'fontSize', type: 'number', min: 10, max: 40, step: 1 });
    appendControl(row, { label: '正文行高', key: 'lineHeight', type: 'number', min: 1, max: 2.8, step: 0.05 });

    appendControl(fontTarget, { label: '模型的思考概览字号 px', key: 'thinkingOverviewFontSize', type: 'number', min: 10, max: 40, step: 1 });
    appendControl(fontTarget, { label: '文件引用标签字号 px', key: 'citationFontSize', type: 'number', min: 10, max: 40, step: 1 });
    appendControl(fontTarget, { label: '网络来源胶囊字号 px', key: 'webCitationFontSize', type: 'number', min: 10, max: 40, step: 1 });
    const citationHint = document.createElement('p');
    citationHint.className = 'cgfc-hint';
    citationHint.textContent = '网络来源默认 14px，文件引用默认 18px；胶囊高度、内边距和图标随各自字号同步缩小，不随正文或互动卡片放大。关闭对应开关即可恢复原有大小。';
    fontTarget.appendChild(citationHint);

    const intelligentGroup = createSettingsGroup(fontGroup, 'Intelligent UI（互动卡片／选择题）');
    appendControl(intelligentGroup, { label: '独立字体', key: 'intelligentFont', type: 'font-select' });
    let intelligentRow = createRow(intelligentGroup);
    appendControl(intelligentRow, { label: '卡片正文字号 px', key: 'intelligentFontSize', type: 'number', min: 10, max: 64, step: 1 });
    appendControl(intelligentRow, { label: '标题字号 px', key: 'intelligentTitleFontSize', type: 'number', min: 10, max: 72, step: 1 });
    intelligentRow = createRow(intelligentGroup);
    appendControl(intelligentRow, { label: '选项／按钮字号 px', key: 'intelligentControlFontSize', type: 'number', min: 10, max: 64, step: 1 });
    appendControl(intelligentRow, { label: '卡片行高', key: 'intelligentLineHeight', type: 'number', min: 1, max: 2.8, step: 0.05 });
    const intelligentHint = document.createElement('p');
    intelligentHint.className = 'cgfc-hint';
    intelligentHint.textContent = '默认跟随正文设置。修改某项会自动开启该项独立覆盖；关闭右侧开关后恢复跟随。选项、按钮和标题可分别调节大小。';
    intelligentGroup.appendChild(intelligentHint);

    row = createRow(fontTarget);
    appendControl(row, { label: '正文左边界偏移 px', key: 'bodyColumnLeftOffset', type: 'number', min: -400, max: 400, step: 10 });
    appendControl(row, { label: '正文右边界偏移 px', key: 'bodyColumnRightOffset', type: 'number', min: -400, max: 400, step: 10 });
    const bodyColumnHint = document.createElement('p');
    bodyColumnHint.className = 'cgfc-hint';
    bodyColumnHint.textContent = '以网站当前正文列为基准：正数向内收窄，负数向外扩展；左右可分别设置。超出可用空间时会保留至少 160px 宽度。';
    fontTarget.appendChild(bodyColumnHint);

    row = createRow(fontCode);
    appendControl(row, { label: '代码字号 px', key: 'codeFontSize', type: 'number', min: 10, max: 32, step: 1 });
    appendControl(row, { label: '代码行高', key: 'codeLineHeight', type: 'number', min: 1, max: 2.8, step: 0.05 });

    fontTarget = fontColors;
    row = createRow(fontTarget);
    appendControl(row, { label: '普通文字颜色', key: 'normalColor', type: 'color' });
    appendControl(row, { label: '加粗文字颜色', key: 'boldColor', type: 'color' });

    appendControl(fontTarget, { label: '加粗粗细', key: 'boldWeight', type: 'number', min: 400, max: 1000, step: 50 });
    appendControl(fontTarget, { label: '启用字体平滑 Anti-aliasing', key: 'enableFontSmoothing', type: 'checkbox' });

    row = createRow(fontTarget);
    appendControl(row, {
      label: '平滑模式',
      key: 'fontSmoothingMode',
      type: 'select',
      choices: [
        { label: '更顺滑 antialiased', value: 'antialiased' },
        { label: '系统默认 auto', value: 'auto' },
        { label: '子像素 subpixel', value: 'subpixel-antialiased' },
      ],
    });
    appendControl(row, {
      label: '文本渲染',
      key: 'textRenderingMode',
      type: 'select',
      choices: [
        { label: '阅读优化', value: 'optimizeLegibility' },
        { label: '系统默认', value: 'auto' },
        { label: '几何精度', value: 'geometricPrecision' },
      ],
    });

    const toolboxGroup = createSettingsGroup(panel, '导航 / 提示词浮窗外观');
    appendControl(toolboxGroup, { label: '浮窗字体', key: 'toolboxFont', type: 'font-select' });
    row = createRow(toolboxGroup);
    appendControl(row, { label: '字号 px', key: 'toolboxFontSize', type: 'number', min: 9, max: 24, step: 1 });
    appendControl(row, { label: '行高', key: 'toolboxLineHeight', type: 'number', min: 1, max: 2.2, step: 0.05 });
    appendControl(toolboxGroup, { label: '面板宽度 px', key: 'toolboxPanelWidth', type: 'number', min: 160, max: 560, step: 10 });
    row = createRow(toolboxGroup);
    appendControl(row, { label: '文字颜色', key: 'toolboxTextColor', type: 'color' });
    appendControl(row, { label: '背景颜色', key: 'toolboxBackgroundColor', type: 'color' });
    row = createRow(toolboxGroup);
    appendControl(row, { label: '强调颜色', key: 'toolboxAccentColor', type: 'color' });
    appendControl(row, { label: '背景透明度', key: 'toolboxOpacity', type: 'number', min: 0.2, max: 1, step: 0.05 });
    const toolboxHint = document.createElement('p');
    toolboxHint.className = 'cgfc-hint';
    toolboxHint.textContent = '每个外观项均可独立启停；颜色项关闭后继续跟随 ChatGPT 明暗主题。贴片可缩到 160px；修改宽度设置时会更新当前手动尺寸。';
    toolboxGroup.appendChild(toolboxHint);

    const glassGroup = createIndependentGlassControls(panel);
    panel.insertBefore(glassGroup, oceanGroup);
    const queueGroup = createSettingsGroup(panel, '输入框旁发送队列外观');
    appendControl(queueGroup, { label: '启用精细深色拟态 Soft UI（输入框 + 队列）', key: 'enableNeumorphicAppearance', type: 'checkbox' });
    appendControl(queueGroup, { label: '队列字体', key: 'queueFont', type: 'font-select' });
    row = createRow(queueGroup);
    appendControl(row, { label: '字号 px', key: 'queueFontSize', type: 'number', min: 9, max: 24, step: 1 });
    appendControl(row, { label: '行高', key: 'queueLineHeight', type: 'number', min: 1, max: 2.2, step: 0.05 });
    appendControl(queueGroup, { label: '面板宽度 px', key: 'queuePanelWidth', type: 'number', min: 280, max: 720, step: 10 });
    row = createRow(queueGroup);
    appendControl(row, { label: '文字颜色', key: 'queueTextColor', type: 'color' });
    appendControl(row, { label: '背景颜色', key: 'queueBackgroundColor', type: 'color' });
    row = createRow(queueGroup);
    appendControl(row, { label: '强调颜色', key: 'queueAccentColor', type: 'color' });
    appendControl(row, { label: '背景透明度', key: 'queueOpacity', type: 'number', min: 0.2, max: 1, step: 0.05 });
    const queueHint = document.createElement('p');
    queueHint.className = 'cgfc-hint';
    queueHint.textContent = '“精细深色拟态 Soft UI”统一输入框、队列面板/贴片与发送按钮的柔和高光、阴影和按压反馈；关闭后恢复普通主题外观。其他外观项仍可独立启停。';
    queueGroup.appendChild(queueHint);

    const statsGroup = createSettingsGroup(panel, 'Token 统计（估算）');
    appendControl(statsGroup, { label: '启用 Token 统计', key: 'showTokenStats', type: 'checkbox' });
    appendControl(statsGroup, { label: '显示逐消息 Token 标签', key: 'showTokenMessageChips', type: 'checkbox' });
    appendControl(statsGroup, { label: '显示本轮总览贴片', key: 'showTokenSummary', type: 'checkbox' });
    appendControl(statsGroup, {
      label: '总览贴片位置',
      key: 'tokenSummaryPosition',
      type: 'select',
      choices: [
        { value: 'auto', label: '自动避让' },
        { value: 'composer-top-center', label: '输入框上方 · 居中' },
        { value: 'composer-top-left', label: '输入框上方 · 左侧' },
        { value: 'composer-top-right', label: '输入框上方 · 右侧' },
        { value: 'viewport-bottom-left', label: '视口左下角' },
        { value: 'viewport-bottom-right', label: '视口右下角' },
      ],
    });
    row = createRow(statsGroup);
    appendControl(row, { label: '水平偏移 px', key: 'tokenSummaryOffsetX', type: 'number', min: -600, max: 600, step: 1 });
    appendControl(row, { label: '垂直偏移 px', key: 'tokenSummaryOffsetY', type: 'number', min: -600, max: 600, step: 1 });
    appendControl(statsGroup, { label: '始终使用紧凑格式（6/235/2.4k）', key: 'tokenSummaryCompactAlways', type: 'checkbox' });
    appendControl(statsGroup, { label: '窄屏自动使用紧凑格式', key: 'tokenSummaryCompactOnNarrow', type: 'checkbox' });
    appendControl(statsGroup, { label: '自动避让发送队列', key: 'tokenSummaryAvoidQueue', type: 'checkbox' });
    row = createRow(statsGroup);
    appendControl(row, { label: '总览文字颜色', key: 'tokenSummaryTextColor', type: 'color' });
    appendControl(row, { label: '总览背景颜色', key: 'tokenSummaryBackgroundColor', type: 'color' });
    appendControl(statsGroup, { label: '总览边框颜色', key: 'tokenSummaryBorderColor', type: 'color' });
    const tokenStatsHint = document.createElement('p');
    tokenStatsHint.className = 'cgfc-hint';
    tokenStatsHint.textContent = '统计当前活动分支中可见的用户/助手文本。总览依次表示本轮输入、输出和可见上下文；开启“始终紧凑”后宽屏也显示为“输入/输出/上下文”。三个颜色项关闭脚本覆盖时继续跟随 ChatGPT 明暗主题。系统指令、记忆、工具定义、隐藏推理等不可见内容不会计入，因此它只是近似值，不是官方 usage。';
    statsGroup.appendChild(tokenStatsHint);

    const pageGroup = createSettingsGroup(panel, '页面布局与滚动');
    panel.insertBefore(pageGroup, oceanGroup);
    appendControl(pageGroup, { label: '去掉顶部黑色预留区（保留标题栏按钮）', key: 'removeTopBarGap', type: 'checkbox' });
    appendControl(pageGroup, { label: '防止自动滚动', key: 'stopAutoScrollWhileGenerating', type: 'checkbox' });
    appendControl(pageGroup, { label: '正文选区使用普通复制（输入框保留原生处理）', key: 'normalTextCopy', type: 'checkbox' });
    appendControl(pageGroup, { label: '稳定滚动边界（减少触底回弹与浮层错位）', key: 'stabilizeScrollBoundary', type: 'checkbox' });
    appendControl(fontCode, { label: '代码自动换行', key: 'wrapCode', type: 'checkbox' });

    createBackupControls(panel);

    const actions = document.createElement('div');
    actions.className = 'cgfc-actions';

    const followSystemButton = document.createElement('button');
    followSystemButton.type = 'button';
    followSystemButton.textContent = '全部跟随系统';
    followSystemButton.addEventListener('click', () => {
      const next = { ...settings };
      OVERRIDEABLE_SETTING_KEYS.forEach((key) => { next[overrideEnabledKey(key)] = false; });
      next.toolboxUseCustomColors = false;
      next.queueUseCustomColors = false;
      next.enableNeumorphicAppearance = false;
      next.enableAsciiOcean = false;
      next.enableComposerLiquidGlass = false;
      next.enableToolboxLiquidGlass = false;
      next.enableSettingsLiquidGlass = false;
      next.enableQueueLiquidGlass = false;
      next.enableSendLiquidGlass = false;
      next.enableScrollLiquidGlass = false;
      next.enableTokenLiquidGlass = false;
      next.enableToggleLiquidGlass = false; next.enableMessageLiquidGlass = false; next.enableComposerToolsLiquidGlass = false; next.removeTopBarGap = false; next.stabilizeScrollBoundary = false; next.normalTextCopy = false; next.nativeLightBodyColors = false;
      settings = next;
      writeStore(STORAGE_KEY, settings);
      applySettings();
      syncPanelInputs(panel);
    });

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.textContent = '恢复脚本预设';
    resetButton.addEventListener('click', () => {
      settings = { ...defaults };
      writeStore(STORAGE_KEY, settings);
      applySettings();
      detectKnownLocalFonts();
      refreshFontSelects();
      syncPanelInputs(panel);
    });

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '关闭';

    actions.append(followSystemButton, resetButton, closeButton);
    panel.appendChild(actions);

    function setPanelOpen(open, restoreFocus = false) {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) { panel.querySelectorAll('details').forEach(group => { group.open = false; }); panel.scrollTop = 0; panel.querySelector('summary')?.focus(); }
      else if (restoreFocus) toggle.focus();
    }

    closeButton.addEventListener('click', () => setPanelOpen(false, true));
    toggle.addEventListener('click', () => {
      setPanelOpen(panel.hidden);
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setPanelOpen(false, true);
    });

    document.body.append(toggle, panel);
    window.__cgptUnifiedRuntimeV1?.surfaceLiquidGlass?.schedule();
  }

  const shellGuardObservers = new Map();
  function ensureShell() {
    // The current settings already own root attributes and variables. Repair
    // only missing UI/style nodes; do not broadcast a settings change here.
    installStaticStyles();
    createPanel();
    const toggle = document.getElementById(TOGGLE_ID), panel = document.getElementById(PANEL_ID);
    if (toggle instanceof HTMLElement && toggle.parentNode !== document.body) document.body?.appendChild(toggle);
    if (panel instanceof HTMLElement && panel.parentNode !== document.body) document.body?.appendChild(panel);
    startShellGuard();
  }

  function shellNeedsRepair() {
    const parent = document.head || document.documentElement;
    const style = document.getElementById(STYLE_ID), toggle = document.getElementById(TOGGLE_ID), panel = document.getElementById(PANEL_ID);
    return !style || style.parentNode !== parent || !toggle || toggle.parentNode !== document.body
      || !panel || panel.parentNode !== document.body
      || [document.documentElement, document.head, document.body].some(node => node && !shellGuardObservers.has(node));
  }

  function queueShellGuard() {
    // SVG filters, Token chips and other normal body children need no repair.
    // A removed script panel/style must still be repaired, even though it is ours.
    if (shellGuardTimer || !shellNeedsRepair()) return;
    shellGuardTimer = setTimeout(() => { shellGuardTimer = 0; ensureShell(); }, 120);
  }

  function startShellGuard() {
    const targets = new Set([document.documentElement, document.head, document.body].filter(Boolean));
    for (const [node, observer] of shellGuardObservers) if (!targets.has(node)) {
      observer.disconnect(); shellGuardObservers.delete(node);
    }
    for (const node of targets) if (!shellGuardObservers.has(node)) {
      const observer = new MutationObserver(queueShellGuard);
      observer.observe(node, { childList: true }); shellGuardObservers.set(node, observer);
    }
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeDisclaimerText(value) {
    return normalizeText(value).replace(/\s+/g, '');
  }

  function isChatGPTDisclaimerText(value) {
    return CHATGPT_DISCLAIMER_KEYS.has(normalizeDisclaimerText(value));
  }

  function isChatGPTDisclaimerElement(element) {
    return element.matches(CHATGPT_DISCLAIMER_SELECTOR)
      && !element.closest(dom.message)
      && isChatGPTDisclaimerText(element.textContent);
  }

  function clearStaleHiddenDisclaimers() {
    document.querySelectorAll(`.${HIDDEN_DISCLAIMER_CLASS}`).forEach((element) => {
      if (!isChatGPTDisclaimerElement(element)) {
        element.classList.remove(HIDDEN_DISCLAIMER_CLASS);
      }
    });
  }

  function scanChatGPTDisclaimers(root) {
    const scanRoot = root instanceof Element ? root : document.body || document.documentElement;
    if (!scanRoot) return;
    const candidates = [
      ...(scanRoot.matches?.(CHATGPT_DISCLAIMER_SELECTOR) ? [scanRoot] : []),
      ...scanRoot.querySelectorAll(CHATGPT_DISCLAIMER_SELECTOR),
    ];
    candidates.forEach((element) => {
      element.classList.toggle(HIDDEN_DISCLAIMER_CLASS, isChatGPTDisclaimerElement(element));
    });
  }

  function queueDisclaimerScan(root) {
    clearTimeout(disclaimerTimer);
    disclaimerTimer = setTimeout(() => {
      clearStaleHiddenDisclaimers();
      scanChatGPTDisclaimers(root);
    }, 100);
  }

  function startDisclaimerObserver() {
    queueDisclaimerScan();

    const observer = new MutationObserver((mutations) => {
      let rootToScan = null;

      for (const mutation of mutations) {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
        if (target?.closest(`#${PANEL_ID}, #${TOGGLE_ID}`)) continue;
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-markdown-copy') {
          rootToScan = target;
          break;
        }
        const markedTarget = target?.closest(CHATGPT_DISCLAIMER_SELECTOR);
        if (markedTarget) {
          rootToScan = markedTarget;
          break;
        }
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)
            || !(node.matches(CHATGPT_DISCLAIMER_SELECTOR) || node.querySelector(CHATGPT_DISCLAIMER_SELECTOR))) continue;
          rootToScan = node;
          break;
        }
        if (rootToScan) break;
      }

      if (rootToScan) queueDisclaimerScan(rootToScan);
    });

    observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-markdown-copy'],
      subtree: true,
    });
  }

  // These tokenizer helpers deliberately operate on strings only. Keeping the
  // parser independent from DOM code makes delimiter recovery predictable while
  // a streamed assistant response is still being assembled.
  function isEscapedDelimiter(text, index) {
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashCount += 1;
    return slashCount % 2 === 1;
  }

  function findResidualClosing(text, start, close, allowNewline) {
    for (let cursor = start; cursor <= text.length - close.length; cursor += 1) {
      if (!allowNewline && text[cursor] === '\n') return -1;
      if (!text.startsWith(close, cursor) || isEscapedDelimiter(text, cursor)) continue;
      return cursor;
    }
    return -1;
  }

  function isCurrencyLikeInlineLatex(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return true;
    if (/^[+-]?\d+(?:[.,]\d+)?$/.test(trimmed)) return true;
    if (/^[+-]?\d+(?:[.,]\d+)?\s*[-–—]?$/.test(trimmed)) return true;
    if (/^[+-]?\d+(?:[.,]\d+)?\s*[-–—]\s*[+-]?\d+(?:[.,]\d+)?$/.test(trimmed)) return true;
    if (/^[+-]?\d/.test(trimmed) && !/[\\^_{}<>=+*/()]/.test(trimmed)) return true;
    return false;
  }

  function isPlausibleResidualLatex(value) {
    const content = String(value || '').trim();
    if (!content) return false;
    // KaTeX accepts bare CJK prose as text, so successful rendering alone is
    // not evidence of math. Explicit \text{中文} remains valid.
    const withoutTextMacros = content.replace(/\\(?:text|mbox|textbf|textit)\{[^{}]*\}/g, '');
    return !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。！？；：“”‘’]/u.test(withoutTextMacros);
  }

  function tokenizeResidualLatex(input, { allowNumeric = false } = {}) {
    const text = String(input ?? '');
    const tokens = [];
    let plainStart = 0;
    let cursor = 0;

    const flushPlain = (end) => {
      if (end > plainStart) tokens.push({ type: 'text', raw: text.slice(plainStart, end) });
    };

    while (cursor < text.length) {
      if (isEscapedDelimiter(text, cursor)) {
        cursor += 1;
        continue;
      }

      let open = '';
      let close = '';
      let display = false;
      let allowNewline = false;
      if (text.startsWith('$$', cursor)) {
        open = '$$';
        close = '$$';
        display = true;
        allowNewline = true;
      } else if (text.startsWith('\\[', cursor)) {
        open = '\\[';
        close = '\\]';
        display = true;
        allowNewline = true;
      } else if (text.startsWith('\\(', cursor)) {
        open = '\\(';
        close = '\\)';
      } else if (text[cursor] === '$') {
        open = '$';
        close = '$';
      }

      if (!open) {
        cursor += 1;
        continue;
      }

      const end = findResidualClosing(text, cursor + open.length, close, allowNewline);
      if (end < 0) {
        cursor += open.length;
        continue;
      }

      const content = text.slice(cursor + open.length, end);
      if (!isPlausibleResidualLatex(content)
        || (!display && open === '$' && (content.includes('\n') || (!allowNumeric && isCurrencyLikeInlineLatex(content))))) {
        cursor += open.length;
        continue;
      }

      flushPlain(cursor);
      tokens.push({
        type: 'math',
        raw: text.slice(cursor, end + close.length),
        content,
        display,
      });
      cursor = end + close.length;
      plainStart = cursor;
    }

    flushPlain(text.length);
    return tokens;
  }

  function getKatexRenderer() {
    try {
      if (typeof katex !== 'undefined' && katex && typeof katex.render === 'function') return katex;
    } catch (_) {
      // A missing @require should degrade to the original literal text.
    }
    try {
      if (window.katex && typeof window.katex.render === 'function') return window.katex;
    } catch (_) {
      // Ignore page-realm access failures.
    }
    return null;
  }

  function installKatexCss() {
    try {
      if (typeof GM_getResourceText !== 'function') return false;
      const resource = GM_getResourceText('ophelKatexCss');
      if (!resource) return false;
      const base = 'https://cdn.jsdelivr.net/npm/katex@0.16.44/dist/';
      const css = String(resource).replace(/url\(\s*(["']?)(fonts\/[^"')\s]+)\1\s*\)/g, (_match, quote, path) => `url("${base}${path}")`);
      let style = document.getElementById(KATEX_STYLE_ID);
      if (!style) style = document.createElement('style');
      style.id = KATEX_STYLE_ID;
      style.textContent = css;
      const parent = document.head || document.documentElement;
      if (parent && style.parentNode !== parent) parent.appendChild(style);
      return true;
    } catch (_) {
      // Resource APIs can be unavailable in some userscript managers. Existing
      // page styles and the @require renderer may still be usable.
      return false;
    }
  }

  function residualExcludedElement(element) {
    if (!(element instanceof Element)) return true;
    return Boolean(element.closest([
      'pre', 'code', '[data-markdown-copy="inline-code"]', 'textarea', 'input', 'select', 'option', 'script', 'style', 'noscript',
      '[contenteditable="true"]', '.katex', '.MathJax', 'mjx-container', 'math', 'annotation',
      '[data-latex]', '[data-math-source]', `.${RESIDUAL_WRAPPER_CLASS}`, `#${PANEL_ID}`, `#${TOGGLE_ID}`, '[aria-hidden="true"]',
    ].join(',')));
  }

  function repairResidualBold(root) {
    if (!root.textContent?.includes('**')) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const proseBlock = node.parentElement?.closest('p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, figcaption');
        if (!node.nodeValue?.includes('**') || residualExcludedElement(node.parentElement)
          || !proseBlock || !root.contains(proseBlock)
          || node.parentElement?.closest('strong, b, a, button')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);

    for (const textNode of nodes) {
      const text = textNode.nodeValue || '';
      const pattern = /\*\*([^*\r\n]{1,240})\*\*/g;
      const fragment = document.createDocumentFragment();
      let last = 0;
      let changed = false;
      for (const match of text.matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        const content = match[1];
        if (content.trim() !== content || isEscapedDelimiter(text, start)
          || isEscapedDelimiter(text, end - 2)
          || /[A-Za-z0-9_]/.test(text[start - 1] || '')
          || /[A-Za-z0-9_]/.test(text[end] || '')) continue;
        fragment.appendChild(document.createTextNode(text.slice(last, start)));
        const strong = document.createElement('strong');
        strong.textContent = content;
        fragment.appendChild(strong);
        last = end;
        changed = true;
      }
      if (!changed) continue;
      fragment.appendChild(document.createTextNode(text.slice(last)));
      textNode.parentNode?.replaceChild(fragment, textNode);
    }
  }

  function assistantRoleFor(element) {
    if (!(element instanceof Element)) return null;
    return element.closest(`${dom.assistant}, [role="assistant"]`);
  }

  function assistantContentRoot(element) {
    const role = assistantRoleFor(element);
    if (!role || residualExcludedElement(role)) return null;
    const content = element.closest(dom.content);
    if (content && assistantRoleFor(content) === role && !residualExcludedElement(content)) return content;
    return role.querySelector?.(dom.content) || role;
  }

  function collectAssistantRoots(scanRoot) {
    const roots = new Set();
    const root = scanRoot instanceof Element ? scanRoot : document.body || document.documentElement;
    if (!root) return roots;
    if (root.matches?.(`${dom.assistant}, [role="assistant"], ${dom.content}`)) {
      const own = assistantContentRoot(root);
      if (own) roots.add(own);
    }
    root.querySelectorAll?.(`${dom.assistant}, [role="assistant"]`).forEach((role) => {
      if (residualExcludedElement(role)) return;
      const content = role.querySelector(dom.content);
      roots.add(content || role);
    });
    return roots;
  }

  function renderResidualMath(token) {
    const renderer = getKatexRenderer();
    if (!renderer) return null;
    const render = (content) => {
      const holder = document.createElement('span');
      holder.className = RESIDUAL_WRAPPER_CLASS;
      holder.dataset.cgfcResidualLatex = 'true';
      holder.dataset.cgfcResidualDisplay = token.display ? 'true' : 'false';
      holder.dataset.cgfcLatex = content;
      holder.setAttribute('aria-label', token.raw);
      holder.title = token.raw;
      renderer.render(content, holder, {
        displayMode: Boolean(token.display),
        trust: false,
        throwOnError: true,
        strict: 'warn',
      });
      return holder;
    };
    try {
      return render(token.content);
    } catch (_) {
      // Markdown can consume the escape on \{ and \} after \left/\right.
      // Retry only an otherwise rejected formula; preserve its original label.
      const repaired = token.content.replace(/\\(left|right)\s*([{}])/g, '\\$1\\$2');
      if (repaired === token.content) return null;
      try {
        return render(repaired);
      } catch (_) {
        return null;
      }
    }
  }

  function isNumericMathTableCell(textNode) {
    const cell = textNode.parentElement?.closest('td, th');
    const table = cell?.closest('table');
    return Boolean(table && cell.textContent?.trim() === textNode.nodeValue?.trim()
      && table.querySelector('.katex, math, .cgfc-residual-latex'));
  }

  function rememberResidualMutation(parent, count = 1) {
    residualSelfMutationCounts.set(parent, (residualSelfMutationCounts.get(parent) || 0) + count);
  }

  function restoreInvalidResidualMath(root) {
    root.querySelectorAll(`.${RESIDUAL_WRAPPER_CLASS}[data-cgfc-latex]`).forEach((holder) => {
      if (isPlausibleResidualLatex(holder.dataset.cgfcLatex)) return;
      const parent = holder.parentElement;
      if (!parent) return;
      const raw = holder.getAttribute('aria-label') || `$${holder.dataset.cgfcLatex || ''}$`;
      rememberResidualMutation(parent);
      parent.replaceChild(document.createTextNode(raw), holder);
    });
  }

  function repairFragmentedInlineMath(root) {
    // The current Markdown renderer can split "$X_i$" into an LTR span holding
    // "$X_i" and a following text node beginning with the closing "$".
    // Pair those adjacent pieces before scanning the remaining text nodes.
    root.querySelectorAll('span[dir="ltr"]:not([data-markdown-copy])').forEach((span) => {
      const raw = span.textContent?.trim() || '';
      const next = span.nextSibling;
      if (!(next?.nodeType === Node.TEXT_NODE && next.nodeValue?.startsWith('$'))
        || !raw.startsWith('$') || raw.includes('$', 1)) return;
      const content = raw.slice(1);
      if (!isPlausibleResidualLatex(content) || isCurrencyLikeInlineLatex(content)) return;
      const holder = renderResidualMath({ content, raw: `$${content}$`, display: false });
      const parent = span.parentElement;
      if (!holder || !parent) return;
      rememberResidualMutation(parent, 2);
      parent.replaceChild(holder, span);
      next.nodeValue = next.nodeValue.slice(1);
    });
  }

  function repairInlineMathAcrossNodes(root) {
    // ChatGPT can put the opening "$x" in an isolate, the rest in a text node,
    // or split a formula between spans around punctuation. Pair delimiters
    // within one text block without crossing code, links, or rendered math.
    const inlineTags = new Set(['SPAN', 'EM', 'STRONG', 'B', 'I', 'U', 'S', 'SUP', 'SUB', 'SMALL', 'MARK', 'DEL', 'INS']);
    const blockSelector = 'p, li, h1, h2, h3, h4, h5, h6, td, th, figcaption';
    const blocks = root.matches?.(blockSelector) ? [root] : root.querySelectorAll(blockSelector);
    const boundary = (nodes, offset, end) => {
      let passed = 0;
      for (const node of nodes) {
        const length = node.nodeValue?.length || 0;
        if (end ? offset > passed && offset <= passed + length : offset >= passed && offset < passed + length) {
          return { node, offset: offset - passed };
        }
        passed += length;
      }
      return null;
    };

    for (const block of blocks) {
      if (!block.textContent?.includes('$') || residualExcludedElement(block)) continue;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const runs = [];
        let run = [];
        const flush = () => {
          if (run.length) runs.push(run);
          run = [];
        };
        const visit = (node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            if (node.nodeValue) run.push(node);
          } else if (node instanceof Element && inlineTags.has(node.tagName) && !residualExcludedElement(node)) {
            node.childNodes.forEach(visit);
          } else flush();
        };
        block.childNodes.forEach(visit);
        flush();

        let repaired = false;
        for (const nodes of runs) {
          const text = nodes.map((node) => node.nodeValue).join('');
          if (!text.includes('$')) continue;
          let offset = 0;
          for (const token of tokenizeResidualLatex(text)) {
            const start = offset;
            offset += token.raw.length;
            if (token.type !== 'math' || token.display || !token.raw.startsWith('$') || token.raw.startsWith('$$')) continue;
            const from = boundary(nodes, start, false);
            const to = boundary(nodes, offset, true);
            if (!from || !to || from.node === to.node) continue;
            const holder = renderResidualMath(token);
            if (!holder) continue;
            const range = document.createRange();
            range.setStart(from.node, from.offset);
            range.setEnd(to.node, to.offset);
            range.deleteContents();
            range.insertNode(holder);
            repaired = true;
            break;
          }
          if (repaired) break;
        }
        if (!repaired) break;
      }
    }
  }

  function nextResidualBatch(state, batchSize) {
    const start = state.index;
    const end = Math.min(state.nodes.length, start + batchSize);
    state.index = end;
    return state.nodes.slice(start, end);
  }

  function scanAssistantRoot(root) {
    if (!(root instanceof Element) || !root.isConnected) return false;
    let state = residualRootWork.get(root);
    if (!state) repairResidualBold(root);
    if (!settings.enableResidualLatex) {
      residualRootWork.delete(root);
      return false;
    }
    root.setAttribute(RESIDUAL_ROOT_MARKER, 'true');
    if (!state) {
      restoreInvalidResidualMath(root);
      repairFragmentedInlineMath(root);
      repairInlineMathAcrossNodes(root);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return residualExcludedElement(node.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
      });
      const nodes = [];
      let node;
      while ((node = walker.nextNode())) nodes.push(node);
      state = { nodes, index: 0 };
      residualRootWork.set(root, state);
    }
    const pending = nextResidualBatch(state, RESIDUAL_MAX_TEXT_NODES);
    pending.forEach((textNode) => {
      if (!textNode.isConnected || residualExcludedElement(textNode.parentElement)) return;
      const tokens = tokenizeResidualLatex(textNode.nodeValue || '', {
        allowNumeric: isNumericMathTableCell(textNode),
      });
      if (!tokens.some((token) => token.type === 'math')) return;
      const fragment = document.createDocumentFragment();
      let rendered = true;
      tokens.forEach((token) => {
        if (!rendered) return;
        if (token.type === 'text') fragment.appendChild(document.createTextNode(token.raw));
        else {
          const holder = renderResidualMath(token);
          if (!holder) rendered = false;
          else fragment.appendChild(holder);
        }
      });
      if (rendered) {
        const parent = textNode.parentNode;
        if (parent instanceof Element) {
          rememberResidualMutation(parent);
          parent.replaceChild(fragment, textNode);
        }
      }
    });
    const remaining = state.index < state.nodes.length;
    if (!remaining) residualRootWork.delete(root);
    return remaining;
  }

  function queueResidualRoot(root, invalidate = false) {
    if (!(root instanceof Element) || residualExcludedElement(root)
      || (!settings.enableResidualLatex && !root.textContent?.includes('**'))) return;
    if (invalidate) residualRootWork.delete(root);
    residualLatexRoots.add(root);
    clearTimeout(residualLatexTimer);
    residualLatexTimer = setTimeout(() => {
      residualLatexTimer = 0;
      const roots = Array.from(residualLatexRoots);
      residualLatexRoots.clear();
      roots.forEach((candidate) => {
        if (scanAssistantRoot(candidate)) queueResidualRoot(candidate);
      });
    }, RESIDUAL_DEBOUNCE_MS);
  }

  function scanAssistantRoots(scanRoot) {
    collectAssistantRoots(scanRoot).forEach((root) => queueResidualRoot(root, true));
  }

  function queueResidualMutations(mutations) {
    const dirtyRoots = new Set();
    for (const mutation of mutations) {
      const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
      if (target && (residualExcludedElement(target) || target.closest?.(`.${RESIDUAL_WRAPPER_CLASS}`))) continue;
      const selfMutationCount = target && residualSelfMutationCounts.get(target);
      if (selfMutationCount) {
        if (selfMutationCount <= 1) residualSelfMutationCounts.delete(target);
        else residualSelfMutationCounts.set(target, selfMutationCount - 1);
        continue;
      }
      let externalNode = false;
      mutation.addedNodes?.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE && node.closest?.(`.${RESIDUAL_WRAPPER_CLASS}`)) return;
        externalNode = true;
        if (node.nodeType === Node.ELEMENT_NODE) collectAssistantRoots(node).forEach(root => dirtyRoots.add(root));
        else if (node.nodeType === Node.TEXT_NODE) {
          const root = assistantContentRoot(node.parentElement);
          if (root) dirtyRoots.add(root);
        }
      });
      if ((externalNode || mutation.type === 'characterData') && target) {
        const root = assistantContentRoot(target);
        if (root) dirtyRoots.add(root);
      }
    }
    // Each root performs the existing full-text gate and invalidates pending
    // parsing once per delivery, regardless of how many DOM records it owns.
    dirtyRoots.forEach(root => queueResidualRoot(root, true));
  }

  function startResidualLatexObserver() {
    if (residualLatexObserverStarted) return;
    residualLatexObserverStarted = true;
    onReady(() => {
      installKatexCss();
      scanAssistantRoots();
      const observer = new MutationObserver(queueResidualMutations);
      observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
    });
  }

  function unwrapFormulaDelimiters(value) {
    let text = String(value || '').trim();
    if (!text) return '';
    const pairs = [['$$', '$$'], ['\\(', '\\)'], ['\\[', '\\]'], ['$', '$']];
    for (let depth = 0; depth < 4; depth += 1) {
      const pair = pairs.find(([open, close]) =>
        text.startsWith(open) && text.endsWith(close) && text.length > open.length + close.length);
      if (!pair) break;
      const inner = text.slice(pair[0].length, text.length - pair[1].length).trim();
      if (!inner) break;
      text = inner;
    }
    return text;
  }

  function extractFormulaCopyPayload(target) {
    const element = target instanceof Element ? target : target?.parentElement;
    if (!element) return null;
    if (element.closest(`#${PANEL_ID}, #${TOGGLE_ID}, textarea, input, [contenteditable="true"]`)) return null;

    const host = element.closest([
      `.${RESIDUAL_WRAPPER_CLASS}`,
      '.math-block',
      '.math-inline',
      '.katex-display',
      '.katex',
      'math',
      '[data-latex]',
      '[data-math]',
      '[data-math-source]',
      '[data-custom-copy-text]',
      'annotation[encoding="application/x-tex"]',
    ].join(', '));
    if (!host) return null;

    const residual = host.closest(`.${RESIDUAL_WRAPPER_CLASS}`) || element.closest(`.${RESIDUAL_WRAPPER_CLASS}`);
    if (residual?.dataset.cgfcLatex) {
      return {
        latex: unwrapFormulaDelimiters(residual.dataset.cgfcLatex),
        isBlock: residual.dataset.cgfcResidualDisplay === 'true',
      };
    }

    const dataHost = host.closest('[data-latex], [data-math], [data-math-source], [data-custom-copy-text]');
    if (dataHost) {
      const raw = dataHost.getAttribute('data-latex')
        || dataHost.getAttribute('data-math')
        || dataHost.getAttribute('data-math-source')
        || dataHost.getAttribute('data-custom-copy-text')
        || dataHost.getAttribute('copy-text')
        || '';
      const latex = unwrapFormulaDelimiters(raw);
      if (latex) {
        return {
          latex,
          isBlock: dataHost.matches('.math-block, [data-math-display="true"]') || Boolean(dataHost.querySelector('.katex-display')),
        };
      }
    }

    const katexDisplay = host.matches('.katex-display') ? host : host.closest('.katex-display');
    const katex = host.matches('.katex') ? host : host.querySelector?.('.katex') || host.closest('.katex');
    const math = host.matches('math') ? host : host.querySelector?.('math') || katex?.querySelector?.('math') || host.closest('math');
    const annotation = host.matches('annotation[encoding="application/x-tex"]')
      ? host
      : katex?.querySelector?.('annotation[encoding="application/x-tex"]')
        || math?.querySelector?.('annotation[encoding="application/x-tex"]')
        || host.querySelector?.('annotation[encoding="application/x-tex"]');
    const latex = unwrapFormulaDelimiters(annotation?.textContent || '');
    if (!latex) return null;
    return {
      latex,
      isBlock: Boolean(katexDisplay || katex?.closest('.katex-display') || math?.getAttribute?.('display') === 'block'),
    };
  }

  function formatFormulaCopy(payload) {
    const latex = unwrapFormulaDelimiters(String(payload?.latex || '').replace(/\r\n?/g, '\n'));
    if (!latex) return '';
    if (!settings.formulaCopyDelimiters) return latex;
    if (!payload.isBlock) return `$${latex}$`;
    return `$$\n${latex}\n$$`;
  }

  async function writeClipboardText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      Object.assign(textarea.style, {
        position: 'fixed',
        left: '-9999px',
        top: '0',
        opacity: '0',
      });
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      textarea.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function showFormulaCopyToast(message) {
    const id = 'cgfc-formula-copy-toast';
    document.getElementById(id)?.remove();
    const toast = document.createElement('div');
    toast.id = id;
    toast.textContent = message;
    Object.assign(toast.style, {
      position: 'fixed',
      left: '50%',
      bottom: '28px',
      zIndex: '2147483647',
      transform: 'translateX(-50%)',
      padding: '7px 11px',
      border: '1px solid var(--cgfc-theme-border, rgba(0,0,0,.14))',
      borderRadius: '8px',
      background: 'color-mix(in srgb, var(--cgfc-theme-surface-primary, #fff) 94%, transparent)',
      color: 'var(--cgfc-theme-text-primary, #161616)',
      boxShadow: 'var(--cgfc-theme-shadow-soft, 0 4px 16px rgba(0,0,0,.18))',
      font: '12px/1.35 system-ui, "Microsoft YaHei", sans-serif',
      backdropFilter: 'blur(10px)',
      pointerEvents: 'none',
    });
    document.body?.appendChild(toast);
    setTimeout(() => toast.remove(), 1500);
  }

  function startFormulaCopy() {
    if (formulaCopyInitialized) return;
    formulaCopyInitialized = true;
    document.addEventListener('dblclick', async (event) => {
      if (!settings.enableFormulaCopy) return;
      const payload = extractFormulaCopyPayload(event.target);
      if (!payload?.latex) return;
      event.preventDefault();
      event.stopPropagation();
      const text = formatFormulaCopy(payload);
      const ok = text ? await writeClipboardText(text) : false;
      showFormulaCopyToast(ok ? '已复制公式 LaTeX' : '公式复制失败');
    }, true);
  }

  function onReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  const STATIC_CSS = `
    html[data-cgfc-stable-scroll-boundary],
    html[data-cgfc-stable-scroll-boundary] :is(main, [role="main"]) .thread-scroll-container {
      overscroll-behavior-y: none !important;
    }

    /* The current footer paints a full-width solid surface and fade behind
       its composer. Clear only those direct decorative layers; the actual
       rounded input surface, content, controls and scroll container are intact. */
    main [data-thread-scroll-footer="true"] > [aria-hidden="true"],
    main .thread-scroll-container [aria-hidden="true"].sticky.bottom-0 > [aria-hidden="true"] {
      background: transparent !important;
      box-shadow: none !important;
      pointer-events: none !important;
    }

    html {
      --cgfc-theme-surface-primary: var(--main-surface-primary, var(--bg-primary, #ffffff));
      --cgfc-theme-surface-secondary: var(--main-surface-secondary, var(--bg-secondary, #f4f4f4));
      --cgfc-theme-text-primary: var(--text-primary, #161616);
      --cgfc-theme-text-secondary: var(--text-secondary, #555555);
      --cgfc-theme-text-tertiary: var(--text-tertiary, #777777);
      --cgfc-theme-border: var(--border-light, rgba(0, 0, 0, .14));
      --cgfc-theme-warning: #9a5b00;
      --cgfc-theme-shadow-soft: 0 6px 22px rgba(0, 0, 0, .14);
      --cgfc-theme-shadow-strong: 0 14px 36px rgba(0, 0, 0, .18);
      --cgfc-theme-overlay: rgba(0, 0, 0, .42);
      color-scheme: var(--cgfc-color-scheme, light);
    }

    html[data-cgfc-theme="dark"] {
      --cgfc-theme-surface-primary: var(--main-surface-primary, var(--bg-primary, #212121));
      --cgfc-theme-surface-secondary: var(--main-surface-secondary, var(--bg-secondary, #2f2f2f));
      --cgfc-theme-text-primary: var(--text-primary, #f4f4f4);
      --cgfc-theme-text-secondary: var(--text-secondary, #c7c7c7);
      --cgfc-theme-text-tertiary: var(--text-tertiary, #a3a3a3);
      --cgfc-theme-border: var(--border-light, rgba(255, 255, 255, .14));
      --cgfc-theme-warning: #f4bd72;
      --cgfc-theme-shadow-soft: 0 8px 28px rgba(0, 0, 0, .38);
      --cgfc-theme-shadow-strong: 0 14px 36px rgba(0, 0, 0, .42);
      --cgfc-theme-overlay: rgba(0, 0, 0, .58);
      --cgfc-neu-highlight: rgba(255, 255, 255, .026);
      --cgfc-neu-highlight-edge: rgba(255, 255, 255, .060);
      --cgfc-neu-shadow: rgba(0, 0, 0, .44);
      --cgfc-neu-shadow-inset: rgba(0, 0, 0, .18);
    }

    /* v1.6.2 refined dark Soft UI: restrained depth, one consistent light source. */
    html[data-cgfc-theme="dark"][data-cgfc-neumorphic-appearance] [data-cgfc-neumorphic-composer="true"]:not([data-cgfc-liquid-composer]) {
      background: color-mix(in srgb, var(--cgfc-theme-surface-primary, #212121) 98%, white 2%) !important;
      border-color: rgba(255, 255, 255, .018) !important;
      box-shadow:
        -6px -6px 16px var(--cgfc-neu-highlight),
        7px 8px 20px var(--cgfc-neu-shadow),
        inset 0 1px 0 var(--cgfc-neu-highlight-edge),
        inset 0 -1px 0 rgba(0, 0, 0, .28) !important;
      transition: box-shadow 180ms ease, background 180ms ease, border-color 180ms ease;
    }

    html[data-cgfc-theme="dark"][data-cgfc-neumorphic-appearance] [data-cgfc-neumorphic-composer="true"]:not([data-cgfc-liquid-composer]):has(#prompt-textarea:focus, textarea[name="prompt-textarea"]:focus, [contenteditable="true"]:focus) {
      background: color-mix(in srgb, var(--cgfc-theme-surface-primary, #212121) 99%, white 1%) !important;
      border-color: rgba(255, 255, 255, .028) !important;
      box-shadow:
        -3px -3px 10px rgba(255, 255, 255, .018),
        5px 6px 14px rgba(0, 0, 0, .34),
        inset 4px 4px 12px var(--cgfc-neu-shadow-inset),
        inset -3px -3px 10px rgba(255, 255, 255, .012),
        inset 0 1px 0 rgba(255, 255, 255, .045) !important;
    }

    html[data-cgfc-theme="dark"][data-cgfc-neumorphic-appearance] .cgpt-queue-capsule {
      background: linear-gradient(145deg,
        color-mix(in srgb, var(--cgfc-queue-panel-background, var(--cgfc-theme-surface-primary, #212121)) 97%, white 3%),
        color-mix(in srgb, var(--cgfc-queue-panel-background, var(--cgfc-theme-surface-primary, #212121)) 98%, black 2%));
      border-color: rgba(255, 255, 255, .032);
      box-shadow:
        -4px -4px 11px rgba(255, 255, 255, .022),
        5px 6px 14px rgba(0, 0, 0, .40),
        inset 0 1px 0 rgba(255, 255, 255, .055),
        inset 0 -1px 0 rgba(0, 0, 0, .24);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }

    html[data-cgfc-theme="dark"][data-cgfc-neumorphic-appearance] .cgpt-queue-capsule:hover {
      transform: translateY(-1px);
      background: linear-gradient(145deg,
        color-mix(in srgb, var(--cgfc-queue-panel-background, var(--cgfc-theme-surface-primary, #212121)) 95%, white 5%),
        color-mix(in srgb, var(--cgfc-queue-panel-background, var(--cgfc-theme-surface-primary, #212121)) 98%, black 2%));
      box-shadow:
        -4px -4px 12px rgba(255, 255, 255, .028),
        6px 7px 16px rgba(0, 0, 0, .43),
        inset 0 1px 0 rgba(255, 255, 255, .065),
        inset 0 -1px 0 rgba(0, 0, 0, .22);
    }

    html[data-cgfc-theme="dark"][data-cgfc-neumorphic-appearance] .cgpt-queue-capsule:active {
      transform: translateY(0) scale(.985);
      box-shadow:
        inset 3px 3px 9px rgba(0, 0, 0, .24),
        inset -2px -2px 7px rgba(255, 255, 255, .014),
        0 2px 6px rgba(0, 0, 0, .24);
    }

    html[data-cgfc-theme="dark"][data-cgfc-neumorphic-appearance] .cgpt-queue-panel {
      background: color-mix(in srgb, var(--cgfc-queue-panel-background, var(--cgfc-theme-surface-primary, #212121)) 98%, white 2%);
      border-color: rgba(255, 255, 255, .035);
      box-shadow:
        -7px -7px 20px rgba(255, 255, 255, .015),
        12px 14px 32px rgba(0, 0, 0, .44),
        inset 0 1px 0 rgba(255, 255, 255, .045),
        inset 0 -1px 0 rgba(0, 0, 0, .24);
    }

    html[data-cgfc-theme="dark"][data-cgfc-neumorphic-appearance] .cgpt-queue-row {
      background: color-mix(in srgb, var(--cgfc-theme-surface-secondary, #2f2f2f) 62%, transparent);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, .020), inset 0 -1px 0 rgba(0, 0, 0, .12);
    }

    html[data-cgfc-theme="dark"][data-cgfc-neumorphic-appearance] .cgpt-queue-compose-row {
      border-color: rgba(255, 255, 255, .030);
      background: color-mix(in srgb, var(--cgfc-theme-surface-primary, #212121) 97%, black 3%);
      box-shadow:
        -3px -3px 9px rgba(255, 255, 255, .014),
        4px 5px 12px rgba(0, 0, 0, .24),
        inset 0 1px 0 rgba(255, 255, 255, .035),
        inset 0 -1px 0 rgba(0, 0, 0, .14);
    }

    html[data-cgfc-theme="dark"][data-cgfc-neumorphic-appearance] .cgpt-queue-compose-row:focus-within {
      border-color: color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 22%, rgba(255, 255, 255, .04));
      box-shadow:
        -2px -2px 7px rgba(255, 255, 255, .012),
        3px 4px 10px rgba(0, 0, 0, .20),
        0 0 0 2px color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 6%, transparent),
        inset 2px 2px 7px rgba(0, 0, 0, .12),
        inset 0 1px 0 rgba(255, 255, 255, .032);
    }

    html[data-cgfc-theme="dark"][data-cgfc-neumorphic-appearance] .cgpt-queue-compose textarea {
      border: 0;
      background: transparent;
      box-shadow: none !important;
    }

    html[data-cgfc-theme="dark"][data-cgfc-neumorphic-appearance] .cgpt-queue-edit-text {
      border-color: rgba(255, 255, 255, .025);
      background: color-mix(in srgb, var(--cgfc-theme-surface-primary, #212121) 96%, black 4%);
      box-shadow:
        inset 2px 2px 7px rgba(0, 0, 0, .18),
        inset -1px -1px 5px rgba(255, 255, 255, .012),
        inset 0 1px 0 rgba(255, 255, 255, .025);
    }

    html[data-cgfc-theme="dark"][data-cgfc-neumorphic-appearance] .cgpt-queue-edit-text:focus {
      border-color: color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 30%, rgba(255, 255, 255, .05));
      box-shadow:
        inset 2px 2px 7px rgba(0, 0, 0, .20),
        inset -1px -1px 5px rgba(255, 255, 255, .014),
        0 0 0 2px color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 9%, transparent);
    }

    html[data-cgfc-theme="dark"][data-cgfc-neumorphic-appearance] .cgpt-queue-compose-row.cgpt-queue-file-dragover {
      border-color: color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 50%, white 10%);
      background: color-mix(in srgb, var(--cgfc-theme-surface-primary, #212121) 94%, var(--cgfc-queue-accent-color, #6d5dfc) 6%);
      box-shadow:
        0 0 0 3px color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 10%, transparent),
        4px 5px 12px rgba(0, 0, 0, .20),
        inset 0 1px 0 rgba(255, 255, 255, .035);
    }

    html[data-cgfc-theme="dark"][data-cgfc-neumorphic-appearance] .cgpt-queue-enqueue:not(:disabled) {
      background: linear-gradient(145deg,
        color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 90%, white 10%),
        color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 96%, black 4%));
      box-shadow:
        -2px -2px 6px rgba(255, 255, 255, .020),
        3px 4px 9px rgba(0, 0, 0, .26),
        0 3px 9px color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 12%, transparent),
        inset 0 1px 0 rgba(255, 255, 255, .28),
        inset 0 -1px 0 rgba(0, 0, 0, .14);
    }

    html[data-cgfc-theme="dark"][data-cgfc-neumorphic-appearance] .cgpt-queue-enqueue:not(:disabled):hover {
      box-shadow:
        -2px -2px 7px rgba(255, 255, 255, .024),
        4px 5px 11px rgba(0, 0, 0, .28),
        0 4px 11px color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 15%, transparent),
        inset 0 1px 0 rgba(255, 255, 255, .32),
        inset 0 -1px 0 rgba(0, 0, 0, .13);
    }

    html[data-cgfc-theme="dark"][data-cgfc-neumorphic-appearance] .cgpt-queue-enqueue:not(:disabled):active {
      box-shadow:
        inset 3px 3px 9px rgba(0, 0, 0, .25),
        inset -2px -2px 7px rgba(255, 255, 255, .045),
        0 2px 7px color-mix(in srgb, var(--cgfc-queue-accent-color, #6d5dfc) 15%, transparent);
    }

    /* Shift the reading column's two edges independently. The native wrapper
       supplies the responsive width; container units keep expansion within the
       transcript viewport, and the minimum width prevents a collapsed column. */
    html[data-cgfc-body-column-adjust] main [data-thread-user-message-navigation-content] {
      --cgfc-column-base-width: min(100cqw, var(--thread-body-max-width, 800px));
      --cgfc-column-side-space: max(0px, calc((100cqw - var(--cgfc-column-base-width)) / 2));
      --cgfc-column-left: max(calc(-1 * var(--cgfc-column-side-space)), var(--cgfc-body-column-left-offset, 0px));
      --cgfc-column-right: max(calc(-1 * var(--cgfc-column-side-space)), var(--cgfc-body-column-right-offset, 0px));
      --cgfc-column-target-width: min(100cqw, max(160px, calc(var(--cgfc-column-base-width) - var(--cgfc-column-left) - var(--cgfc-column-right))));
      width: var(--cgfc-column-target-width) !important;
      max-width: var(--cgfc-column-target-width) !important;
      left: clamp(
        calc((var(--cgfc-column-target-width) - 100cqw) / 2),
        calc((var(--cgfc-column-left) - var(--cgfc-column-right)) / 2),
        calc((100cqw - var(--cgfc-column-target-width)) / 2)
      ) !important;
    }

    html[data-cgfc-body-font] body,
    html[data-cgfc-body-font] ${chatContentSelector},
    html[data-cgfc-body-font] textarea,
    html[data-cgfc-body-font] [contenteditable="true"] {
      font-family: var(--cgfc-latin-font), var(--cgfc-chinese-font), serif !important;
    }

    /* The new renderer gives paragraphs/headings their own --font-content.
       Scope its variables to messages; keep KaTeX/MathJax/code font metrics intact. */
    html[data-cgfc-body-font] ${chatContentSelector} {
      --font-content: var(--cgfc-latin-font), var(--cgfc-chinese-font), serif !important;
    }

    html[data-cgfc-body-font] ${dilTextSelector},
    html[data-cgfc-body-font] ${dilControlTextSelector} {
      font-family: var(--cgfc-latin-font), var(--cgfc-chinese-font), serif !important;
    }

    html[data-cgfc-font-size] ${dilBodyTextSelector},
    html[data-cgfc-font-size] ${dilControlTextSelector} {
      font-size: var(--cgfc-font-size) !important;
    }

    html[data-cgfc-body-font] ${chatContentSelector} :is([data-d-component="list"], [data-d-component="list-item"]) {
      font-family: var(--cgfc-latin-font), var(--cgfc-chinese-font), serif !important;
    }
    html[data-cgfc-font-size] ${chatContentSelector} :is([data-d-component="list"], [data-d-component="list-item"]) {
      font-size: var(--cgfc-font-size) !important;
    }

    /* Native small buttons/badges have fixed pixel heights. Let their boxes
       grow with text so a larger reading size cannot overlap the next row. */
    html[data-cgfc-font-size] ${chatContentSelector} :is([data-d-component="button"], [data-d-component="badge"]) {
      height: auto !important;
      min-height: 1.7em !important;
      line-height: 1.3 !important;
    }
    html[data-cgfc-font-size] ${chatContentSelector} :is([data-d-component="button"], [data-d-component="badge"], [data-d-component="popover-trigger"], [data-d-component="pressable"]) [data-d-component="text"]${dilTextExclusions} {
      line-height: 1.3 !important;
    }

    /* Keep native title hierarchy, scaled relative to the chosen body size. */
    html[data-cgfc-font-size] ${dilTextSelector}:where([data-d-component="title"]) {
      font-size: calc(var(--cgfc-font-size) * 1.125) !important;
    }
    html[data-cgfc-font-size] ${dilTextSelector}:where([data-d-component="title"][data-d-size="xl"]) {
      font-size: calc(var(--cgfc-font-size) * 1.25) !important;
    }
    html[data-cgfc-font-size] ${dilTextSelector}:where([data-d-component="title"][data-d-size="sm"], [data-d-component="title"][data-d-size="md"]) {
      font-size: var(--cgfc-font-size) !important;
    }

    html[data-cgfc-normal-color]:not([data-cgfc-light-native-normal][data-cgfc-theme="light"]) ${dilProseColorSelector} {
      color: var(--cgfc-normal-color) !important;
    }
    html[data-cgfc-line-height] ${dilBodyTextSelector} {
      line-height: var(--cgfc-line-height) !important;
    }

    html[data-cgfc-font-smoothing-mode] body,
    html[data-cgfc-font-smoothing-mode] ${chatContentSelector},
    html[data-cgfc-font-smoothing-mode] textarea,
    html[data-cgfc-font-smoothing-mode] [contenteditable="true"] {
      -webkit-font-smoothing: var(--cgfc-font-smoothing) !important;
      -moz-osx-font-smoothing: var(--cgfc-moz-font-smoothing) !important;
    }

    html[data-cgfc-text-rendering-mode] body,
    html[data-cgfc-text-rendering-mode] ${chatContentSelector},
    html[data-cgfc-text-rendering-mode] textarea,
    html[data-cgfc-text-rendering-mode] [contenteditable="true"] {
      text-rendering: var(--cgfc-text-rendering) !important;
    }

    html[data-cgfc-formula-copy] :is(.katex, .cgfc-residual-latex) {
      cursor: copy;
    }

    html[data-cgfc-formula-copy] :is(.katex, .cgfc-residual-latex):hover {
      border-radius: 4px;
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cgfc-formula-copy-border-color, currentColor) 70%, transparent);
    }

    html[data-cgfc-formula-copy] .cgfc-residual-latex:hover .katex {
      box-shadow: none;
    }

    html[data-cgfc-normal-color]:not([data-cgfc-light-native-normal][data-cgfc-theme="light"]) ${chatContentSelector} {
      color: var(--cgfc-normal-color) !important;
    }

    html[data-cgfc-font-size] ${chatContentSelector} {
      --markdown-font-size: var(--cgfc-font-size) !important;
      --codex-chat-font-size: var(--cgfc-font-size) !important;
      font-size: var(--cgfc-font-size) !important;
    }

    html[data-cgfc-thinking-overview-font-size] main [data-markdown-text-style="assistant-message"][data-markdown-text-tone="tertiary"] {
      --markdown-font-size: var(--cgfc-thinking-overview-font-size) !important;
      --codex-chat-font-size: var(--cgfc-thinking-overview-font-size) !important;
      font-size: var(--cgfc-thinking-overview-font-size) !important;
    }

    html[data-cgfc-thinking-overview-font-size] main [data-markdown-text-style="assistant-message"][data-markdown-text-tone="tertiary"] [data-d-component="text"]${dilTextExclusions} {
      font-size: var(--cgfc-thinking-overview-font-size) !important;
    }

    html[data-cgfc-formula-font-size] ${chatContentSelector} .katex,
    html[data-cgfc-formula-font-size] ${chatContentSelector} mjx-container,
    html[data-cgfc-formula-font-size] ${chatContentSelector} math:not(.katex math):not(mjx-container math) {
      font-size: var(--cgfc-formula-font-size) !important;
    }

    html[data-cgfc-line-height] ${chatContentSelector} {
      --markdown-line-height: var(--cgfc-line-height) !important;
      line-height: var(--cgfc-line-height) !important;
    }

    html[data-cgfc-normal-color]:not([data-cgfc-light-native-normal][data-cgfc-theme="light"]) ${proseTextSelector} {
      color: inherit !important;
    }

    html[data-cgfc-line-height] ${proseTextSelector} {
      line-height: inherit !important;
    }

    html[data-cgfc-line-height] ${chatContentSelector} :is(h1, h2, h3, h4, h5, h6) {
      line-height: 1.35 !important;
    }

    html[data-cgfc-code-font] ${chatContentSelector} :is(pre, code, [data-markdown-copy="inline-code"]) {
      font-family: var(--cgfc-code-font) !important;
    }

    html[data-cgfc-code-font-size] ${chatContentSelector} :is(pre, code, [data-markdown-copy="inline-code"]) {
      font-size: var(--cgfc-code-font-size) !important;
    }

    html[data-cgfc-code-line-height] ${chatContentSelector} :is(pre, code, [data-markdown-copy="inline-code"]) {
      line-height: var(--cgfc-code-line-height) !important;
    }

    html[data-cgfc-wrap-code] ${chatContentSelector} pre {
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
    }

    html[data-cgfc-bold-font] ${boldTextSelector} {
      font-family: var(--cgfc-bold-latin-font), var(--cgfc-bold-chinese-font), serif !important;
    }

    html[data-cgfc-bold-color]:not([data-cgfc-light-native-bold][data-cgfc-theme="light"]) ${boldTextSelector} {
      color: var(--cgfc-bold-color) !important;
    }

    html[data-cgfc-bold-weight] ${boldTextSelector} {
      font-weight: var(--cgfc-bold-weight) !important;
    }

    /*
      Renderer-safe boundary:
      - Native MathML may use an installed OpenType math font.
      - KaTeX and MathJax retain their own webfonts and metrics. In particular,
        KaTeX negated relations can use private-use overlay glyphs that disappear
        when a system font is forced onto internal relation spans.
    */
    html[data-cgfc-math-font][data-cgfc-math-mode="native"] math,
    html[data-cgfc-math-font][data-cgfc-math-mode="native"] math * {
      font-family: var(--cgfc-math-font) !important;
    }

    /* KaTeX renders visible HTML rather than native MathML. This opt-in bridge
       only changes ordinary letter atoms; relations, operators, radicals,
       delimiters, size glyphs, and layout metrics keep KaTeX's own fonts. */
    html[data-cgfc-katex-letter-font][data-cgfc-math-font] .katex :is(
      .mord.mathnormal,
      .mord.mathit,
      .mord.mathbf,
      .mord.mathrm,
      .mord.boldsymbol,
      .mord.textnormal
    ) {
      font-family: var(--cgfc-math-font) !important;
    }

    /* Minimal layout boundary for recovered formulas. KaTeX internals retain
       the renderer's own font stack and metrics. */
    .${RESIDUAL_WRAPPER_CLASS} {
      display: inline-block;
      vertical-align: baseline;
    }

    .${RESIDUAL_WRAPPER_CLASS}[data-cgfc-residual-display="true"] {
      display: block;
      margin: .35em 0;
      text-align: center;
    }

    .${HIDDEN_DISCLAIMER_CLASS} {
      display: none !important;
    }

    #${TOGGLE_ID} {
      position: fixed;
      right: 14px;
      bottom: 18px;
      z-index: 2147483647;
      width: 38px;
      height: 38px;
      border: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .14));
      border-radius: 8px;
      background: color-mix(in srgb, var(--cgfc-theme-surface-primary, #fff) 90%, transparent);
      color: var(--cgfc-theme-text-primary, #161616);
      font: 700 16px/1 system-ui, "Microsoft YaHei", sans-serif;
      cursor: pointer;
      box-shadow: var(--cgfc-theme-shadow-soft, 0 8px 24px rgba(0, 0, 0, .18));
      -webkit-backdrop-filter: blur(12px) saturate(118%);
      backdrop-filter: blur(12px) saturate(118%);
    }

    #${PANEL_ID} {
      position: fixed;
      right: 14px;
      top: 14px;
      z-index: 2147483647;
      width: min(360px, calc(100vw - 28px));
      max-height: calc(100vh - 92px);
      box-sizing: border-box;
      padding: 14px;
      border: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .14));
      border-radius: 8px;
      background: color-mix(in srgb, var(--cgfc-theme-surface-primary, #fff) 96%, transparent);
      color: var(--cgfc-theme-text-primary, #161616);
      box-shadow: var(--cgfc-theme-shadow-strong, 0 14px 36px rgba(0, 0, 0, .18));
      font-family: system-ui, "Microsoft YaHei", sans-serif !important;
      font-size: 13px !important;
      line-height: 1.35 !important;
      overflow-y: auto;
      overscroll-behavior: contain;
      color-scheme: var(--cgfc-color-scheme, light);
      -webkit-backdrop-filter: blur(14px) saturate(118%);
      backdrop-filter: blur(14px) saturate(118%);
    }

    #${PANEL_ID}[hidden] {
      display: none !important;
    }

    #${PANEL_ID} h2 {
      margin: 0 0 10px;
      color: var(--cgfc-theme-text-primary, #161616);
      font-size: 14px;
      line-height: 1.3;
    }

    #${PANEL_ID} .cgfc-hint {
      margin: -2px 0 8px;
      color: var(--cgfc-theme-text-tertiary, #777);
      font-size: 12px;
      line-height: 1.5;
    }

    #${PANEL_ID} .cgfc-font-scan {
      display: grid;
      gap: 6px;
      margin-bottom: 10px;
    }

    #${PANEL_ID} .cgfc-font-scan .cgfc-hint {
      margin: 0;
    }

    #${FONT_STATUS_ID}[data-error] {
      color: var(--cgfc-theme-warning, #9a5b00);
    }

    #${PANEL_ID} label {
      display: grid;
      gap: 5px;
      margin: 9px 0;
    }

    #${PANEL_ID} .cgfc-check {
      grid-template-columns: 16px 1fr;
      align-items: center;
      gap: 8px;
    }

    #${PANEL_ID} input,
    #${PANEL_ID} select {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .14));
      border-radius: 6px;
      padding: 7px 8px;
      background: var(--cgfc-theme-surface-secondary, #f4f4f4);
      color: var(--cgfc-theme-text-primary, #161616);
      font: 13px/1.35 system-ui, "Microsoft YaHei", sans-serif;
    }

    #${PANEL_ID} input[type="checkbox"] {
      width: 16px;
      height: 16px;
      padding: 0;
      border-radius: 5px;
      appearance: none;
      -webkit-appearance: none;
      display: grid;
      place-items: center;
      background: var(--cgfc-theme-surface-primary, #fff);
      cursor: pointer;
    }

    #${PANEL_ID} input[type="checkbox"]:checked {
      border-color: #10a37f;
      background: #10a37f;
    }

    #${PANEL_ID} input[type="checkbox"]:checked::after {
      content: "";
      width: 5px;
      height: 9px;
      margin-top: -1px;
      border: solid #fff;
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }

    #${PANEL_ID} input[type="checkbox"]:focus-visible {
      outline: 2px solid rgba(78, 156, 255, .95);
      outline-offset: 2px;
    }

    #${PANEL_ID} input[type="color"] {
      height: 34px;
      padding: 3px;
    }

    #${PANEL_ID} .cgfc-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    #${PANEL_ID} .cgfc-settings-group {
      margin: 12px 0;
      padding: 0 10px 8px;
      border: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .14));
      border-radius: 8px;
      background: color-mix(in srgb, var(--cgfc-theme-text-primary, #161616) 3.5%, transparent);
    }

    #${PANEL_ID} .cgfc-settings-group > summary {
      margin: 0 -10px;
      padding: 10px;
      color: var(--cgfc-theme-text-primary, #161616);
      cursor: pointer;
      font-weight: 700;
      user-select: none;
    }

    #${PANEL_ID} .cgfc-settings-group[open] > summary {
      margin-bottom: 4px;
      border-bottom: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .12));
    }

    #${PANEL_ID} .cgfc-backup-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 12px 0;
    }

    #${PANEL_ID} .cgfc-backup-actions + input + .cgfc-hint {
      margin: 0 0 4px;
      overflow-wrap: anywhere;
    }

    #${PANEL_ID} > .cgfc-actions {
      position: sticky;
      bottom: -14px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 12px -14px -14px;
      padding: 10px 14px 14px;
      border-top: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .12));
      background: color-mix(in srgb, var(--cgfc-theme-surface-primary, #fff) 98%, transparent);
    }

    #${PANEL_ID} button {
      flex: 1;
      border: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .14));
      border-radius: 6px;
      padding: 8px;
      background: var(--cgfc-theme-surface-secondary, #f4f4f4);
      color: var(--cgfc-theme-text-primary, #161616);
      cursor: pointer;
      font: 13px/1 system-ui, "Microsoft YaHei", sans-serif;
    }

    #${PANEL_ID} button:hover,
    #${TOGGLE_ID}:hover {
      background: color-mix(in srgb, var(--cgfc-theme-text-primary, #161616) 10%, var(--cgfc-theme-surface-secondary, #f4f4f4));
    }


    #${PANEL_ID} .cgfc-control {
      display: grid;
      gap: 6px;
      margin: 9px 0;
    }

    #${PANEL_ID} .cgfc-control-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: 22px;
    }

    #${PANEL_ID} .cgfc-control-caption {
      min-width: 0;
      color: var(--cgfc-theme-text-primary, #161616);
    }

    #${PANEL_ID} .cgfc-control[data-override-disabled] > input,
    #${PANEL_ID} .cgfc-control[data-override-disabled] > select {
      opacity: .5;
      filter: saturate(.7);
    }

    #${PANEL_ID} button.cgfc-override-switch {
      position: relative;
      flex: 0 0 auto !important;
      width: 38px;
      min-width: 38px;
      height: 22px;
      padding: 2px !important;
      border: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .14));
      border-radius: 999px;
      background: color-mix(in srgb, var(--cgfc-theme-text-primary, #161616) 12%, transparent);
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, .2);
      transition: background 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
    }

    #${PANEL_ID} button.cgfc-override-switch:hover {
      background: color-mix(in srgb, var(--cgfc-theme-text-primary, #161616) 18%, transparent);
    }

    #${PANEL_ID} button.cgfc-override-switch[aria-pressed="true"] {
      border-color: rgba(16, 163, 127, .9);
      background: #10a37f;
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, .12), 0 0 0 1px rgba(16, 163, 127, .08);
    }

    #${PANEL_ID} .cgfc-override-switch-knob {
      display: block;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 4px rgba(0, 0, 0, .35);
      transform: translateX(0);
      transition: transform 150ms ease;
    }

    #${PANEL_ID} button.cgfc-override-switch[aria-pressed="true"] .cgfc-override-switch-knob {
      transform: translateX(16px);
    }

    #${PANEL_ID} button.cgfc-override-switch:focus-visible {
      outline: 2px solid rgba(78, 156, 255, .95);
      outline-offset: 2px;
    }

    #${PANEL_ID} .cgfc-override-hint {
      margin-top: 2px;
      padding: 8px 9px;
      border: 1px solid var(--cgfc-theme-border, rgba(0, 0, 0, .12));
      border-radius: 7px;
      background: color-mix(in srgb, var(--cgfc-theme-text-primary, #161616) 3.5%, transparent);
      color: var(--cgfc-theme-text-secondary, #555);
    }

    /* Cover nested option labels as well as cards outside Markdown. Independent
       overrides are opt-in; absent variables fall back to the body settings. */
    html:is([data-cgfc-body-font], [data-cgfc-intelligent-font]) ${dilAllTextSelector} {
      font-family: var(--cgfc-intelligent-font, var(--cgfc-latin-font, system-ui)), var(--cgfc-chinese-font, serif) !important;
    }
    html:is([data-cgfc-font-size], [data-cgfc-intelligent-size]) ${dilAllTextSelector} {
      font-size: var(--cgfc-intelligent-size, var(--cgfc-font-size)) !important;
    }
    html:is([data-cgfc-font-size], [data-cgfc-intelligent-size], [data-cgfc-intelligent-control-size]) ${dilAllControlTextSelector} {
      font-size: var(--cgfc-intelligent-control-size, var(--cgfc-intelligent-size, var(--cgfc-font-size))) !important;
    }
    html:is([data-cgfc-font-size], [data-cgfc-intelligent-size], [data-cgfc-intelligent-title-size]) ${dilAllTitleTextSelector} {
      font-size: var(--cgfc-intelligent-title-size, calc(var(--cgfc-intelligent-size, var(--cgfc-font-size)) * 1.125)) !important;
    }
    html:is([data-cgfc-font-size], [data-cgfc-intelligent-size]):not([data-cgfc-intelligent-title-size]) :is(${dilSurfaceSelector}:is([data-d-component="title"][data-d-size="xl"]), ${dilSurfaceSelector}:is([data-d-component="title"][data-d-size="xl"]) :is(span, strong, b))${dilTypographyExclusions} {
      font-size: calc(var(--cgfc-intelligent-size, var(--cgfc-font-size)) * 1.25) !important;
    }
    html:is([data-cgfc-font-size], [data-cgfc-intelligent-size]):not([data-cgfc-intelligent-title-size]) :is(${dilSurfaceSelector}:is([data-d-component="title"]):is([data-d-size="sm"], [data-d-size="md"]), ${dilSurfaceSelector}:is([data-d-component="title"]):is([data-d-size="sm"], [data-d-size="md"]) :is(span, strong, b))${dilTypographyExclusions} {
      font-size: var(--cgfc-intelligent-size, var(--cgfc-font-size)) !important;
    }
    html:is([data-cgfc-line-height], [data-cgfc-intelligent-line-height]) ${dilAllTextSelector} {
      line-height: var(--cgfc-intelligent-line-height, var(--cgfc-line-height)) !important;
    }
    html:is([data-cgfc-font-size], [data-cgfc-intelligent-size], [data-cgfc-intelligent-control-size]) ${dilChoiceSelector}:is(button, [role="button"], [role="tab"], [data-d-component="button"], [data-d-component="pressable"], [data-d-component="badge"]):not([role="radio"], [role="checkbox"]) {
      height: auto !important;
      min-height: 1.7em !important;
      white-space: normal !important;
    }

    /* Layered important declarations outrank this module's unlayered card
       typography, so citation size remains independent even in large buttons. */
    @layer cgfc-citation-typography {
      html[data-cgfc-citation-size] :is(main, [role="main"]) [data-cgfc-citation] {
        --cgfc-pill-size: var(--cgfc-citation-font-size);
      }
      html[data-cgfc-web-citation-size] :is(main, [role="main"]) [data-cgfc-web-citation] {
        --cgfc-pill-size: var(--cgfc-web-citation-font-size);
      }
      :is(html[data-cgfc-citation-size] [data-cgfc-citation], html[data-cgfc-web-citation-size] [data-cgfc-web-citation]),
      :is(html[data-cgfc-citation-size] [data-cgfc-citation], html[data-cgfc-web-citation-size] [data-cgfc-web-citation]) :is(span, div, small, strong, b, label, a, button):not(:where(svg *, math *, .katex, .katex *, .MathJax, .MathJax *, mjx-container, mjx-container *, pre, pre *, code, code *)) {
        font-size: var(--cgfc-pill-size) !important;
        line-height: 1.2 !important;
      }
      :is(html[data-cgfc-citation-size] [data-cgfc-citation], html[data-cgfc-web-citation-size] [data-cgfc-web-citation]),
      :is(html[data-cgfc-citation-size] [data-cgfc-citation], html[data-cgfc-web-citation-size] [data-cgfc-web-citation]) :is([data-d-component="box"], [data-d-component="row"], [data-d-component="badge"]) {
        height: auto !important;
        min-height: 0 !important;
        gap: 0.2em !important;
      }
      :is(html[data-cgfc-citation-size] [data-cgfc-citation], html[data-cgfc-web-citation-size] [data-cgfc-web-citation]) :is([data-d-component="badge"][data-pill], .citation-pill, .file-citation),
      html[data-cgfc-citation-size] [data-cgfc-citation]:not(:has([data-d-component="badge"][data-pill])),
      html[data-cgfc-web-citation-size] [data-cgfc-web-citation]:not(:has([data-d-component="badge"][data-pill])) {
        padding-block: 0.15em !important;
        padding-inline: 0.4em !important;
        border-radius: 999px !important;
        vertical-align: baseline !important;
      }
      :is(html[data-cgfc-citation-size] [data-cgfc-citation], html[data-cgfc-web-citation-size] [data-cgfc-web-citation]) :is([data-d-component="favicon"], img, svg) {
        width: calc(var(--cgfc-pill-size) * 0.85) !important;
        height: calc(var(--cgfc-pill-size) * 0.85) !important;
        min-width: 0 !important;
        min-height: 0 !important;
        flex-shrink: 0 !important;
        object-fit: contain !important;
      }
    }

    @media (max-width: 520px) {
      #${TOGGLE_ID} {
        right: auto;
        left: max(10px, env(safe-area-inset-left));
        bottom: max(94px, calc(env(safe-area-inset-bottom) + 82px));
      }

      #${PANEL_ID} {
        left: max(8px, env(safe-area-inset-left));
        right: max(8px, env(safe-area-inset-right));
        top: max(8px, env(safe-area-inset-top));
        width: auto;
        max-height: calc(100dvh - 76px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
      }

      #${PANEL_ID} .cgfc-row {
        grid-template-columns: 1fr;
        gap: 0;
      }
    }
  `;

  startThemeSync();
  installAutoScrollLock();
  applySettings();
  startCitationTypography();
  startResidualLatexObserver();
  startFormulaCopy();
  onReady(() => {
    ensureShell();
    // ChatGPT hydrates its typography after DOMContentLoaded. Re-apply a few
    // times so mixed custom/native font stacks can sample the final native
    // family rather than the early loading shell.
    setTimeout(applySettings, 800);
    setTimeout(applySettings, 2400);

    if (!observersStarted) {
      observersStarted = true;
      startShellGuard();
      startDisclaimerObserver();
    }
  });
})();

    // BEGIN ASCII OCEAN ADAPTER (independent failure boundary)
    // Adapted from stackedlol/ascii-sharks by stackedlol.
    // https://github.com/stackedlol/ascii-sharks/tree/c521e24a787e6d4cc460d4cf2b9815f25e4fe453
    // Upstream snapshot has no LICENSE; its license is not inferred from this script's GPL header.
    try {
(() => {
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
  const { World, AsciiRenderer } = oceanModelFactory();
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
  function createOceanReplayEngine(World, notify = () => {}) {
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
          await new Promise(resolve => setTimeout(resolve, 12));
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
      try { worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
    } catch (_) { return null; }
    const stop = () => { stopped = true; clearTimeout(timer); worker.terminate(); };
    const fail = error => { if (stopped) return; stop(); onFailure(error); };
    worker.onerror = event => { event.preventDefault(); fail('worker blocked or failed'); };
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
  function createMessageGlass(runtime) {
    const root = document.documentElement;
    const style = document.createElement("style");
    style.id = "cgpt-ascii-message-glass-style";
    style.textContent = `
    :root { --cgfc-message-glass-auto-tint:255,255,255; }
    html.dark:not([data-cgfc-theme="light"]),html[data-cgfc-theme="dark"] { --cgfc-message-glass-auto-tint:16,18,22; }
    [data-cgfc-liquid-surface="message"] {
      --cgfc-glass-tint:var(--cgfc-message-glass-auto-tint);
      --cgfc-glass-fill:var(--cgfc-message-glass-opacity,.18);
      --cgfc-glass-luminance:var(--cgfc-message-glass-brightness,1);
      --cgfc-glass-saturation:var(--cgfc-message-glass-saturation,1.12);
      border-radius:var(--cgfc-message-glass-radius,18px)!important;
      padding:12px 14px!important;box-sizing:border-box!important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,calc(var(--cgfc-message-glass-glare,.45)*.22)),0 6px 18px -10px rgba(0,0,0,.18)!important;
      transition:none!important;
    }
    html[data-cgfc-message-glass-custom-tint] [data-cgfc-liquid-surface="message"] { --cgfc-glass-tint:var(--cgfc-message-glass-custom-rgb); }
  `;
    (document.head || root).appendChild(style);
    const entries = new Map(), parked = new Map();
    const PARK_LIMIT = 8, PARK_BYTES = 2 * 1024 * 1024;
    let enabled = false, main = null, timer = 0, scanFrame = 0, observer = null, routeObserver = null, disposed = false, settingsKey = '', scans = 0, reused = 0, evicted = 0;
    const retainedBytes = () => [...parked.values()].reduce((sum, entry) => sum + (entry.controller?.mapUrl?.length || 0) * 2, 0);
    const destroyEntry = (el, entry) => {
      parked.delete(el); entry.controller?.destroy(); entry.controller = null;
    };
    const park = (el, entry) => {
      const controller = entry.controller;
      if (!controller) return;
      controller.offscreen = true; controller.pause();
      // Keep only completed surfaces. Pending work may populate the shared map
      // cache, but must never revive a hidden/destroyed controller.
      if (!controller.filter?.isConnected || !controller.signature || !controller.mapUrl) { destroyEntry(el, entry); return; }
      parked.delete(el); parked.set(el, entry);
      while (parked.size > PARK_LIMIT || retainedBytes() > PARK_BYTES) {
        const [oldElement, oldEntry] = parked.entries().next().value;
        destroyEntry(oldElement, oldEntry); evicted++;
      }
    };
    const attach = (el, entry) => {
      if (!enabled || !entry.visible || !el.isConnected || document.hidden) return;
      const Glass = runtime.composerLiquidGlass?.constructor;
      if (!Glass) return;
      if (parked.delete(el)) reused++;
      if (!entry.controller) entry.controller = new Glass(runtime, { kind: 'message', direct: true, managed: true, sharedStyle: true, visibilityManaged: true, enabledAttribute: 'data-cgfc-message-glass' });
      entry.controller.offscreen = false; entry.controller.attach(el);
    };
    const io = new IntersectionObserver(records => {
      for (const record of records) {
        const entry = entries.get(record.target);
        if (!entry) continue;
        entry.visible = record.isIntersecting;
        if (entry.visible) attach(record.target, entry); else park(record.target, entry);
      }
    }, { rootMargin: '80px' });
    const onMutations = records => {
      const selector = runtime.dom.message + ',' + runtime.dom.content + ', [data-message-content], .whitespace-pre-wrap';
      if (records.some(r => [...r.addedNodes, ...r.removedNodes].some(n => n instanceof Element && (n.matches(selector) || n.querySelector(selector))))) schedule();
    };
    function syncRouteWatch() {
      if ((!enabled || disposed) && routeObserver) { routeObserver.disconnect(); routeObserver = null; }
      if (enabled && !disposed && !routeObserver) routeObserver = runtime.pageWork.observe(root, { childList: true, subtree: true }, records => {
        if (!main?.isConnected) { schedule(); return; }
        if (records.some(record => !main.contains(record.target) && [...record.addedNodes, ...record.removedNodes].some(node =>
          node instanceof Element && (node.matches('main,[role="main"]') || node.querySelector('main,[role="main"]'))))) schedule();
      });
    }
    function onRoute() { schedule(); }
    function clear() {
      observer?.disconnect(); observer = null; io.disconnect();
      for (const [el, entry] of entries) destroyEntry(el, entry);
      entries.clear(); parked.clear(); main = null;
    }
    function scan(reattachAll = false) {
      scanFrame = 0; timer = 0;
      if (disposed || !enabled || document.hidden) return;
      scans++;
      const next = runtime.dom.main();
      if (main !== next) {
        clear(); main = next;
        if (main) observer = runtime.pageWork.observe(main, { childList: true, subtree: true }, onMutations);
      }
      if (!main) return;
      const wanted = new Set(), fresh = [];
      for (const message of runtime.pageWork.query(main, runtime.dom.assistant)) {
        if (runtime.dom.isThinkingOverview(message)) continue;
        const el = runtime.dom.contentRoot(message) || message;
        wanted.add(el);
        if (!entries.has(el)) {
          const entry = { controller: null, visible: false };
          entries.set(el, entry); io.observe(el); fresh.push([el, entry]);
        }
      }
      for (const [el, entry] of entries) if (!wanted.has(el) || !el.isConnected) {
        io.unobserve(el); destroyEntry(el, entry); entries.delete(el);
      }
      for (const [el, entry] of fresh) {
        const turn = el.closest(runtime.dom.turn) || el, r = runtime.pageWork.rect(turn);
        entry.visible = r.width > 0 && r.height > 0 && r.bottom > -80 && r.top < innerHeight + 80;
      }
      for (const [el, entry] of reattachAll === true ? entries : fresh) if (entry.visible) attach(el, entry);
    }
    function schedule() {
      if (enabled && !timer && !scanFrame && !disposed && !document.hidden) timer = window.setTimeout(() => {
        timer = 0; scanFrame = runtime.pageWork.requestFrame(scan);
      }, 160);
    }
    function refresh() {
      const active = root.hasAttribute('data-cgfc-message-glass');
      if (active !== enabled) {
        enabled = active; syncRouteWatch();
        if (!enabled) {
          clearTimeout(timer); timer = 0; runtime.pageWork.cancelFrame(scanFrame); scanFrame = 0; clear(); return;
        }
      }
      if (document.hidden) { for (const entry of entries.values()) entry.controller?.pause(); return; }
      if (enabled) {
        clearTimeout(timer); timer = 0; runtime.pageWork.cancelFrame(scanFrame); scanFrame = 0;
        scan(true);
      }
    }
    function onSettings() {
      const key = [root.hasAttribute('data-cgfc-message-glass'), root.getAttribute('data-cgfc-message-glass-style'), root.getAttribute('data-cgfc-message-glass-render-mode'), root.getAttribute('data-cgfc-message-glass-finish'), ...['opacity', 'blur', 'strength', 'thickness', 'curvature', 'bend', 'chroma', 'radius', 'glare'].map(name => root.style.getPropertyValue('--cgfc-message-glass-' + name))].join('|');
      if (key === settingsKey) return;
      settingsKey = key; refresh();
    }
    function onResize() { if (enabled) for (const [el, entry] of entries) attach(el, entry); }
    function destroy() {
      disposed = true; enabled = false; syncRouteWatch(); clearTimeout(timer); runtime.pageWork.cancelFrame(scanFrame); clear(); style.remove();
      window.removeEventListener('popstate', onRoute); window.navigation?.removeEventListener('navigatesuccess', onRoute);
      document.removeEventListener('cgpt-unified-ui-settings-change', onSettings);
      document.removeEventListener('visibilitychange', refresh); window.removeEventListener('resize', onResize);
    }
    window.addEventListener('popstate', onRoute); window.navigation?.addEventListener('navigatesuccess', onRoute);
    document.addEventListener('cgpt-unified-ui-settings-change', onSettings); onSettings();
    document.addEventListener('visibilitychange', refresh); window.addEventListener('resize', onResize, { passive: true });
    return { refresh, destroy, followMain: next => { if (enabled && next !== main) schedule(); }, getState: () => ({ enabled, observed: entries.size, active: [...entries.values()].filter(e => e.visible && e.controller).length, parked: parked.size, retainedBytes: retainedBytes(), parkLimit: PARK_LIMIT, parkByteLimit: PARK_BYTES, reused, evicted, scans }) };
  }

  // work/ocean-controller-v65.ts
  (() => {
    "use strict";
    const runtime = globalThis.__cgptUnifiedRuntimeV1;
    if (!runtime) return;
    runtime.asciiSharks?.destroy();
    const messageGlass = createMessageGlass(runtime);
    runtime.asciiMessageGlass = messageGlass;
    const root = document.documentElement;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const EDITOR = '#prompt-textarea, textarea[name="prompt-textarea"], .ProseMirror[contenteditable="true"], [data-composer-markdown][contenteditable="true"], [contenteditable="true"][role="textbox"]';
    const layerStyle = document.createElement("style");
    layerStyle.id = "cgpt-unified-ascii-layer-style";
    layerStyle.textContent = '[data-cgpt-ascii-foreground="position"]{position:relative!important;z-index:1!important}[data-cgpt-ascii-foreground="stack"]{z-index:1!important}';
    (document.head || root).appendChild(layerStyle);
    let canvas = null, world = null, renderer = null;
    let directCanvas = false, directDisabled = false, pendingSurface = null, bitmapFrames = 0, reducedSurface = false;
    let foreground = /* @__PURE__ */ new Set();
    let raf = 0, frameTimer = 0, layoutRaf = 0, layoutTimer = 0, timer = 0, last = 0, layoutAt = -Infinity, busyAt = -Infinity;
    let oceanWorker = null, workerFailed = false, workerError = '', epoch = 0, layoutVersion = 0, placementVersion = 0, sentLayout = -1, sentPlacement = -1;
    let workerState = null, pendingSplash = null, simulationSteps = 0, droppedFrames = 0;
    let rendererMode = 'canvas', motionMode = 'live', replayStatus = { state: 'live' }, statusText = '';
    function setOceanStatus(status = replayStatus) {
      replayStatus = status;
      const backend = workerState?.gpuCompute ? 'GPU 计算 + 绘制' : workerState?.gpu ? (rendererMode === 'compute' ? 'GPU 绘制（计算兼容）' : 'GPU 绘制') : oceanWorker ? '标准绘制' : '兼容绘制';
      const motionLabel = motionMode === 'live' ? '实时模拟' : status.state === 'preparing' ? '准备回放 ' + Math.floor((status.progress || 0) * 100) + '%'
        : status.state === 'ready' ? (motionMode === 'replay30' ? '30' : '15') + ' 分钟回放 · ' + (status.cached ? '已缓存' : '内存中')
        : status.state === 'error' ? '准备失败，使用实时模拟' : status.state === 'cancelled' ? '已取消准备，使用实时模拟' : '等待准备回放';
      const text = !enabled ? '海洋已关闭' : (!oceanWorker && motionMode !== 'live' ? '当前环境使用实时模拟（回放需要后台线程）' : backend + ' · ' + motionLabel);
      if (text === statusText) return; statusText = text; root.setAttribute('data-cgfc-ocean-status', text);
      for (const node of document.querySelectorAll('[data-cgpt-ocean-status]')) if (node.textContent !== text) node.textContent = text;
    }
    let width = 0, height = 0, dpr = 1, species = "", density = 90, quality = "balanced";
    let disposed = false, suspended = false, enabled = false, busy = false, pauseBusy = true;
    let opacity = 0.65, fps = 12, homeCoverage = "full", chatCoverage = "gutter", coverage = "gutter";
    let scene = "chat", scenePlaced = false, layoutDirty = true, pointerEnabled = false, pointerBound = false;
    let firstFrame = true;
    let colorMode = "auto", colorSeed = 0, bodyColor = "#7ed8f0", accentColor = "#c79aff", fishColor = "#b8e7f7", wakeColor = "#55d8ea";
    const sessionSeed = Math.floor(Math.random() * 2147483647);
    let paletteKey = "", masks = [], scrollbarMasks = [], reading = null;
    let settingsKey = "";
    let drawable = false, currentMain = null, scrollerNodes = [], scrollerKey = null;
    let mountedShell = null, mountedMain = null, mountedScene = "";
    let layoutReads = 0, drawnFrames = 0, frameCallbacks = 0, fieldTicks = 0, meanWorkMs = 0;
    const insideMask = (x, y) => masks.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    function stopFrames() {
      cancelAnimationFrame(layoutRaf); clearTimeout(layoutTimer); layoutRaf = layoutTimer = 0;
      epoch++;
      cancelAnimationFrame(raf);
      raf = 0;
      clearTimeout(frameTimer);
      frameTimer = 0;
    }
    function queueFrame() {
      if (raf || frameTimer || !allowed() || motion.matches) return;
      const target = quality === "eco" ? Math.min(fps, 18) : fps;
      const delay = last ? 1e3 / target - (performance.now() - last) - 2 : 0;
      if (delay > 16) frameTimer = window.setTimeout(() => {
        frameTimer = 0;
        raf = requestAnimationFrame(frame);
      }, delay);
      else raf = requestAnimationFrame(frame);
    }
    function clearForeground() {
      for (const el of foreground) el.removeAttribute("data-cgpt-ascii-foreground");
      foreground.clear();
    }
    function release() {
      stopFrames();
      oceanWorker?.stop(); oceanWorker = null; workerState = null; sentLayout = sentPlacement = -1; pendingSplash = null;
      canvas?.remove();
      directCanvas = false; pendingSurface = null;
      canvas = null;
      world = null;
      renderer = null;
      clearForeground();
      width = height = 0;
      last = 0;
      scenePlaced = false;
      paletteKey = "";
      scrollerKey = null;
      mountedShell = mountedMain = null;
      mountedScene = "";
    }
    function create() {
      firstFrame = true;
      reducedSurface = motion.matches;
      canvas = document.createElement('canvas');
      canvas.id = 'cgpt-unified-ascii-ocean';
      canvas.setAttribute('aria-hidden', 'true'); canvas.setAttribute('role', 'presentation');
      canvas.style.cssText = 'position:fixed!important;top:0!important;left:0!important;pointer-events:none!important;user-select:none!important;z-index:0!important;background:transparent!important;font-family:Consolas,"Courier New",monospace!important;contain:strict!important;';
      const kinds = species === 'mixed' ? ['hammerhead', 'tiger', 'mako', 'thresher'] : Array(4).fill(species || 'classic');
      world = new World(kinds.map((kind, i) => ({ kind, size: [1, .7, .84, .77][i] })), density);
      const activeCanvas = canvas;
      if (!workerFailed && !motion.matches) {
        oceanWorker = createOceanWorker(data => {
          if (canvas !== activeCanvas) return;
          workerState = data; setOceanStatus(data.replay);
          if (data.epoch !== epoch || data.layoutVersion !== layoutVersion || !allowed() || motion.matches) return;
          if (!data.direct) {
            const ctx = renderer.ctx; ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(data.bitmap, 0, 0); bitmapFrames++;
          }
          canvas.style.opacity = String(opacity * data.replayFade);
          if (canvas.dataset.state !== 'running') canvas.dataset.state = 'running';
          drawnFrames++; firstFrame = false;
        }, error => {
          if (canvas !== activeCanvas) return;
          const retryBitmap = directCanvas;
          if (retryBitmap) directDisabled = true; else workerFailed = true;
          workerError = String(error);
          // A transferred HTML canvas cannot get a new main-thread context.
          // Replace only our decoration surface before trying the fallback.
          release();
          queueMicrotask(() => { if (enabled && !disposed && !suspended) { layoutDirty = true; refresh(); setOceanStatus(); } });
        }, setOceanStatus);
      }
      if (oceanWorker && !directDisabled && typeof canvas.transferControlToOffscreen === 'function') {
        try { pendingSurface = canvas.transferControlToOffscreen(); directCanvas = true; }
        catch (error) { directDisabled = true; workerError = String(error); }
      }
      // Layout/placement metadata stays on the main thread; no rendering
      // context is ever created on the transferred display canvas here.
      renderer = new AsciiRenderer(directCanvas ? document.createElement('canvas') : canvas);
      renderer.setFontFamily('Consolas,"Courier New",monospace');
      renderer.setDetail(quality === 'eco'); renderer.setExternalFieldClock(true);
    }
    function readBusy(editor) {
      if (runtime.readQueueResponseState) return runtime.readQueueResponseState({ busyOnly: true }).busy === true;
      const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
      if ([...document.querySelectorAll('[data-testid="stop-button"], [data-testid="composer-stop-button"], [data-testid*="stop-generating"]')].some(visible)) return true;
      const shell = editor?.closest("form, [data-chatgpt-composer]");
      return [...shell?.querySelectorAll('button,[role="button"]') || []].some((el) => visible(el) && /^(?:stop(?: (?:generating|streaming|response))?|停止(?:生成|回答|流式传输|输出)?|中止生成)$/i.test((el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim()));
    }
    function mount(main, shell, first) {
      if (mountedMain === main && mountedShell === shell && mountedScene === scene && canvas?.isConnected && [...foreground].every((el) => el.isConnected)) return;
      let host = main;
      for (let el = shell?.parentElement; el && el !== main; el = el.parentElement) {
        if (getComputedStyle(el).isolation === "isolate" && (!first || el.contains(first))) {
          host = el;
          break;
        }
      }
      if (canvas.parentElement !== host) {
        clearForeground();
        host.appendChild(canvas);
        scrollerKey = null;
      }
      const next = /* @__PURE__ */ new Set();
      const targets = [shell, first, main.querySelector("h1")];
      for (const target of targets) {
        if (!target || !host.contains(target)) continue;
        let branch = target;
        while (branch.parentElement && branch.parentElement !== host) branch = branch.parentElement;
        if (branch.parentElement !== host || branch === canvas) continue;
        const s = getComputedStyle(branch), z = Number(s.zIndex);
        if (foreground.has(branch) || s.zIndex === "auto" || z <= 0) {
          const kind = foreground.has(branch) ? branch.getAttribute("data-cgpt-ascii-foreground") : s.position === "static" ? "position" : "stack";
          branch.setAttribute("data-cgpt-ascii-foreground", kind);
          next.add(branch);
        }
      }
      for (const el of foreground) if (!next.has(el)) el.removeAttribute("data-cgpt-ascii-foreground");
      foreground = next;
      mountedShell = shell;
      mountedMain = main;
      mountedScene = scene;
    }
    function colorRgb(hex) {
      return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    }
    function hsl(h, s, l) {
      const a = s * Math.min(l, 1 - l), f = (n) => {
        const k = (n + h / 30) % 12;
        return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
      };
      return [f(0), f(8), f(4)];
    }
    function applyPalette() {
      const light = root.getAttribute("data-cgfc-theme") === "light" || root.classList.contains("light");
      const key = [colorMode, colorSeed, bodyColor, accentColor, fishColor, wakeColor, light].join("|");
      if (key === paletteKey) return;
      paletteKey = key;
      let body = colorRgb(bodyColor), accent = accentColor, fish = colorRgb(fishColor), wake = colorRgb(wakeColor);
      if (colorMode === "original") {
        renderer.setPalette(null, "#e0892c", [230, 238, 255], [110, 230, 255]);
        canvas.style.filter = light ? "brightness(.55)" : "none";
        return;
      }
      canvas.style.filter = "none";
      if (colorMode === "auto") {
        body = colorRgb(light ? "#3f7286" : "#8dd8ea");
        accent = light ? "#7e4ba3" : "#c79aff";
        fish = colorRgb(light ? "#355e70" : "#b8e7f7");
        wake = colorRgb(light ? "#208ca6" : "#55d8ea");
      } else if (colorMode !== "custom") {
        const hue = colorMode === "cyan" ? 190 : colorMode === "aurora" ? 265 : colorMode === "warm" ? 30 : (colorSeed || sessionSeed) % 360;
        body = hsl(hue, 0.65, light ? 0.39 : 0.72);
        fish = hsl((hue + 15) % 360, 0.6, light ? 0.32 : 0.83);
        wake = hsl((hue + 40) % 360, 0.75, light ? 0.42 : 0.65);
        accent = "rgb(" + hsl((hue + 110) % 360, 0.85, light ? 0.45 : 0.7).join(",") + ")";
      }
      renderer.setPalette(body, accent, fish, wake);
    }
    function contentRect(el) {
      const content = runtime.dom.contentRoot(el) || el;
      const r = content.getBoundingClientRect();
      if (r.width < 1) return null;
      const s = getComputedStyle(content);
      let l = r.left + parseFloat(s.paddingLeft || "0") + parseFloat(s.borderLeftWidth || "0");
      let rr = r.right - parseFloat(s.paddingRight || "0") - parseFloat(s.borderRightWidth || "0");
      if (r.width > currentMain.clientWidth * 0.92) {
        const block = content.matches("p,h1,h2,h3,h4,pre,table,li") ? content : content.querySelector("p,h1,h2,h3,h4,pre,table,li");
        if (block) {
          const br = block.getBoundingClientRect();
          if (br.width > 0) {
            l = br.left;
            rr = br.right;
          }
        }
      }
      return new DOMRect(l, r.top, Math.max(0, rr - l), r.height);
    }
    function updateLayout() {
      if (!canvas || !world || !renderer) return;
      layoutReads++;
      const w = root.clientWidth, h = innerHeight, ratio = Math.min(devicePixelRatio || 1, quality === "eco" ? 1 : quality === "fine" ? 1.5 : 1.25);
      if (w !== width || h !== height || ratio !== dpr) {
        width = w;
        height = h;
        dpr = ratio;
        renderer.resize(w, h, dpr);
        world.resize(w, h, renderer.cellWidth, renderer.cellHeight);
        canvas.style.setProperty("width", `${w}px`, "important");
        canvas.style.setProperty("height", `${h}px`, "important");
      }
      const main = runtime.dom.main();
      currentMain = main;
      messageGlass.followMain(main);
      masks = [];
      scrollbarMasks = [];
      reading = null;
      if (!main) {
        drawable = false;
        layoutDirty = false;
        return;
      }
      const bounds = main.getBoundingClientRect();
      if (bounds.width < 1) {
        drawable = false;
        layoutDirty = false;
        return;
      }
      const mainLeft = Math.max(0, bounds.left), mainRight = Math.min(w, bounds.right);
      const editor = main.querySelector(EDITOR), shell = editor?.closest('[data-composer-surface="true"], [data-composer-surface-variant], form, [data-chatgpt-composer]') || editor;
      const first = main.querySelector(runtime.dom.message);
      scene = first ? "chat" : "home";
      coverage = scene === "home" ? homeCoverage : chatCoverage;
      mount(main, shell, first);
      masks.push({ x: 0, y: 0, w: mainLeft, h }, { x: mainRight, y: 0, w: w - mainRight, h });
      let left = mainRight, right = mainLeft;
      if (coverage === "gutter") {
        const samples = /* @__PURE__ */ new Set(), center = (mainLeft + mainRight) / 2;
        for (const y of [8, h * 0.18, h * 0.4, h * 0.64, h * 0.84]) for (const x of [center, mainLeft + (mainRight - mainLeft) * 0.34]) {
          const hit = document.elementFromPoint(x, y), message = hit?.closest(runtime.dom.message);
          if (message && main.contains(message)) samples.add(message);
        }
        if (!samples.size && first) samples.add(first);
        for (const message of samples) {
          const r = contentRect(message);
          if (r) {
            left = Math.min(left, r.left);
            right = Math.max(right, r.right);
          }
        }
        if (left > right) {
          const r = shell?.getBoundingClientRect();
          left = r?.left ?? mainLeft;
          right = r?.right ?? mainRight;
        }
        left = Math.max(mainLeft, left - 3);
        right = Math.min(mainRight, right + 3);
        reading = { x: left, y: 0, w: Math.max(0, right - left), h };
        masks.push(reading);
      }
      if (!scenePlaced && (coverage === "full" || left - mainLeft >= 50 && mainRight - right >= 50)) {
        scenePlaced = true; placementVersion++;
        if (coverage === "gutter") {
          const centers = [(mainLeft + left) / 2, (right + mainRight) / 2];
          for (const [i, f] of world.fish.entries()) {
            const side = i % 2, span = side ? mainRight - right : left - mainLeft;
            f.x = centers[side] + Math.sin(i * 2.4) * Math.min(70, span * 0.3);
            f.y = 32 + i % 17 / 17 * Math.max(1, h - 64);
          }
          for (const [i, shark] of world.sharks.entries()) {
            const heading = i < 2 ? Math.PI / 2 : -Math.PI / 2;
            shark.heading = heading;
            for (let n = 0; n < shark.nodes.length / 2; n++) {
              shark.nodes[n * 2] = centers[i % 2];
              shark.nodes[n * 2 + 1] = h * (i < 2 ? 0.68 : 0.32) - Math.sin(heading) * shark.length * n / (shark.nodes.length / 2 - 1);
            }
          }
        }
      }
      const anchor = editor || first || main;
      if (scrollerKey !== anchor) {
        scrollerKey = anchor;
        const set = /* @__PURE__ */ new Set([main, root]);
        for (const sample of [editor, first]) for (let el = sample; el && el !== document.body; el = el.parentElement) if (el instanceof HTMLElement) set.add(el);
        scrollerNodes = [...set];
      }
      for (const el of scrollerNodes) {
        if (!el.isConnected) continue;
        const ch = el.clientHeight, cw = el.clientWidth;
        if (ch < 1 || cw < 1) continue;
        const vertical = el.scrollHeight > ch + 1, horizontal = el.scrollWidth > cw + 1;
        if (!vertical && !horizontal) continue;
        const isRoot = el === root, s = getComputedStyle(el), r = el.getBoundingClientRect();
        if (vertical && (isRoot || /auto|scroll|overlay/.test(s.overflowY))) {
          const track = Math.max(12, el.offsetWidth - cw);
          scrollbarMasks.push({ x: isRoot ? w - 12 : s.direction === "rtl" ? r.left : r.right - track, y: isRoot ? 0 : r.top, w: track, h: isRoot ? h : r.height });
        }
        if (horizontal && (isRoot || /auto|scroll|overlay/.test(s.overflowX))) {
          const track = Math.max(12, el.offsetHeight - ch);
          scrollbarMasks.push({ x: isRoot ? 0 : r.left, y: isRoot ? h - track : r.bottom - track, w: isRoot ? w : r.width, h: track });
        }
      }
      masks.push(...scrollbarMasks);
      renderer.setOcclusion(masks);
      drawable = coverage !== "off" && h > 200 && (coverage === "full" || Math.max(left - mainLeft, mainRight - right) >= 40);
      const effectiveOpacity = opacity * (workerState?.replayFade ?? 1);
      if (canvas.style.opacity !== String(effectiveOpacity)) canvas.style.opacity = String(effectiveOpacity);
      applyPalette();
      layoutVersion++;
      layoutAt = performance.now();
      layoutDirty = false;
      if (performance.now() - busyAt > 600) {
        busy = pauseBusy && readBusy(editor);
        busyAt = performance.now();
      }
    }
    function draw(dt) {
      if (oceanWorker && !motion.matches) {
        if (oceanWorker.busy) { droppedFrames++; return; }
        let config;
        if (sentLayout !== layoutVersion) {
          config = { width, height, dpr, masks, layoutVersion, placementVersion, density, quality, rendererMode, replaySeconds: motionMode === 'replay30' ? 1800 : motionMode === 'replay15' ? 900 : 0, placementKey: [coverage, reading?.x || 0, reading?.w || 0],
            kinds: species === 'mixed' ? ['hammerhead', 'tiger', 'mako', 'thresher'] : Array(4).fill(species || 'classic'),
            palette: { bodyTint: renderer.bodyTint, paletteAccents: renderer.paletteAccents, fishStyles: renderer.fishStyles, dotStyles: renderer.dotStyles } };
          if (sentPlacement !== placementVersion) { config.fish = world.fish; config.sharks = world.sharks; }
        }
        if (oceanWorker.send({ config, dt, pointer: world.pointer, splash: pendingSplash, epoch, surface: pendingSurface })) {
          pendingSurface = null;
          sentLayout = layoutVersion; sentPlacement = placementVersion; pendingSplash = null;
        }
        return;
      }
      if (dt > 0) { world.step(dt); simulationSteps++; renderer.advanceFields(world, dt); fieldTicks++; }
      renderer.render(world, dt);
      const g = canvas.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const r of masks) g.clearRect(r.x, r.y, r.w, r.h);
      const state = motion.matches ? "reduced-motion" : "running";
      if (canvas.dataset.state !== state) canvas.dataset.state = state;
      drawnFrames++;
      firstFrame = false;
    }
    function allowed() {
      return enabled && !disposed && !suspended && !document.hidden && drawable && !(pauseBusy && busy);
    }
    function frame(now) {
      raf = 0;
      frameCallbacks++;
      try {
        if (!allowed() || motion.matches) return;
        if (!last) last = now;
        const target = quality === "eco" ? Math.min(fps, 18) : fps;
        if (now - last >= 1e3 / target) {
          const start = performance.now();
          if (layoutDirty && now - layoutAt >= 140 || now - layoutAt > 1200) updateLayout();
          if (!allowed()) {
            refresh();
            return;
          }
          // Exactly one simulation step per displayed frame. Drop stalled time;
          // never replay a backlog after typing, a hidden tab, or a slow worker.
          const dt = Math.min((now - last) / 1e3, 1.25 / target);
          last = now;
          draw(dt);
          const work = performance.now() - start;
          meanWorkMs = meanWorkMs ? meanWorkMs * 0.9 + work * 0.1 : work;
        }
        queueFrame();
      } catch (error) {
        fail(error);
      }
    }
    function refresh() {
      if (disposed) return;
      try {
        if (!enabled || suspended) {
          release();
          return;
        }
        if (!document.body) return;
        if (document.hidden) {
          stopFrames();
          if (canvas) {
            canvas.hidden = true;
            canvas.dataset.state = "hidden";
          }
          last = 0;
          return;
        }
        busy = pauseBusy && readBusy(document.querySelector(EDITOR));
        busyAt = performance.now();
        if (busy) {
          stopFrames(); last = 0;
          if (canvas) { canvas.hidden = true; canvas.dataset.state = 'generating'; }
          return;
        }
        if (canvas && reducedSurface !== motion.matches) release();
        if (!canvas) create();
        updateLayout();
        canvas.hidden = !allowed();
        if (!allowed()) {
          stopFrames();
          last = 0;
          canvas.dataset.state = busy ? "generating" : coverage === "off" ? "scene-off" : "no-gutter";
          return;
        }
        const activeState = motion.matches ? "reduced-motion" : "running";
        if (canvas.dataset.state !== activeState) canvas.dataset.state = activeState;
        if (motion.matches) {
          stopFrames();
          last = 0;
          draw(0);
        } else {
          if (firstFrame) draw(0);
          queueFrame();
        }
      } catch (error) {
        fail(error);
      }
    }
    function readNumber(name, fallback, min, max) {
      const value = Number(root.getAttribute(name));
      return Number.isFinite(value) && root.hasAttribute(name) ? Math.max(min, Math.min(max, value)) : fallback;
    }
    function readColor(name, fallback) {
      const value = root.getAttribute(name) || "";
      return /^#[\da-f]{6}$/i.test(value) ? value : fallback;
    }
    function settingsChanged() {
      const key = JSON.stringify(["ocean", "opacity", "fps", "species", "density", "quality", "pause-busy", "coverage", "home-coverage", "pointer", "color-mode", "color-seed", "body-color", "accent-color", "fish-color", "wake-color", "renderer", "motion-mode"].map((name) => root.getAttribute("data-cgfc-ascii-" + name))) + "|" + root.getAttribute("data-cgfc-theme");
      if (key === settingsKey) {
        if (enabled && !canvas) refresh();
        return;
      }
      settingsKey = key;
      const nextSpecies = root.getAttribute("data-cgfc-ascii-species") || "classic";
      const nextDensity = readNumber("data-cgfc-ascii-density", 90, 40, 160), nextQuality = root.getAttribute("data-cgfc-ascii-quality") || "balanced";
      const requestedRenderer = root.getAttribute('data-cgfc-ascii-renderer');
      const nextRenderer = ['gpu', 'compute'].includes(requestedRenderer) ? requestedRenderer : 'canvas';
      const mode = root.getAttribute('data-cgfc-ascii-motion-mode'), nextMotion = ['replay15', 'replay30'].includes(mode) ? mode : 'live';
      if (species !== nextSpecies || density !== nextDensity || quality !== nextQuality || rendererMode !== nextRenderer || motionMode !== nextMotion) {
        release();
        species = nextSpecies;
        density = nextDensity;
        quality = nextQuality; rendererMode = nextRenderer; motionMode = nextMotion; replayStatus = { state: 'live' };
      }
      enabled = root.hasAttribute("data-cgfc-ascii-ocean");
      opacity = readNumber("data-cgfc-ascii-opacity", 0.65, 0.15, 0.9);
      const nextFps = readNumber("data-cgfc-ascii-fps", 12, 3, 30);
      if (nextFps !== fps) stopFrames();
      fps = nextFps;
      pauseBusy = root.hasAttribute("data-cgfc-ascii-pause-busy");
      busyAt = -Infinity;
      const range = root.getAttribute("data-cgfc-ascii-coverage");
      chatCoverage = range === "full" || range === "glass" ? range : "gutter";
      homeCoverage = root.getAttribute("data-cgfc-ascii-home-coverage") === "off" ? "off" : "full";
      pointerEnabled = root.hasAttribute("data-cgfc-ascii-pointer");
      syncPointerListeners();
      colorMode = root.getAttribute("data-cgfc-ascii-color-mode") || "auto";
      colorSeed = readNumber("data-cgfc-ascii-color-seed", 0, 0, 2147483647);
      bodyColor = readColor("data-cgfc-ascii-body-color", "#7ed8f0");
      accentColor = readColor("data-cgfc-ascii-accent-color", "#c79aff");
      fishColor = readColor("data-cgfc-ascii-fish-color", "#b8e7f7");
      wakeColor = readColor("data-cgfc-ascii-wake-color", "#55d8ea");
      clearInterval(timer);
      timer = 0;
      if (enabled) timer = window.setInterval(() => {
        if (!document.hidden && !suspended) refresh();
      }, 1e3);
      refresh(); setOceanStatus();
    }
    function pointerMove(e) {
      if (!world || !canvas || canvas.hidden || motion.matches) return;
      const blocked = e.target?.closest?.('button,a,input,textarea,[contenteditable],[role="button"]');
      world.pointer = { x: e.clientX, y: e.clientY, active: e.pointerType !== "touch" && !blocked && !insideMask(e.clientX, e.clientY) };
    }
    function pointerDown(e) {
      pointerMove(e);
      if (e.button === 0 && world?.pointer.active) {
        if (oceanWorker) pendingSplash = { x: e.clientX, y: e.clientY };
        else world.splash(e.clientX, e.clientY);
      }
    }
    function leave() {
      if (world) world.pointer.active = false;
    }
    function syncPointerListeners() {
      const bind = enabled && pointerEnabled && motionMode === 'live' && !disposed;
      if (bind === pointerBound) return;
      pointerBound = bind;
      if (bind) {
        window.addEventListener("pointermove", pointerMove, { passive: true });
        window.addEventListener("pointerdown", pointerDown, { passive: true });
        window.addEventListener("blur", leave);
        root.addEventListener("pointerleave", leave);
      } else {
        window.removeEventListener("pointermove", pointerMove);
        window.removeEventListener("pointerdown", pointerDown);
        window.removeEventListener("blur", leave);
        root.removeEventListener("pointerleave", leave);
        leave();
      }
    }
    // Running frames already consume dirty layout at the existing 140ms cadence.
    // A paused/reduced-motion surface gets at most one deferred layout refresh.
    function layoutChanged() {
      layoutDirty = true;
      if (!enabled || disposed || suspended || document.hidden || (pauseBusy && busy)) return;
      if (raf || frameTimer || layoutRaf || layoutTimer) return;
      const schedule = () => {
        layoutTimer = 0;
        if (!enabled || disposed || suspended || document.hidden || (pauseBusy && busy)) return;
        layoutRaf = requestAnimationFrame(() => {
          layoutRaf = 0;
          if (enabled && !disposed && !suspended && !document.hidden && !(pauseBusy && busy)) refresh();
        });
      };
      const delay = Math.max(0, 140 - (performance.now() - layoutAt));
      if (delay > 0) layoutTimer = window.setTimeout(schedule, delay);
      else schedule();
    }
    const onOceanScroll = runtime.pageWork.onScrollChange(layoutChanged);
    function pageHide() {
      suspended = true;
      release();
    }
    function pageShow() {
      suspended = false;
      refresh();
    }
    function fail(error) {
      console.warn("[ChatGPT ASCII Ocean] \u88C5\u9970\u5C42\u5DF2\u505C\u6B62\uFF0C\u5DE5\u5177\u7BB1\u7EE7\u7EED\u8FD0\u884C\u3002", error);
      destroy({ preserveMessageGlass: true });
    }
    const themeObserver = new MutationObserver(() => {
      layoutDirty = true;
      if (enabled && motion.matches) refresh();
    });
    themeObserver.observe(root, { attributes: true, attributeFilter: ["class", "data-cgfc-theme", "data-theme"] });
    function destroy({ preserveMessageGlass = false } = {}) {
      disposed = true;
      release();
      if (!preserveMessageGlass) messageGlass.destroy();
      clearInterval(timer);
      timer = 0;
      syncPointerListeners();
      themeObserver.disconnect();
      layerStyle.remove();
      document.removeEventListener("cgpt-unified-ui-settings-change", settingsChanged);
      document.removeEventListener("visibilitychange", refresh);
      document.removeEventListener("DOMContentLoaded", settingsChanged);
      motion.removeEventListener("change", refresh);
      window.removeEventListener("resize", layoutChanged);
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("pageshow", pageShow);
      document.removeEventListener("scroll", onOceanScroll, true);
    }
    runtime.asciiSharks = { destroy, refresh, clearReplayCache: () => oceanWorker ? oceanWorker.clearReplay() : createOceanReplayEngine(World).clear().catch(() => {}), getState: () => ({ enabled, disposed, scene, coverage, homeCoverage, chatCoverage, state: canvas?.dataset.state || "off", fps, quality, density, colorMode, colorSeed, pointerEnabled, pointerBound, pointerActive: world?.pointer.active || false, fish: world?.fish.length || 0, sharks: world?.sharks.map((s) => s.kind) || [], masks, reading, scrollbarMasks, time: workerState?.time ?? world?.time ?? 0, backend: oceanWorker ? (workerState?.gpuCompute ? 'worker-webgl2-compute' : workerState?.gpu ? 'worker-webgl2' : 'worker-offscreen') : 'main', motionMode, presentation: directCanvas ? 'direct' : oceanWorker ? 'bitmap' : 'main', bitmapFrames, gpuCompute: !!workerState?.gpuCompute, computeError: workerState?.computeError || '', replay: replayStatus, workerSimulationMs: workerState?.simulationMs || 0, workerRenderMs: workerState?.renderMs || 0, workerError, simulationSteps: workerState?.simulationSteps ?? simulationSteps, droppedFrames, workerWorkMs: workerState?.workMs || 0, foreground: [...foreground].map((e) => e.tagName), layoutReads, drawnFrames, frameCallbacks, fieldTicks: workerState?.fieldTicks ?? fieldTicks, meanWorkMs, occludedCells: renderer?.getOccludedCells() || 0 }) };
    document.addEventListener("cgpt-unified-ui-settings-change", settingsChanged);
    document.addEventListener("visibilitychange", refresh);
    motion.addEventListener("change", refresh);
    window.addEventListener("resize", layoutChanged, { passive: true });
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("pageshow", pageShow);
    document.addEventListener("scroll", onOceanScroll, { capture: true, passive: true });
    if (document.body) settingsChanged();
    else document.addEventListener("DOMContentLoaded", settingsChanged, { once: true });
  })();
})();

    } catch (error) { console.warn('[ChatGPT ASCII Ocean] 装饰层未启动，工具箱继续运行。', error); }
    // END ASCII OCEAN ADAPTER
    bootstrapState = 'bundles-evaluated';
    stampBootstrap();
  } catch (error) {
    bootstrapState = 'synchronous-error';
    stampBootstrap();
    throw error;
  }
})(); // unifiedSurfaceScope
