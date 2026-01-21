import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Playwright 配置用于测试 Chrome 扩展
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  /* 并行运行测试 */
  fullyParallel: false, // 扩展测试建议串行运行
  /* 失败时重试 */
  retries: process.env.CI ? 2 : 0,
  /* 并行 worker 数量 */
  workers: 1, // 扩展测试建议使用单个 worker
  /* 报告器配置 */
  reporter: [
    ['html'],
    ['list'],
  ],
  /* 共享测试配置 */
  use: {
    /* 收集失败时的追踪信息 */
    trace: 'on-first-retry',
    /* 截图配置 */
    screenshot: 'only-on-failure',
    /* 视频录制 */
    video: 'retain-on-failure',
  },

  /* 配置测试项目 */
  projects: [
    {
      name: 'chromium-extension',
      use: {
        ...devices['Desktop Chrome'],
        // 注意：扩展加载需要在测试中手动配置
        // 因为 Playwright 的 contextOptions 不支持直接加载扩展
      },
    },
  ],

  /* 测试超时设置 */
  timeout: 30000,
  expect: {
    timeout: 5000,
  },

  /* TypeScript 支持 */
  // Playwright 会自动检测 TypeScript 文件
});
