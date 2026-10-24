import { test, expect } from '@playwright/test';
import { DemoPage } from './controllers/DemoPage';

test.describe('smoke: the demo with scripted workers', () => {
  let demo: DemoPage;
  test.beforeEach(async ({ page }) => {
    demo = new DemoPage(page);
    await demo.goto();
  });

  test('shows the demo sections', async () => {
    for (const title of ['Basic System Prompt', 'Remote Only', 'Local Only', 'tool-use']) {
      await expect(demo.section(title)).toBeVisible();
    }
  });

  test('the fake workers are the ones in use (no model is downloaded)', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    const widget = await demo.openWidget('Basic System Prompt');
    await widget.load();
    expect(requests.filter((u) => /huggingface\.co|\.onnx|\.wasm/.test(u))).toEqual([]);
    expect((await demo.jobs('chatbot', 'loadModel')).length).toBe(1);
  });

  test('load the model, say hello and get the scripted reply', async () => {
    const widget = await demo.readyWidget();
    await widget.ask('hello there');
    const shown = await widget.messages();
    expect(shown.at(-2)).toEqual(['user', 'hello there']);
    expect(shown.at(-1)).toEqual(['assistant', 'Fake reply to: hello there']);
  });

  test('sending before the model is loaded reports it', async ({ page }) => {
    const widget = await demo.openWidget('Basic System Prompt');
    await widget.openChat();
    await widget.send('anyone there?');
    await expect(page.getByText('ChatBot not loaded, please load it by clicking the red dot.')).toBeVisible();
  });
});
