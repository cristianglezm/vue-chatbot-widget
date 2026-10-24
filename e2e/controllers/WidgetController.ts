import { expect, type Locator, type Page } from '@playwright/test';
import { OptionsController } from './OptionsController';

export type Message = [role: string, content: string];

/** one `ChatBotWidget` of the demo. Selectors of the widget live here and nowhere else. */
export class WidgetController {
  readonly root: Locator;
  constructor(private readonly page: Page) {
    this.root = page.locator('.chatbot-widget-core');
  }

  get textarea() { return this.root.getByPlaceholder('Type a message...'); }
  get sendButton() { return this.root.getByRole('button', { name: 'Send' }); }
  get led() { return this.root.locator('.led-button svg'); }
  get online() { return this.root.locator('.status-icon-online'); }
  get offline() { return this.root.locator('.status-icon-offline'); }
  get gear() { return this.root.locator('.gear-button'); }
  get chatBox() { return this.root.locator('.chat-box'); }

  /** a message bubble with that text. */
  bubble(text: string | RegExp) { return this.root.locator('.message-bubble', { hasText: text }); }
  /** a message row (role and bubble, and info messages) with that text. */
  row(text: string | RegExp) { return this.root.locator('.chat-message', { hasText: text }); }

  /** clicks the red dot; resolves when the model is "loaded" (the dot is green). */
  async load() {
    await this.led.click();
    await expect(this.online).toBeVisible();
  }

  async openChat() {
    await this.root.locator('.drop-menu').click();
    await expect(this.chatBox).toBeVisible();
  }

  /** types a message and sends it with the button. */
  async send(text: string) {
    await this.textarea.fill(text);
    await this.sendButton.click();
  }

  /** the question and its answer, in the chat, once it is there. */
  async ask(text: string, reply = `Fake reply to: ${text}`) {
    await this.send(text);
    await expect(this.bubble(reply)).toBeVisible();
  }

  async hoverReply(text: string | RegExp) {
    await this.bubble(text).hover();
  }
  async regenerate() {
    await this.root.getByRole('button', { name: 'Regenerate' }).click();
  }

  /** the messages on screen as `[role, content]`. */
  async messages(): Promise<Message[]> {
    const rows = this.root.locator('.chat-message');
    const out: Message[] = [];
    for (let i = 0; i < await rows.count(); i++) {
      const row = rows.nth(i);
      const bubble = row.locator('.message-bubble');
      if (await bubble.count() === 0) continue; // the typing dots
      out.push([(await row.locator('.chat-role').innerText()).trim(), (await bubble.innerText()).trim()]);
    }
    return out;
  }
  /** only what was said: no info messages. */
  async conversation() {
    return (await this.messages()).filter(([role]) => role === 'user' || role === 'assistant');
  }

  async openOptions(): Promise<OptionsController> {
    await this.gear.click();
    const options = new OptionsController(this.page, this.root);
    await options.expectOpen();
    return options;
  }
}
