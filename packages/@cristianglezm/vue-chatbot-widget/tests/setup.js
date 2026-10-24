import { afterEach, beforeEach, vi } from 'vitest';

// The tests share one jsdom and one module registry (`isolate: false`, see vitest.config.ts), that is what makes
// them fast: jsdom is loaded once instead of once per file. Everything a test can leave behind is reset here,
// so a test never depends on the one that ran before it, whatever the order.
beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});
