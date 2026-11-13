# AI Studio 工具箱 4.0.0 源码

此包包含交付版所用源码和完整构建依赖。需要 Node.js，构建不需要安装 npm 依赖或访问网络。

在解压目录执行：

```sh
node build.mjs
node --check ai-studio-toolbox.user.js
```

输出为 `ai-studio-toolbox.user.js`。`core.js` 保留已有的消息适配、主题、玻璃及海洋引擎；`platform.js` 管理生命周期、对话框、浮窗和附件存储；`settings-extra.js`、`settings-ui.js`、`ui.css`、`ui.js`、`views.js`、`reading.js`、`queue-ui.js`、`queue-engine.js`、`export-ui.js` 分别实现设置、界面、阅读、队列和导出。`tail.js` 只有 `// ═══ Preserve a user` 标记后的部分进入构建，前面的旧队列不进入产物。

`vendor/package` 中是 KaTeX 0.16.44 的 MIT 授权和所需运行资源。构建脚本将其 JS、CSS、woff2 字体内置到单文件脚本，运行时按需初始化。

`vendor/prettier` 包含 Prettier 3.10.1 的离线格式化程序、Babel/ESTree 插件及授权。构建最后按交付配置格式化，确保输出字节与经过验证的文件一致。

交付脚本 SHA-256：

```text
b51d1af3edb5fd702f2ff3dd6effa2f54f7c313dabafa65f5d53ddc49ffd58c7
```

Edge 验证结果和使用说明随交付目录单独提供。浏览器环境会影响实际效果，隔离测试不等于已安装扩展环境中的真实模型生成验证。
