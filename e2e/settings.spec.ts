import { test, expect } from '@playwright/test';
import { DemoPage } from './controllers/DemoPage';

test.describe('settings', () => {
  let demo: DemoPage;
  test.beforeEach(async ({ page }) => {
    demo = new DemoPage(page);
    await demo.goto();
  });

  test('the options open and close', async () => {
    const widget = await demo.openWidget('Basic System Prompt');
    const options = await widget.openOptions();
    await expect(options.dialog.getByRole('heading', { name: 'Options' })).toBeVisible();
    await options.close();
    await options.expectClosed();
  });

  test('a widget that is not editable has no options', async () => {
    const widget = await demo.openWidget('Remote Only');
    await widget.gear.click({ force: true });
    await expect(widget.root.locator('#ChatBot-dialog-options')).not.toBeVisible();
  });

  test('the options are kept after a reload', async ({ page }) => {
    const widget = await demo.openWidget('Basic System Prompt');
    const options = await widget.openOptions();
    const before = await options.generateSpeech.isChecked();
    await options.generateSpeech.setChecked(!before);
    expect((await demo.stored('chatbotWidget#Options')).generateSpeech).toBe(!before);
    await page.reload();
    const again = await (await demo.openWidget('Basic System Prompt')).openOptions();
    await expect(again.generateSpeech).toBeChecked({ checked: !before });
  });

  test('the LLM panel switches between the local and the remote options', async () => {
    const options = await (await demo.openWidget('Basic System Prompt')).openOptions();
    await options.openLLM();
    await expect(options.hostSelect).toBeVisible();
    await options.switchLLM();
    await expect(options.remoteUrl).toBeVisible();
    await expect(options.hostSelect).toHaveCount(0);
    expect(await demo.stored('FlowerEvolverChatBotIsLocal')).toBe(false);
  });

  test('remote options are saved when they change', async () => {
    const options = await (await demo.openWidget('Basic System Prompt')).openOptions();
    await options.openLLM();
    await options.switchLLM();
    await options.remoteUrl.fill('http://example.org:9999');
    await options.remoteUrl.blur();
    expect((await demo.stored('FlowerEvolverChatBotRemoteOptions')).url).toBe('http://example.org:9999');
  });

  test.describe('loading a model', () => {
    test('shows the progress of the download and then the model is ready', async () => {
      const widget = await demo.openWidget('Basic System Prompt');
      const options = await widget.openOptions();
      await options.chooseLocalModel('fake/slow');
      await options.load();
      await expect(demo.progress).toBeVisible();
      await expect(demo.progress.getByRole('heading', { name: 'model.onnx' })).toBeVisible();
      await expect(demo.progress).not.toBeVisible({ timeout: 10_000 });
      await expect(widget.online).toBeVisible();
      const loads = await demo.jobs('chatbot', 'loadModel');
      expect(loads[0].modelOptions).toMatchObject({ host: 'localhost', model: 'fake/slow' });
    });

    test('a model that fails to load is reported, the progress closes and the chat stays offline', async () => {
      const widget = await demo.openWidget('Basic System Prompt');
      const options = await widget.openOptions();
      await options.chooseLocalModel('fake/fail');
      await options.load();
      // the options are open (a modal dialog): the error has to be above it, not only in the page
      await expect(demo.errorModal).toBeVisible();
      await expect(demo.errorModal).toContainText('could not load fake/fail');
      await expect(demo.progress).not.toBeVisible();
      await expect(widget.offline).toBeVisible();
    });

    test('after a failed load a good model can be loaded', async () => {
      const widget = await demo.openWidget('Basic System Prompt');
      const options = await widget.openOptions();
      await options.chooseLocalModel('fake/fail');
      await options.load();
      await demo.dismissError();
      await options.modelInput.fill('fake/ok');
      await options.load();
      await expect(widget.online).toBeVisible();
      await options.close();
      await widget.openChat();
      await widget.ask('ready?');
    });
  });

  test('with Generate Speech the voice is loaded and the answer is turned into audio', async () => {
    const widget = await demo.openWidget('Basic System Prompt');
    const options = await widget.openOptions();
    await options.generateSpeech.check();
    await options.close();
    await widget.load();
    await expect.poll(async () => (await demo.jobs('kokoro', 'loadModel')).length).toBe(1);
    await widget.openChat();
    await widget.ask('say it');
    await expect.poll(async () => (await demo.jobs('kokoro', 'streamingAudio')).length).toBe(1);
    expect((await demo.jobs('kokoro', 'streamingAudio'))[0].text).toBe('Fake reply to: say it');
  });
});
