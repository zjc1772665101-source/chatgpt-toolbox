// Every exposed preference has a concrete consumer in the page, panel, renderer,
// or interaction controller. Surface optical settings share the same schema.
Object.assign(SCHEMA, {
  themeMode:{type:'select',default:'native',choices:['native','dark','light'],label:'工具箱明暗主题'},
  toolboxLineHeight:{type:'number',default:1.5,min:1,max:2.4,step:.05,label:'工具箱行高'},
  toolboxUseCustomColors:{type:'boolean',default:false,label:'工具箱自定义配色'},
  toolboxTextColor:{type:'color',default:'#edf2fa',label:'工具箱文字颜色'},
  toolboxBackgroundColor:{type:'color',default:'#17212f',label:'工具箱背景颜色'},
  toolboxAccentColor:{type:'color',default:'#91b9f8',label:'工具箱强调色'},
  toolboxBackgroundOpacity:{type:'number',default:.94,min:.2,max:1,step:.01,label:'工具箱底色浓度'},
  queueFont:{type:'text',default:'"Segoe UI", "Microsoft YaHei", sans-serif',label:'队列字体'},
  queueFontSize:{type:'number',default:13,min:10,max:24,step:1,label:'队列字号 px'},
  queueLineHeight:{type:'number',default:1.5,min:1,max:2.4,step:.05,label:'队列行高'},
  queuePanelWidth:{type:'number',default:440,min:280,max:900,step:10,label:'队列窗口宽度 px'},
  queueUseCustomColors:{type:'boolean',default:false,label:'队列自定义配色'},
  queueTextColor:{type:'color',default:'#edf2fa',label:'队列文字颜色'},
  queueBackgroundColor:{type:'color',default:'#17212f',label:'队列背景颜色'},
  queueAccentColor:{type:'color',default:'#91b9f8',label:'队列强调色'},
  queueBackgroundOpacity:{type:'number',default:.96,min:.2,max:1,step:.01,label:'队列底色浓度'},
  thinkingFontSize:{type:'number',default:18,min:10,max:40,step:1,label:'思考概览字号 px',override:true},
  citationFontSize:{type:'number',default:14,min:10,max:30,step:1,label:'来源与文件引用字号 px',override:true},
  headingScale:{type:'number',default:1.2,min:1,max:1.8,step:.05,label:'标题字号比例',override:true,overrideDefault:false},
  paragraphSpacing:{type:'number',default:1,min:0,max:3,step:.1,label:'段落间距 em',override:true,overrideDefault:false},
  letterSpacing:{type:'number',default:0,min:-1,max:3,step:.05,label:'正文字距 px',override:true,overrideDefault:false},
  bodyColumnLeftOffset:{type:'number',default:0,min:-400,max:400,step:10,label:'正文左侧边界偏移 px',override:true,overrideDefault:false},
  bodyColumnRightOffset:{type:'number',default:0,min:-400,max:400,step:10,label:'正文右侧边界偏移 px',override:true,overrideDefault:false},
  fontSmoothingMode:{type:'select',default:'antialiased',choices:['auto','antialiased','subpixel-antialiased'],label:'字体平滑方式'},
  textRenderingMode:{type:'select',default:'optimizeLegibility',choices:['auto','optimizeLegibility','optimizeSpeed','geometricPrecision'],label:'文字渲染策略'},
  codeMaxHeight:{type:'number',default:640,min:160,max:1600,step:40,label:'代码块最大高度 px',override:true,overrideDefault:false},
  codeCopy:{type:'boolean',default:true,label:'代码块复制按钮'},
  codeLineNumbers:{type:'boolean',default:false,label:'显示代码行数贴片'},
  mathFontMode:{type:'select',default:'native',choices:['native','off'],label:'公式字体策略'},
  katexLetterFont:{type:'boolean',default:false,label:'所选公式字体用于 KaTeX 普通字母'},
  repairLatex:{type:'boolean',default:true,label:'修复回答中未解析的 LaTeX'},
  formulaCopyBorderColor:{type:'color',default:'#91b9f8',label:'公式复制反馈颜色'},
  messageCopyIconColor:{type:'color',default:'#91b9f8',label:'回答工具图标颜色'},
  messageToolsOnHover:{type:'boolean',default:true,label:'悬停回答时显示工具栏'},
  showBookmarks:{type:'boolean',default:true,label:'显示消息书签按钮'},
  navFollow:{type:'boolean',default:true,label:'目录跟随当前阅读位置'},
  navPreview:{type:'boolean',default:true,label:'目录显示回答摘要'},
  navLabelLength:{type:'number',default:90,min:20,max:300,step:10,label:'目录提问预览字数'},
  navHoverExpand:{type:'boolean',default:false,label:'悬停入口临时展开目录'},
  navAutoCollapse:{type:'boolean',default:false,label:'跳转后收起目录'},
  navDerivedHeadings:{type:'boolean',default:true,label:'无标题回答自动提取段落目录'},
  showTokenMessageChips:{type:'boolean',default:true,label:'显示逐条消息 Token 估算'},
  showTokenSummary:{type:'boolean',default:true,label:'显示 Token 汇总贴片'},
  tokenSummaryPosition:{type:'select',default:'bottom-right',choices:['bottom-right','bottom-left','top-right','top-left'],label:'Token 汇总位置'},
  tokenSummaryOffsetX:{type:'number',default:20,min:0,max:600,step:5,label:'Token 汇总水平边距 px'},
  tokenSummaryOffsetY:{type:'number',default:20,min:0,max:600,step:5,label:'Token 汇总垂直边距 px'},
  tokenSummaryCompact:{type:'boolean',default:false,label:'始终使用紧凑 Token 汇总'},
  tokenSummaryAvoidQueue:{type:'boolean',default:true,label:'Token 汇总避让队列'},
  tokenTextColor:{type:'color',default:'#d6e4ff',label:'Token 文字颜色'},
  tokenBackgroundColor:{type:'color',default:'#152036',label:'Token 背景颜色'},
  tokenCustomColors:{type:'boolean',default:false,label:'Token 汇总自定义配色'},
  showComposerDock:{type:'boolean',default:true,label:'输入框附近显示队列快捷入口'},
  queueDelay:{type:'number',default:1,min:0,max:15,step:.5,label:'两条队列消息之间间隔 秒'},
  queueQuietSeconds:{type:'number',default:2,min:1,max:10,step:.5,label:'回答停止变化后确认等待 秒'},
  queueTimeout:{type:'number',default:25,min:10,max:120,step:5,label:'未检测到回答的超时 秒'},
  queuePauseHidden:{type:'boolean',default:true,label:'隐藏页面时暂停发送队列'},
  lazyMessages:{type:'boolean',default:false,label:'长对话按可见范围渲染'},
  oceanColorMode:{type:'select',default:'auto',choices:['auto','original','cyan','aurora','warm','random','custom'],label:'海洋配色方案'},
  oceanColorSeed:{type:'number',default:1,min:1,max:2147483646,step:1,label:'随机配色种子'},
  oceanBodyColor:{type:'color',default:'#7ed8f0',label:'鲨鱼颜色'},
  oceanAccentColor:{type:'color',default:'#c79aff',label:'海洋点缀颜色'},
  oceanFishColor:{type:'color',default:'#b8e7f7',label:'鱼群颜色'},
  oceanWakeColor:{type:'color',default:'#55d8ea',label:'尾迹颜色'},
  settingsWidth:{type:'number',default:780,min:360,max:1200,step:20,label:'设置窗口宽度 px'},
  showToolbarLabels:{type:'boolean',default:true,label:'入口显示文字标签'},
  keyboardShortcuts:{type:'boolean',default:true,label:'启用工具箱快捷键'},
});

