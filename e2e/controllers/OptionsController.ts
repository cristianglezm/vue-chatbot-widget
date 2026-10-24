import { expect, type Locator, type Page } from '@playwright/test';
import { CacheManagerController } from './CacheManagerController';

/** the options dialog of the widget: general options, LLM and TTS panels. */
export class OptionsController {
  readonly dialog: Locator;
  constructor(private readonly page: Page, widget: Locator) {
    this.dialog = widget.locator('#ChatBot-dialog-options');
  }

  async expectOpen() { await expect(this.dialog).toBeVisible(); }
  async expectClosed() { await expect(this.dialog).not.toBeVisible(); }
  async close() { await this.dialog.locator('.close').click(); }

  get generateSpeech() { return this.dialog.locator('#generateSpeech'); }

  // LLM panel
  async openLLM() { await this.dialog.getByText('LLM Options').click(); }
  /** the ball of the first switch is the LLM one, the second one the TTS one. */
  async switchLLM() { await this.dialog.locator('.switch-panel-ball').first().click(); }
  get hostSelect() { return this.dialog.locator('#chatbot-host-select'); }
  get modelInput() { return this.dialog.locator('#chatbot-model-id'); }
  get remoteUrl() { return this.dialog.locator('#llm-url'); }
  get loadButton() { return this.dialog.locator('button.safe-button', { hasText: /Download Model|Load Model/ }).first(); }
  get manageCacheButton() { return this.dialog.getByRole('button', { name: 'Manage model cache' }); }

  /** opens the LLM panel and picks the localhost host, the only one whose model can be typed. */
  async chooseLocalModel(model: string) {
    await this.openLLM();
    await this.hostSelect.selectOption('localhost');
    await this.modelInput.fill(model);
  }
  async load() { await this.loadButton.click(); }

  async openCacheManager(): Promise<CacheManagerController> {
    // the options read the cache a moment after they are shown
    await expect(this.manageCacheButton).toBeEnabled();
    await this.manageCacheButton.click();
    return new CacheManagerController(this.page, this.dialog);
  }
}
