import { expect, type Locator, type Page } from '@playwright/test';
import { WidgetController } from './WidgetController';

export type FakeWorkerName = 'chatbot' | 'kokoro';

/** the demo, served with scripted workers (`?fakeWorkers`): no model is downloaded. */
export class DemoPage {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto('/?fakeWorkers');
    await expect(this.page.getByRole('heading', { name: 'ChatBot-Widget Demo', level: 1 })).toBeVisible();
  }

  section(title: string) { return this.page.getByRole('heading', { name: title, level: 2 }); }

  /** opens the widget of one of the sections, ie: 'Basic System Prompt'. */
  async openWidget(section: string): Promise<WidgetController> {
    await this.page.getByRole('button', { name: new RegExp(`Open ChatBot - ${section}$`) }).click();
    const widget = new WidgetController(this.page);
    await expect(widget.root).toBeVisible();
    return widget;
  }

  /** opens a widget, loads its model and opens the chat. */
  async readyWidget(section = 'Basic System Prompt'): Promise<WidgetController> {
    const widget = await this.openWidget(section);
    await widget.load();
    await widget.openChat();
    return widget;
  }

  // what the app shows outside the widget
  get errorModal(): Locator { return this.page.locator('.ErrorModal'); }
  async dismissError() {
    await this.errorModal.getByRole('button', { name: 'Ok.' }).click();
    await expect(this.errorModal).toHaveCount(0);
  }
  get progress(): Locator { return this.page.locator('#chatbot-multiProgressBar'); }

  /** every job the widget sent to a fake worker (the log is `window.__fakeWorkerLog`). */
  jobs(worker: FakeWorkerName, jobType?: string) {
    return this.page.evaluate(
      ([w, t]) => ((window as any).__fakeWorkerLog as any[]).filter((j) => j.worker === w && (!t || j.jobType === t)),
      [worker, jobType ?? ''] as const,
    );
  }

  /** a value the widget saved in localStorage. */
  stored(key: string) {
    return this.page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);
  }

  /** puts files in a Cache Storage, ie: what a model download leaves. */
  seedCache(name: string, urls: string[]) {
    return this.page.evaluate(async ([cacheName, files]) => {
      const cache = await caches.open(cacheName);
      for (const url of files) await cache.put(url, new Response('x'));
    }, [name, urls] as const);
  }
  cachedUrls(name: string) {
    return this.page.evaluate(async (n) => (await (await caches.open(n)).keys()).map((r) => r.url), name);
  }
}