for (const surface of GLASS_SURFACES) {
  const prefix = surface.id;
  Object.assign(SCHEMA, {
    [prefix+'Style']:{type:'select',default:'clear',choices:['clear','soft'],label:'清透或柔和表面'},
    [prefix+'Finish']:{type:'select',default:'classic',choices:['classic','refined'],label:'边缘光学风格'},
    [prefix+'Radius']:{type:'number',default:surface.id==='message'?18:16,min:0,max:48,step:1,label:'圆角半径 px'},
    [prefix+'Saturation']:{type:'number',default:1.08,min:.5,max:2,step:.02,label:'背景饱和度'},
    [prefix+'Brightness']:{type:'number',default:1,min:.5,max:1.5,step:.02,label:'背景亮度'},
    [prefix+'TintMode']:{type:'select',default:'auto',choices:['auto','custom'],label:'玻璃染色方式'},
    [prefix+'Tint']:{type:'color',default:'#17212f',label:'玻璃染色颜色'},
  });
}

const SETTING_GROUPS = [
  {id:'appearance',title:'背景与主题',icon:'globe',description:'整页、原站侧栏、背景图片和强调色。',keys:['themeMode','pageBackground','backgroundColor','backgroundImage','backgroundShade','panelBackground','panelColor','panelOpacity','customAccent','accentColor']},
  {id:'fonts',title:'字体选择',icon:'book',description:'分别选择中英文与加粗字体，也可以输入自定义字体栈。',keys:['latinFont','chineseFont','boldLatinFont','boldChineseFont']},
  {id:'reading',title:'阅读排版',icon:'list',description:'正文、思考、引用与长对话阅读行为。',keys:['fontSize','lineHeight','headingScale','paragraphSpacing','letterSpacing','thinkingFontSize','citationFontSize','contentWidth','bodyColumnLeftOffset','bodyColumnRightOffset','normalColor','boldColor','boldWeight','nativeLightBodyColors','fontSmoothing','fontSmoothingMode','textRenderingMode','stopAutoScroll','lazyMessages']},
  {id:'code',title:'代码显示',icon:'edit',keys:['codeFont','codeFontSize','codeLineHeight','wrapCode','codeMaxHeight','codeCopy','codeLineNumbers']},
  {id:'formula',title:'公式显示与复制',icon:'copy',description:'优先保留公式结构；仅针对回答中未解析的公式进行修复。',keys:['mathFont','mathFontMode','formulaFontSize','katexLetterFont','repairLatex','formulaCopy','formulaDelimiters','formulaCopyBorderColor']},
  {id:'navigation',title:'目录与工具栏',icon:'menu',keys:['showNav','navFollow','navPreview','navLabelLength','navHoverExpand','navAutoCollapse','navDerivedHeadings','showBookmarks','showMessageCopy','messageCopyIconColor','messageToolsOnHover','showToolbarLabels','keyboardShortcuts']},
  {id:'toolbox',title:'工具箱外观',icon:'settings',keys:['toolboxFont','toolboxFontSize','toolboxLineHeight','toolboxWidth','settingsWidth','toolboxUseCustomColors','toolboxTextColor','toolboxBackgroundColor','toolboxAccentColor','toolboxBackgroundOpacity']},
  {id:'queue',title:'队列与输入框',icon:'queue',keys:['showComposerDock','queueDelay','queueQuietSeconds','queueTimeout','queuePauseHidden','queueFont','queueFontSize','queueLineHeight','queuePanelWidth','queueUseCustomColors','queueTextColor','queueBackgroundColor','queueAccentColor','queueBackgroundOpacity']},
  {id:'tokens',title:'Token 统计',icon:'bolt',description:'根据已加载文本本地估算，不是官方计费用量。',keys:['showTokenStats','showTokenMessageChips','showTokenSummary','tokenSummaryPosition','tokenSummaryOffsetX','tokenSummaryOffsetY','tokenSummaryCompact','tokenSummaryAvoidQueue','tokenCustomColors','tokenTextColor','tokenBackgroundColor']},
  ...GLASS_SURFACES.map(surface => ({id:'glass-'+surface.id,title:surface.label+'玻璃',icon:'globe',section:'液态玻璃',surface:surface.id,keys:['Glass','Mode','Style','Finish','Blur','Opacity','Strength','Thickness','Glare','Chroma','Curvature','Bend','Radius','Saturation','Brightness','TintMode','Tint'].map(key => surface.id+key)})),
  {id:'ocean',title:'ASCII 鲨鱼海洋',icon:'globe',keys:['ocean','oceanOpacity','oceanFps','oceanDensity','oceanSpecies','oceanCoverage','oceanHome','oceanQuality','oceanRenderer','oceanMotion','oceanPauseBusy','oceanPointer']},
  {id:'ocean-colors',title:'海洋配色',icon:'globe',keys:['oceanColorMode','oceanColorSeed','oceanBodyColor','oceanAccentColor','oceanFishColor','oceanWakeColor']},
];

