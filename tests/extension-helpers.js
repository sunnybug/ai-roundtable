import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = path.resolve(__dirname, '..');

/**
 * 创建带有扩展的浏览器上下文
 */
export async function createExtensionContext() {
  const browser = await chromium.launch({
    headless: false, // 扩展测试通常需要非无头模式
  });

  const context = await browser.newContext({
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  return { browser, context };
}

/**
 * 获取扩展 ID
 * 通过访问 chrome://extensions 页面来获取
 */
export async function getExtensionId(context) {
  const page = await context.newPage();
  await page.goto('chrome://extensions');
  
  // 等待扩展列表加载
  await page.waitForTimeout(1000);
  
  // 查找扩展 ID（需要根据实际页面结构调整选择器）
  // 这里是一个示例，实际可能需要调整
  const extensionId = await page.evaluate(() => {
    // 尝试从页面中提取扩展 ID
    const extensionItems = document.querySelectorAll('extensions-item');
    for (const item of extensionItems) {
      const name = item.shadowRoot?.querySelector('#name')?.textContent;
      if (name && name.includes('AI 圆桌')) {
        return item.getAttribute('id');
      }
    }
    return null;
  });

  await page.close();
  return extensionId;
}

/**
 * 打开扩展的 side panel
 */
export async function openSidePanel(context, extensionId) {
  const sidePanelUrl = `chrome-extension://${extensionId}/sidepanel/panel.html`;
  const page = await context.newPage();
  await page.goto(sidePanelUrl);
  return page;
}
