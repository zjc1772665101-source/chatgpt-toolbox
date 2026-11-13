const fs = await import('node:fs/promises');
const assert = (await import('node:assert/strict')).default;
const task = await taskSpace('chatgpt-svg-glass-regression-20261109');
const page = task.page('p1');
const html = `<!doctype html><html class="dark"><head><meta charset="utf-8"><style>
html,body { margin:0; background:#101010; color:#fff; font:22px/1.5 Arial; }
main { position:relative; width:900px; margin:25px auto; }
[data-turn-key] { margin:0 0 15px; }
#outer { position:relative; min-height:280px; background:transparent; }
#outer p { position:relative; margin:0 0 16px; }
#inner { position:absolute; inset:0; pointer-events:none; }
#inner svg { position:absolute; left:150px; top:85px; width:210px; height:130px; }
#demo { position:absolute; top:155px; left:440px; pointer-events:auto; }
#normal { margin-top:25px; }
</style></head><body><main><section data-turn-key="one"><div id="outer" data-markdown-text-style="assistant-message">
<p id="before">VISIBLE BEFORE GRAPHIC 文字应保持清晰</p>
<div id="interactive" data-d-component="box"><div id="inner" data-markdown-text-style="assistant-message" data-d-component="box"><svg viewBox="0 0 210 130"><circle cx="100" cy="65" r="55" fill="none" stroke="#aa88ff" stroke-width="4"/></svg><button id="demo" onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)">interactive</button></div></div>
<p id="after">VISIBLE AFTER GRAPHIC 文字也应保持清晰</p></div></section>
<section data-turn-key="two"><div id="normal" data-markdown-text-style="assistant-message"><p>REGULAR ANSWER 不含互动内容</p></div></section>
<section data-turn-key="three"><div id="user" data-user-message-bubble>USER MESSAGE</div><div id="thinking" data-markdown-text-style="assistant-message" data-markdown-text-tone="tertiary">Thinking</div><div id="legacy" data-message-author-role="assistant"><div class="markdown" id="legacy-content"><p>LEGACY ANSWER</p></div></div></section>
<form data-chatgpt-composer><textarea id="prompt-textarea"></textarea></form></main></body></html>`;
await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(html));
const source = await fs.readFile(new URL('../chatgpt-toolbox.user.js', import.meta.url), 'utf8');
const boot = await page.evaluate((source) => {
  window.GM_addStyle = css => { const e = document.createElement('style'); e.textContent = css; document.head.appendChild(e); };
  window.GM_getValue = (key, fallback) => key === 'chatgpt_font_customizer_settings_v2' ? {
    enableAsciiOcean: false, enableMessageLiquidGlass: true,
    responseGlassRenderMode: 'frosted', responseGlassOpacity: .75, responseGlassBlur: 8,
    enableComposerLiquidGlass: false, enableToolboxLiquidGlass: false,
    enableSettingsLiquidGlass: false, enableQueueLiquidGlass: false,
    enableSendLiquidGlass: false, enableScrollLiquidGlass: false,
    enableTokenLiquidGlass: false, enableToggleLiquidGlass: false,
    stopAutoScrollWhileGenerating: false, showTokenStats: false,
    fontSizeEnabled: false, lineHeightEnabled: false, normalColorEnabled: false,
    latinFontEnabled: false, chineseFontEnabled: false
  } : fallback;
  window.GM_setValue = () => {};
  try { (0,eval)(source); return {ok:true}; } catch(e) { return {ok:false,error:String(e),stack:e.stack}; }
}, source);
assert.equal(boot.ok,true,JSON.stringify(boot));
const wait = ms => page.evaluate(ms => new Promise(resolve=>setTimeout(resolve,ms)),ms);
const state = () => page.evaluate(() => ({
  boot:document.documentElement.getAttribute('data-cgpt-unified-bootstrap'),
  glass:globalThis.__cgptUnifiedRuntimeV1.asciiMessageGlass.getState(),
  ids:[...document.querySelectorAll('[data-cgfc-liquid-surface="message"]')].map(e=>e.id),
  filters:Object.fromEntries(['outer','inner','normal','user','thinking','legacy-content','dynamic'].map(id=>{const e=document.getElementById(id);return [id,e ? getComputedStyle(e).backdropFilter : 'missing'];})),
  clicks:document.getElementById('demo')?.dataset.clicks||'0',
  svg:!!document.querySelector('#inner svg circle'),
}));
const report=[];
await wait(3100);
let a=await state();
assert.equal(a.boot,'bundles-evaluated');
assert.deepEqual(a.ids.sort(),['legacy-content','normal','outer']);
assert.equal(a.filters.inner,'none');
assert.notEqual(a.filters.outer,'none');
assert.notEqual(a.filters.normal,'none');
assert.notEqual(a.filters['legacy-content'],'none');
assert.equal(a.filters.user,'none'); assert.equal(a.filters.thinking,'none'); assert(a.svg);
report.push({case:'新版嵌套 SVG、普通回答、旧版回答及用户/思考节点',state:a});
await page.click('#demo',{label:'验证互动按钮可点击'});
a=await state(); assert.equal(a.clicks,'1'); report.push({case:'原生指针交互',clicks:a.clicks});
await page.evaluate(()=>{
 const e=document.createElement('div');e.id='dynamic';e.setAttribute('data-markdown-text-style','assistant-message');e.setAttribute('data-d-component','box');e.innerHTML='<svg width="20" height="20"><circle cx="10" cy="10" r="8"/></svg>';document.querySelector('#interactive').append(e);
});
await wait(650); a=await state(); assert.equal(a.filters.dynamic,'none'); assert.deepEqual(a.ids.sort(),['legacy-content','normal','outer']);
report.push({case:'动态添加嵌套 SVG 不新增玻璃层',state:a});
await page.evaluate(()=>{const e=document.getElementById('dynamic');const s=document.createElement('section');s.setAttribute('data-turn-key','dynamic-turn');s.append(e);document.querySelector('main').insertBefore(s,document.querySelector('form'));});
await wait(650); a=await state(); assert(a.ids.includes('dynamic')); assert.notEqual(a.filters.dynamic,'none');
report.push({case:'嵌套内容提升为独立回答时单独挂载',state:a});
await page.evaluate(()=>document.getElementById('interactive').append(document.getElementById('dynamic')));
await wait(650); a=await state(); assert(!a.ids.includes('dynamic')); assert.equal(a.filters.dynamic,'none');
report.push({case:'独立回答重新嵌套时清除旧玻璃层',state:a});
await page.evaluate(()=>{document.documentElement.removeAttribute('data-cgfc-message-glass');document.dispatchEvent(new CustomEvent('cgpt-unified-ui-settings-change'));});
await wait(250); a=await state(); assert.deepEqual(a.ids,[]); assert.equal(a.glass.enabled,false);
report.push({case:'关闭正文玻璃时释放表面',state:a});
await page.evaluate(()=>{document.documentElement.setAttribute('data-cgfc-message-glass','');document.dispatchEvent(new CustomEvent('cgpt-unified-ui-settings-change'));});
await wait(650); a=await state(); assert(a.ids.includes('outer')); assert(!a.ids.includes('dynamic'));assert.equal(a.filters.inner,'none');
report.push({case:'重新启用后仅顶层回答挂载',state:a});
await page.evaluate(()=>{document.documentElement.setAttribute('data-cgfc-message-glass-render-mode','full');document.dispatchEvent(new CustomEvent('cgpt-unified-ui-settings-change'));});
await wait(2500); a=await state();assert.equal(a.filters.inner,'none'); assert(a.ids.includes('outer'));
report.push({case:'完整折射模式保留嵌套层隔离',state:a});
await page.evaluate(() => {
  const set = (key, value) => {
    const input = document.querySelector(`#cgfc-panel [data-key="${key}"]`);
    if (!input) throw new Error(`Missing setting: ${key}`);
    if (input.type === 'checkbox') input.checked = value; else input.value = value;
    input.dispatchEvent(new Event('change', {bubbles:true}));
  };
  set('responseGlassRenderMode', 'full');
  set('asciiOceanCoverage', 'glass');
  set('asciiOceanRenderer', 'compute');
  set('asciiOceanMotionMode', 'live');
  set('enableAsciiOcean', true);
});
await wait(4000); a=await state();
const ocean = await page.evaluate(() => globalThis.__cgptUnifiedRuntimeV1.asciiSharks.getState());
assert.equal(a.filters.inner,'none'); assert(a.ids.includes('outer'));
assert.match(a.filters.outer,/url\(/);
assert.equal(ocean.enabled,true); assert.equal(ocean.state,'running');
report.push({case:'海洋后台绘制与回答玻璃同时启用',backend:ocean.backend,presentation:ocean.presentation,drawnFrames:ocean.drawnFrames,state:a});
console.log(JSON.stringify({ok:true,checks:report},null,2));
await task.finish({keep:[]});
