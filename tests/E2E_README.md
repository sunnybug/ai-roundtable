# E2E 测试说明

## 测试文件

`e2e.spec.ts` - 端到端测试，验证插件在 ChatGLM 网站上的 Content Script 注入。

## 运行测试

```bash
# 运行 E2E 测试
npm run test:e2e

# 有头模式运行（可以看到浏览器操作）
npm run test:e2e:headed

# 使用 UI 模式运行
npm run test:ui -- tests/e2e.spec.ts

# 调试模式
npm run test:debug -- tests/e2e.spec.ts
```

## 测试内容

1. **插件加载验证** - 检查插件文件是否存在
2. **Content Script 注入验证** - 验证 Content Script 是否成功注入到 ChatGLM 页面
3. **通信测试** - 验证与 Content Script 的通信能力
4. **页面元素检测** - 检测 ChatGLM 页面的输入框等元素

## 验证方法

测试使用多种方法验证 Content Script 是否注入：

1. **Chrome Runtime API 检测** - 检查页面上下文中是否存在 `chrome.runtime` API
2. **控制台日志检测** - 监听 Content Script 输出的日志消息
3. **扩展标记检测** - 检查是否有扩展注入的全局变量标记

## 注意事项

- 测试需要在非无头模式下运行（已自动配置）
- 扩展会自动加载，无需手动安装
- 如果无法自动获取扩展 ID，测试会跳过相关测试用例
- 某些验证方法可能因浏览器安全策略而受限

## 故障排除

如果测试失败：

1. 检查扩展路径是否正确
2. 确认 `manifest.json` 中 ChatGLM 的 URL 模式已配置
3. 检查网络连接，确保可以访问 ChatGLM 网站
4. 查看测试输出中的详细日志信息
