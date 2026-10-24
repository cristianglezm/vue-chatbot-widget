import { test, expect } from '@playwright/test';
import { DemoPage } from './controllers/DemoPage';

const CACHE = 'fe-chatbot-cache';
const HF = 'https://huggingface.co';
const LOCAL = 'http://localhost:8080';

// the real Cache Storage of a real browser: what jsdom cannot give the unit tests
test('the cache manager lists, and deletes, what is cached', async ({ page }) => {
  const demo = new DemoPage(page);
  await demo.goto();
  await demo.seedCache(CACHE, [`${HF}/a/b/resolve/main/config.json`, `${HF}/a/b/resolve/main/model.onnx`, `${LOCAL}/m/config.json`]);

  const options = await (await demo.openWidget('Basic System Prompt')).openOptions();
  await options.openLLM();
  const cache = await options.openCacheManager();
  await cache.expectHosts([HF, LOCAL]);
  await cache.selectHost(HF);
  await expect(cache.file('config.json')).toBeVisible();
  await expect(cache.file('model.onnx')).toBeVisible();

  // one file; `config.json` must not take anything else with it
  await cache.deleteFiles('model.onnx');
  await expect(cache.file('model.onnx')).toHaveCount(0);
  expect(await demo.cachedUrls(CACHE)).toEqual([`${HF}/a/b/resolve/main/config.json`, `${LOCAL}/m/config.json`]);

  // the whole host
  await cache.selectHost(HF);
  await cache.deleteSelectedHost();
  await cache.expectHosts([LOCAL]);
  expect(await demo.cachedUrls(CACHE)).toEqual([`${LOCAL}/m/config.json`]);
});
