# Chrome 扩展测试

本目录包含使用 Playwright 测试 Chrome 扩展的测试文件。

## 运行测试

```bash
# 运行所有测试
npm test

# 使用 UI 模式运行测试（推荐）
npm run test:ui

# 有头模式运行（可以看到浏览器）
npm run test:headed

# 调试模式
npm run test:debug
```

## 测试文件说明

- `extension.spec.js` - 主要的扩展功能测试
- `extension-helpers.js` - 测试辅助函数

## 注意事项

1. **扩展 ID 获取**：测试会自动尝试获取扩展 ID，如果失败，可能需要手动设置
2. **非无头模式**：扩展测试需要在非无头模式下运行，以便正确加载扩展
3. **等待时间**：扩展加载需要一些时间，测试中已添加适当的等待

## 测试覆盖

- ✅ manifest.json 验证
- ✅ 扩展文件存在性检查
- ✅ Side panel 页面加载
- ✅ UI 元素显示
- ✅ 构建时间显示
- ✅ 消息输入功能
- ✅ 模式切换功能
- ✅ 提及按钮功能