const SELECT_LABELS = {
  native:'跟随原站',dark:'深色',light:'浅色',full:'完整效果',balanced:'均衡',frosted:'仅磨砂',clear:'清透',soft:'柔和',classic:'经典',refined:'精细边缘',glass:'仅回答玻璃',gutter:'正文两侧',off:'关闭',eco:'节能',fine:'精细',canvas:'标准 Canvas',gpu:'GPU 批量绘制',compute:'GPU 计算与绘制',live:'实时模拟',replay15:'15 分钟轨迹回放',replay30:'30 分钟轨迹回放',mixed:'混合鲨鱼',hammerhead:'双髻鲨',tiger:'虎鲨',zebra:'豹纹鲨',greathammer:'无沟双髻鲨',mako:'灰鲭鲨',thresher:'长尾鲨',nurse:'护士鲨',auto:'自动',custom:'自定义',original:'原版配色',cyan:'青蓝',aurora:'极光紫',warm:'暖金',random:'随机和谐配色','bottom-right':'右下','bottom-left':'左下','top-right':'右上','top-left':'左上',antialiased:'灰度抗锯齿','subpixel-antialiased':'次像素抗锯齿',optimizeLegibility:'阅读清晰度优先',optimizeSpeed:'速度优先',geometricPrecision:'几何精度优先',
};

