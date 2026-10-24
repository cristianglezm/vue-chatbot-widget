import { test, expect } from '@playwright/test';
import { DemoPage } from './controllers/DemoPage';

test.describe('chat', () => {
  let demo: DemoPage;
  test.beforeEach(async ({ page }) => {
    demo = new DemoPage(page);
    await demo.goto();
  });

  test('greets first, then keeps the conversation in order', async () => {
    const widget = await demo.readyWidget();
    await expect(widget.root.locator('.message-bubble').first()).toHaveText('Hello, I have a simple system prompt, what can I do for you?');
    await widget.ask('one');
    await widget.ask('two');
    // the info message "computing the embeddings" of the first send is a tracked issue (plan, "Tracked, not fixed")
    expect((await widget.conversation()).slice(1)).toEqual([
      ['user', 'one'], ['assistant', 'Fake reply to: one'],
      ['user', 'two'], ['assistant', 'Fake reply to: two'],
    ]);
  });

  test('the model gets the system prompt and the whole conversation', async () => {
    const widget = await demo.readyWidget();
    await widget.ask('one');
    await widget.ask('two');
    const requests = await demo.jobs('chatbot', 'streaming');
    expect(requests).toHaveLength(2);
    const last = requests[1].messages.map((m: any) => [m.role, m.content]);
    expect(last[0]).toEqual(['system', 'You are a helpful assistant.']);
    expect(last.filter(([role]: string[]) => role === 'user').map(([, c]: string[]) => c)).toEqual(['one', 'two']);
  });

  test('Enter sends, Shift+Enter adds a line', async () => {
    const widget = await demo.readyWidget();
    const box = widget.textarea;
    await box.fill('first line');
    await box.press('Shift+Enter');
    await box.pressSequentially('second line');
    await expect(box).toHaveValue('first line\nsecond line');
    await box.press('Enter');
    await expect(widget.bubble('Fake reply to: first line')).toBeVisible();
    await expect(box).toHaveValue('');
  });

  test('an empty message is not sent', async ({ page }) => {
    const widget = await demo.readyWidget();
    await widget.send('   ');
    await page.waitForTimeout(300);
    expect(await demo.jobs('chatbot', 'streaming')).toEqual([]);
    expect((await widget.messages()).filter(([role]) => role === 'user')).toEqual([]);
  });

  test('regenerate asks for the answer again', async () => {
    const widget = await demo.readyWidget();
    await widget.ask('again please');
    await widget.hoverReply('Fake reply to: again please');
    await widget.regenerate();
    await expect.poll(async () => (await demo.jobs('chatbot', 'streaming')).length).toBe(2);
    await expect(widget.bubble('Fake reply to: again please')).toHaveCount(1);
    expect((await widget.messages()).filter(([role]) => role === 'user')).toEqual([['user', 'again please']]);
  });

  test('a failing job is reported and the chat can be used again', async () => {
    const widget = await demo.readyWidget();
    await widget.send('/fail');
    await expect(demo.errorModal).toBeVisible();
    await expect(demo.errorModal).toContainText('scripted failure');
    await demo.dismissError();
    await widget.ask('still there?');
  });

  test('Remote Only talks to the remote jobs', async () => {
    const widget = await demo.readyWidget('Remote Only');
    await widget.ask('remote hello');
    expect(await demo.jobs('chatbot', 'rStreaming')).toHaveLength(1);
    expect(await demo.jobs('chatbot', 'streaming')).toEqual([]);
  });

  test('Local Only talks to the local jobs', async () => {
    const widget = await demo.readyWidget('Local Only');
    await widget.ask('local hello');
    expect(await demo.jobs('chatbot', 'streaming')).toHaveLength(1);
    expect(await demo.jobs('chatbot', 'rStreaming')).toEqual([]);
  });

  test('tool-use: a tool call runs the executor and the user is told', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
    const widget = await demo.readyWidget('tool-use');
    // the demo's executor understands `alert`
    await widget.send('/raw Sure. <tool_call>[{"name":"alert","parameters":{"message":"hi from e2e"}}]</tool_call>');
    await expect.poll(() => dialogs).toEqual(['executed tool alert with message: hi from e2e']);
    await expect(widget.row('alert command executed.')).toBeVisible();
    await expect(widget.bubble(/^Sure\.$/)).toBeVisible();
  });
});
