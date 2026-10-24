import { vi } from 'vitest';

/**
 * The stores keep `channel` and `wm` at module level, so every test needs fresh modules and a fresh pinia.
 * The test file must mock '@huggingface/transformers' itself (vi.mock is hoisted per file), the real package loads onnxruntime:
 *   vi.mock('@huggingface/transformers', () => ({ RawAudio: class RawAudio{} }));
 */
export const freshStores = async () => {
    vi.resetModules();
    const { createPinia, setActivePinia } = await import('pinia');
    const pinia = createPinia();
    setActivePinia(pinia);
    return {
        pinia,
        ...await import('../../src/stores/ChatBotStore'),
        ...await import('../../src/stores/KokoroStore'),
        ...await import('../../src/stores/ErrorStore'),
        ...await import('../../src/plugin'),
    };
};

/** lets the promise chains that nobody awaits (fire and forget fetches) settle. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