const FONT_KEYS = new Set(['latinFont','chineseFont','boldLatinFont','boldChineseFont','codeFont','mathFont','toolboxFont','queueFont']);

const APPEARANCE_PRESETS = {
  reading:{label:'阅读优先',description:'清晰文字、稳定位移、弱化装饰。',values:{fontSize:25,lineHeight:1.9,wrapCode:true,stopAutoScroll:true,messageBlur:0,messageStrength:12,messageOpacity:.16,toolboxOpacity:.96,settingsOpacity:.94,oceanCoverage:'gutter',oceanFps:8,oceanPauseBusy:true}},
  glass:{label:'清透玻璃',description:'保留完整折射，独立控制各区域。',values:{ocean:true,oceanCoverage:'glass',oceanRenderer:'compute',oceanFps:12,composerGlass:true,composerBlur:1,composerStrength:36,messageGlass:true,messageBlur:1,messageStrength:30,messageOpacity:.12,toolboxGlass:true,settingsGlass:true,settingsOpacity:.84}},
  eco:{label:'节能',description:'低帧率背景、关闭额外色散与离屏工作。',values:{ocean:true,oceanFps:5,oceanQuality:'eco',oceanRenderer:'gpu',oceanDensity:40,oceanPauseBusy:true,oceanPointer:false,oceanMotion:'live',messageMode:'balanced',composerMode:'balanced',toolboxMode:'frosted',settingsMode:'frosted',lazyMessages:true}},
};

function oceanPalette(){
  const rgb=hex=>hex.match(/[a-f0-9]{2}/gi).map(value=>parseInt(value,16));
  let mode=settings.oceanColorMode;
  if(mode==='original')return [null,'#e0892c',[230,238,255],[110,230,255]];
  if(mode==='auto')mode=document.documentElement.getAttribute('data-cgfc-theme')==='light'?'warm':'cyan';
  const presets={cyan:['#7ed8f0','#c79aff','#b8e7f7','#55d8ea'],aurora:['#b9a5ff','#8af2c9','#d3c2ff','#bb81fa'],warm:['#dba15b','#e58465','#f5dcb7','#e8bb69']};
  let colors=presets[mode];
  if(mode==='custom')colors=[settings.oceanBodyColor,settings.oceanAccentColor,settings.oceanFishColor,settings.oceanWakeColor];
  if(mode==='random'){
    let seed=settings.oceanColorSeed|0;
    const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
    const hue=random();
    const hsl=(h,s,l)=>{const f=n=>{const k=(n+h*12)%12;return Math.round(255*(l-s*Math.min(l,1-l)*Math.max(-1,Math.min(k-3,9-k,1))));};return '#'+[f(0),f(8),f(4)].map(value=>value.toString(16).padStart(2,'0')).join('');};
    colors=[hsl(hue,.65,.67),hsl((hue+.18)%1,.7,.7),hsl(hue,.5,.82),hsl((hue+.06)%1,.8,.62)];
  }
  colors??=presets.cyan;
  return [rgb(colors[0]),colors[1],rgb(colors[2]),rgb(colors[3])];
}
