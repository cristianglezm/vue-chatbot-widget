import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@huggingface/transformers', () => ({
    pipeline: vi.fn(), env: {}, TextStreamer: class {}, mean_pooling: vi.fn(), RawAudio: class {},
}));
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: vi.fn() }, TextSplitterStream: class {} }));
// jsdom has no Cache Storage (only the voices comparison mounts a panel that creates one)
vi.mock('../src/stores/CacheManager', () => ({
    CacheManager: class { reload() {} size() { return 0; } hasFiles() { return false; } },
}));

const mods = {};
beforeAll(async () => {
    vi.resetModules();
    mods.LLMRemoteOptions = (await import('../src/components/LLMRemoteOptions.vue')).default;
    mods.TTSRemoteOptions = (await import('../src/components/TTSRemoteOptions.vue')).default;
    mods.chatStore = (await import('../src/stores/ChatBotStore')).useChatBotStore;
    mods.kokoroStore = (await import('../src/stores/KokoroStore')).useKokoroStore;
});

const CASES = [
    ['LLMRemoteOptions', 'chatStore', 'FlowerEvolverChatBotRemoteOptions', 'llm-url', 'http://localhost:8080'],
    ['TTSRemoteOptions', 'kokoroStore', 'FlowerEvolverKokoroRemoteOptions', 'tts-url', 'http://localhost:8880'],
];

describe.each(CASES)('%s', (name, storeName, STORAGE, urlId, defaultUrl) => {
    let store, wrapper;
    const saved = () => JSON.parse(localStorage.getItem(STORAGE));
    beforeEach(() => {
        setActivePinia(createPinia());
        store = mods[storeName]();
        wrapper = mount(mods[name]);
    });
    afterEach(() => wrapper.unmount());

    it('shows the store options', () => {
        expect(wrapper.find(`#${urlId}`).element.value).toBe(defaultUrl);
        expect(wrapper.find('#apiKey').element.value).toBe('sk-no-key-required');
        expect(wrapper.find('#model').element.value).toBe(store.remoteOptions.model);
    });

    it('changing the url updates the store and saves it', async () => {
        await wrapper.find(`#${urlId}`).setValue('http://example.org:1234');
        await wrapper.find(`#${urlId}`).trigger('change');
        expect(store.remoteOptions.url).toBe('http://example.org:1234');
        expect(saved().url).toBe('http://example.org:1234');
    });

    it('changing the api key and the model saves them', async () => {
        await wrapper.find('#apiKey').setValue('sk-123');
        await wrapper.find('#apiKey').trigger('change');
        await wrapper.find('#model').setValue('other');
        await wrapper.find('#model').trigger('change');
        expect(saved()).toMatchObject({ api_key: 'sk-123', model: 'other' });
    });

    it('nothing is saved while the user is still typing (only on change)', async () => {
        const input = wrapper.find(`#${urlId}`);
        input.element.value = 'http://typing';
        await input.trigger('input'); // setValue() would also fire `change`
        expect(store.remoteOptions.url).toBe('http://typing');
        expect(localStorage.getItem(STORAGE)).toBeNull();
    });

    it('a second instance shows the options the first one saved (shared store)', async () => {
        await wrapper.find('#model').setValue('shared');
        await wrapper.find('#model').trigger('change');
        const second = mount(mods[name]);
        expect(second.find('#model').element.value).toBe('shared');
        second.unmount();
    });
});

describe('LLMRemoteOptions: advanced options', () => {
    let store, wrapper;
    beforeEach(() => {
        setActivePinia(createPinia());
        store = mods.chatStore();
        wrapper = mount(mods.LLMRemoteOptions);
    });
    afterEach(() => wrapper.unmount());

    it.each([
        ['#max-tokens', 'max_tokens', 256, '512', 512],
        ['#temperature', 'temperature', 0.8, '0.2', 0.2],
        ['#top_k', 'top_k', 40, '10', 10],
        ['#min_p', 'min_p', 0.05, '0.1', 0.1],
        ['#top_p', 'top_p', 0.95, '0.5', 0.5],
    ])('%s shows the default and is saved as a number', async (sel, key, def, typed, expected) => {
        expect(wrapper.find(sel).element.value).toBe(String(def));
        await wrapper.find(sel).setValue(typed);
        await wrapper.find(sel).trigger('change');
        expect(store.remoteOptions[key]).toBe(expected);
        expect(JSON.parse(localStorage.getItem('FlowerEvolverChatBotRemoteOptions'))[key]).toBe(expected);
    });
});

describe('TTSRemoteOptions: voice', () => {
    it('lists every voice once and saves the chosen one', async () => {
        setActivePinia(createPinia());
        const store = mods.kokoroStore();
        const wrapper = mount(mods.TTSRemoteOptions);
        const values = wrapper.findAll('#kokoro-voice-select option').map((o) => o.element.value);
        expect(values.filter((v, i) => values.indexOf(v) !== i)).toEqual([]);
        await wrapper.find('#kokoro-voice-select').setValue('bm_fable');
        expect(store.remoteOptions.voice).toBe('bm_fable');
        expect(JSON.parse(localStorage.getItem('FlowerEvolverKokoroRemoteOptions')).voice).toBe('bm_fable');
        wrapper.unmount();
    });

    it('offers the same voices as the local Kokoro options', async () => {
        setActivePinia(createPinia());
        const tts = mount(mods.TTSRemoteOptions);
        vi.resetModules();
        const KMO = (await import('../src/components/KokoroModelOptions.vue')).default;
        const local = mount(KMO, { props: { emitter: { on() {}, off() {}, emit() {} } }, global: { stubs: { CacheManager: true } } });
        const names = (w) => w.findAll('#kokoro-voice-select option').map((o) => o.element.value).sort();
        expect(names(tts)).toEqual(names(local));
        tts.unmount(); local.unmount();
    });
});
