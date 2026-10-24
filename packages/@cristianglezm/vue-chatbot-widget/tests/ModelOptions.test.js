import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import mitt from 'mitt';

vi.mock('@huggingface/transformers', () => ({
    pipeline: vi.fn(), env: {}, TextStreamer: class {}, mean_pooling: vi.fn(), RawAudio: class {},
}));
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: vi.fn() }, TextSplitterStream: class {} }));
// jsdom has no Cache Storage
vi.mock('../src/stores/CacheManager', () => ({
    CacheManager: class { reload() {} size() { return 0; } hasFiles() { return false; } },
}));

// The test files share one module registry (isolate: false). The components are imported after a reset, so they are
// bound to the mocks of THIS file, not to the ones of a file that ran before.
const components = {};
beforeAll(async () => {
    vi.resetModules();
    components.ChatBotModelOptions = (await import('../src/components/ChatBotModelOptions.vue')).default;
    components.KokoroModelOptions = (await import('../src/components/KokoroModelOptions.vue')).default;
});

describe.each([
    ['ChatBotModelOptions', 'ChatBotWidget#loadChatBotModel'],
    ['KokoroModelOptions', 'ChatBotWidget#loadKokoroModel'],
])('%s: the load button', (name, LOAD) => {
    let emitter, loads, wrapper, Component;
    const click = async () => {
        await wrapper.find('button.safe-button').trigger('click');
    };

    beforeEach(() => {
        Component = components[name];
        setActivePinia(createPinia());
        emitter = mitt();
        loads = [];
        emitter.on(LOAD, (payload) => loads.push(payload));
        wrapper = mount(Component, { props: { emitter }, global: { plugins: [] } });
    });

    it('asks to load the model', async () => {
        await click();
        expect(loads).toHaveLength(1);
    });

    it('does not force a reload by default', async () => {
        await click();
        expect(loads[0]).toEqual({ force: false });
    });

    // the cache of the loaded model was deleted: same options, but it has to be downloaded again
    it('forces the reload after the cache of the model was deleted', async () => {
        emitter.emit('modelOptions#forceReload');
        await click();
        expect(loads[0]).toEqual({ force: true });
    });

    it('only the first load after that is forced', async () => {
        emitter.emit('modelOptions#forceReload');
        await click();
        await click();
        expect(loads.map((l) => l.force)).toEqual([true, false]);
    });
});
