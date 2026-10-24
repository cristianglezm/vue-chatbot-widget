import { expect, type Locator, type Page } from '@playwright/test';

/** the cache manager inside the options (`CacheManager.vue`). */
export class CacheManagerController {
  readonly root: Locator;
  constructor(private readonly page: Page, scope: Locator) {
    this.root = scope.locator('#cacheManager');
  }

  host(name: string) { return this.root.getByRole('option', { name }); }
  file(name: string) { return this.root.getByRole('option', { name, exact: true }); }
  get hosts() { return this.root.getByRole('option'); }

  async selectHost(name: string) { await this.host(name).click(); }

  async deleteFiles(...names: string[]) {
    for (const [i, name] of names.entries()) {
      await this.file(name).click({ modifiers: i ? ['ControlOrMeta'] : [] });
    }
    await this.root.getByRole('button', { name: 'Delete Selected Files' }).click();
    await this.page.locator('#cache-manager-confirm-modal').getByRole('button', { name: 'delete selected files from cache.' }).click();
  }

  async deleteSelectedHost() {
    await this.root.getByRole('button', { name: 'Delete Selected Host' }).click();
    await this.page.locator('#cache-manager-confirm-modal').getByRole('button', { name: 'delete Host from cache.' }).click();
  }

  async expectHosts(hosts: string[]) { await expect(this.hosts).toHaveText(hosts); }
}
