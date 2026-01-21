import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = path.resolve(__dirname, '..');

test.describe('AI 圆桌扩展测试', () => {
  let browser;
  let context;
  let extensionId;

  test.beforeAll(async () => {
    // 启动浏览器并加载扩展
    browser = await chromium.launch({
      headless: false, // 扩展测试需要非无头模式
    });

    context = await browser.newContext({
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    // 等待扩展加载
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 获取扩展 ID
    const tempPage = await context.newPage();
    await tempPage.goto('chrome://extensions');
    await tempPage.waitForTimeout(1000);
    
    // 通过开发者模式获取扩展 ID
    extensionId = await tempPage.evaluate(() => {
      // 尝试从扩展管理页面获取 ID
      const items = document.querySelectorAll('extensions-item');
      for (const item of items) {
        const name = item.shadowRoot?.querySelector('#name')?.textContent;
        if (name && name.includes('AI 圆桌')) {
          return item.getAttribute('id');
        }
      }
      // 如果找不到，尝试从 URL 获取
      return null;
    });
    
    await tempPage.close();

    // 如果无法自动获取，可以手动设置
    if (!extensionId) {
      console.warn('无法自动获取扩展 ID，请手动设置');
      // extensionId = 'YOUR_EXTENSION_ID_HERE';
    }
  });

  test.afterAll(async () => {
    await context?.close();
    await browser?.close();
  });

  test('manifest.json 应该存在且有效', async () => {
    const fs = await import('fs');
    const manifestPath = path.join(extensionPath, 'manifest.json');
    
    expect(fs.existsSync(manifestPath)).toBeTruthy();
    
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.name).toBe('AI 圆桌 - Multi-AI Roundtable');
    expect(manifest.version).toBeTruthy();
    expect(manifest.manifest_version).toBe(3);
  });

  test('扩展文件应该存在', async () => {
    const fs = await import('fs');
    
    // 检查关键文件
    expect(fs.existsSync(path.join(extensionPath, 'background.js'))).toBeTruthy();
    expect(fs.existsSync(path.join(extensionPath, 'manifest.json'))).toBeTruthy();
    expect(fs.existsSync(path.join(extensionPath, 'sidepanel', 'panel.html'))).toBeTruthy();
    expect(fs.existsSync(path.join(extensionPath, 'sidepanel', 'panel.js'))).toBeTruthy();
    expect(fs.existsSync(path.join(extensionPath, 'sidepanel', 'panel.css'))).toBeTruthy();
    
    // 检查 content scripts
    expect(fs.existsSync(path.join(extensionPath, 'content', 'claude.js'))).toBeTruthy();
    expect(fs.existsSync(path.join(extensionPath, 'content', 'chatgpt.js'))).toBeTruthy();
    expect(fs.existsSync(path.join(extensionPath, 'content', 'gemini.js'))).toBeTruthy();
    expect(fs.existsSync(path.join(extensionPath, 'content', 'chatglm.js'))).toBeTruthy();
  });

  test('side panel 页面应该可以访问', async () => {
    if (!extensionId) {
      test.skip();
      return;
    }

    const page = await context.newPage();
    try {
      await page.goto(`chrome-extension://${extensionId}/sidepanel/panel.html`, {
        waitUntil: 'domcontentloaded',
        timeout: 10000,
      });

      // 检查页面标题
      await expect(page.locator('h1')).toContainText('AI 圆桌', { timeout: 5000 });
      
      // 检查副标题
      await expect(page.locator('.subtitle')).toContainText('Multi-AI Roundtable');
    } finally {
      await page.close();
    }
  });

  test('应该显示所有 AI 目标选项', async () => {
    if (!extensionId) {
      test.skip();
      return;
    }

    const page = await context.newPage();
    try {
      await page.goto(`chrome-extension://${extensionId}/sidepanel/panel.html`);
      
      // 等待元素加载
      await page.waitForSelector('#target-claude', { timeout: 5000 });
      
      // 检查所有 AI 选项
      await expect(page.locator('#target-claude')).toBeVisible();
      await expect(page.locator('#target-chatgpt')).toBeVisible();
      await expect(page.locator('#target-gemini')).toBeVisible();
      await expect(page.locator('#target-chatglm')).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('应该显示构建时间', async () => {
    if (!extensionId) {
      test.skip();
      return;
    }

    const page = await context.newPage();
    try {
      await page.goto(`chrome-extension://${extensionId}/sidepanel/panel.html`);
      
      // 等待构建时间加载
      await page.waitForSelector('#build-time', { timeout: 5000 });
      
      const buildTime = page.locator('#build-time');
      await expect(buildTime).toBeVisible();
      
      // 检查构建时间不是默认值
      const buildTimeText = await buildTime.textContent();
      expect(buildTimeText).not.toBe('-');
      expect(buildTimeText).not.toBe('加载失败');
    } finally {
      await page.close();
    }
  });

  test('消息输入框应该可用', async () => {
    if (!extensionId) {
      test.skip();
      return;
    }

    const page = await context.newPage();
    try {
      await page.goto(`chrome-extension://${extensionId}/sidepanel/panel.html`);
      
      const messageInput = page.locator('#message-input');
      await expect(messageInput).toBeVisible();
      await expect(messageInput).toBeEditable();
      
      // 测试输入
      await messageInput.fill('测试消息');
      await expect(messageInput).toHaveValue('测试消息');
    } finally {
      await page.close();
    }
  });

  test('发送按钮应该存在且可用', async () => {
    if (!extensionId) {
      test.skip();
      return;
    }

    const page = await context.newPage();
    try {
      await page.goto(`chrome-extension://${extensionId}/sidepanel/panel.html`);
      
      const sendBtn = page.locator('#send-btn');
      await expect(sendBtn).toBeVisible();
      await expect(sendBtn).toContainText('发送');
      await expect(sendBtn).toBeEnabled();
    } finally {
      await page.close();
    }
  });

  test('模式切换应该工作', async () => {
    if (!extensionId) {
      test.skip();
      return;
    }

    const page = await context.newPage();
    try {
      await page.goto(`chrome-extension://${extensionId}/sidepanel/panel.html`);
      
      // 初始应该是普通模式
      await expect(page.locator('#normal-mode')).toBeVisible();
      await expect(page.locator('#discussion-mode')).toHaveClass(/hidden/);
      
      // 切换到讨论模式
      await page.locator('#mode-discussion').click();
      await page.waitForTimeout(500);
      
      // 检查讨论模式内容是否显示
      await expect(page.locator('#discussion-mode')).toBeVisible();
      await expect(page.locator('#normal-mode')).toHaveClass(/hidden/);
      await expect(page.locator('#discussion-setup')).toBeVisible();
      
      // 切换回普通模式
      await page.locator('#mode-normal').click();
      await page.waitForTimeout(500);
      
      // 检查普通模式内容是否显示
      await expect(page.locator('#normal-mode')).toBeVisible();
      await expect(page.locator('#discussion-mode')).toHaveClass(/hidden/);
    } finally {
      await page.close();
    }
  });

  test('提及按钮应该工作', async () => {
    if (!extensionId) {
      test.skip();
      return;
    }

    const page = await context.newPage();
    try {
      await page.goto(`chrome-extension://${extensionId}/sidepanel/panel.html`);
      
      const messageInput = page.locator('#message-input');
      
      // 点击 Claude 提及按钮
      await page.locator('.mention-btn.claude').click();
      
      // 检查是否插入了 @Claude
      const inputValue = await messageInput.inputValue();
      expect(inputValue).toContain('@Claude');
    } finally {
      await page.close();
    }
  });
});
