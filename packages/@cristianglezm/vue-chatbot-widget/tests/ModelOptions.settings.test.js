import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import mitt from 'mitt';

vi.mock('@huggingface/transformers', () => ({
    pipeline: vi.fn(), env: {}, TextStreamer: class {}, mean_pooling: vi.fn(), RawAudio: class {},
}));
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: vi.fn() }, TextSplitterStream: class {} }));
// jsdom has no Cache Storage: the cache is a fake the tests drive
const cache = vi.hoisted(() => ({ size: 0, files: false, reloads: 0, hasFilesArgs: [] }));
vi.mock('../src/stores/CacheManager', () => ({
    CacheManager: class {
        reload() { cache.reloads++; }
        size() { return cache.size; }
        hasFiles(host, files) { cache.hasFilesArgs.push([host, files]); return cache.files; }
    },
}));

const mods = {};
beforeAll(async () => {
    vi.resetModules();
    mods.ChatBotModelOptions = (await import('../src/components/ChatBotModelOptions.vue')).default;
    mods.KokoroModelOptions = (await import('../src/components/KokoroModelOptions.vue')).default;
    mods.chatStore = (await import('../src/stores/ChatBotStore')).useChatBotStore;
    mods.kokoroStore = (await import('../src/stores/KokoroStore')).useKokoroStore;
});

const CASES = [
    ['ChatBotModelOptions', 'chatStore', 'FlowerEvolverChatBotModelOptions', 'chatbot', 'HuggingFaceTB/SmolLM2-135M-Instruct'],
    ['KokoroModelOptions', 'kokoroStore', 'FlowerEvolverKokoroModelOptions', 'kokoro', 'onnx-community/Kokoro-82M-v1.0-ONNX'],
];

describe.each(CASES)('%s: the options', (name, storeName, STORAGE, prefix, defaultModel) => {
    let emitter, store, wrapper;
    const mountIt = () => {
        wrapper = mount(mods[name], { props: { emitter }, global: { stubs: { CacheManager: true } } });
        return wrapper;
    };
    const set = async (sel, value) => {
        const el = wrapper.find(sel);
        await el.setValue(value);
    };

    beforeEach(() => {
        vi.useFakeTimers();
        cache.size = 0; cache.files = false; cache.reloads = 0; cache.hasFilesArgs = [];
        setActivePinia(createPinia());
        store = mods[storeName]();
        emitter = mitt();
    });
    afterEach(() => wrapper?.unmount());

    it('shows the store options', () => {
        mountIt();
        expect(wrapper.find(`#${prefix}-host-select`).element.value).toBe('huggingface');
        expect(wrapper.find(`#${prefix}-model-id`).element.value).toBe(defaultModel);
        expect(wrapper.find(`#${prefix}-quant-select-dtype`).element.value).toBe(store.modelOptions.dtype);
        expect(wrapper.find(`#${prefix}-device-cpu`).element.checked).toBe(true);
    });

    it('saves the options when mounted', () => {
        mountIt();
        expect(JSON.parse(localStorage.getItem(STORAGE))).toEqual(store.modelOptions);
    });

    it('the model can only be edited with the localhost host', async () => {
        mountIt();
        expect(wrapper.find(`#${prefix}-model-id`).element.disabled).toBe(true);
        await set(`#${prefix}-host-select`, 'localhost');
        expect(wrapper.find(`#${prefix}-model-id`).element.disabled).toBe(false);
    });

    it('a custom model is kept with localhost and saved', async () => {
        mountIt();
        await set(`#${prefix}-host-select`, 'localhost');
        await set(`#${prefix}-model-id`, 'my/model');
        expect(store.modelOptions.model).toBe('my/model');
        expect(JSON.parse(localStorage.getItem(STORAGE)).model).toBe('my/model');
    });

    it('an empty model goes back to the default', async () => {
        mountIt();
        await set(`#${prefix}-host-select`, 'localhost');
        await set(`#${prefix}-model-id`, '');
        expect(store.modelOptions.model).toBe(defaultModel);
    });

    it('going back to huggingface puts the default model back', async () => {
        mountIt();
        await set(`#${prefix}-host-select`, 'localhost');
        await set(`#${prefix}-model-id`, 'my/model');
        await set(`#${prefix}-host-select`, 'huggingface');
        expect(store.modelOptions.model).toBe(defaultModel);
    });

    it('the dtype and device are saved', async () => {
        mountIt();
        await set(`#${prefix}-quant-select-dtype`, 'fp16');
        expect(JSON.parse(localStorage.getItem(STORAGE)).dtype).toBe('fp16');
    });

    it('lists the dtypes', () => {
        mountIt();
        const values = wrapper.findAll(`#${prefix}-quant-select-dtype option`).map((o) => o.element.value);
        expect(values).toEqual(['fp32', 'fp16', 'q8', 'int8', 'uint8', 'q4', 'q4f16', 'bnb4']);
    });

    it('the GPU is disabled without WebGPU and enabled with it', () => {
        mountIt();
        expect(wrapper.find(`#${prefix}-device-gpu`).element.disabled).toBe(true);
        wrapper.unmount();
        vi.stubGlobal('navigator', { ...navigator, gpu: {} });
        mountIt();
        expect(wrapper.find(`#${prefix}-device-gpu`).element.disabled).toBe(false);
    });

    describe('the button title', () => {
        it('says Download when the files are not cached', async () => {
            cache.size = 0;
            mountIt();
            vi.advanceTimersByTime(600);
            await wrapper.vm.$nextTick();
            expect(wrapper.find('button.safe-button').text()).toBe('Download Model');
        });

        it('says Load when something is cached', async () => {
            cache.size = 3;
            mountIt();
            vi.advanceTimersByTime(600);
            await wrapper.vm.$nextTick();
            expect(wrapper.find('button.safe-button').text()).toBe('Load Model');
        });

        it('asks the cache for the file of the quantization of the model', async () => {
            mountIt();
            const files = (dtype) => cache.hasFilesArgs.at(-1)[1].at(-1);
            for (const [dtype, file] of [['q8', 'model_quantized.onnx'], ['fp32', 'model.onnx'], ['q4', 'model_q4.onnx']]) {
                await set(`#${prefix}-quant-select-dtype`, dtype);
                expect(files()).toBe(file);
            }
            expect(cache.hasFilesArgs.at(-1)[0]).toBe('https://huggingface.co');
        });

        it('looks in localhost when the host is localhost', async () => {
            mountIt();
            await set(`#${prefix}-host-select`, 'localhost');
            expect(cache.hasFilesArgs.at(-1)[0]).toBe('http://localhost');
        });

        it('is refreshed (and the cache re-read) when a model finished loading', async () => {
            cache.files = true;
            mountIt();
            emitter.emit('ChatBotModelOptions#updateBtnTitle');
            await wrapper.vm.$nextTick();
            await wrapper.vm.$nextTick();
            expect(cache.reloads).toBeGreaterThan(0);
            expect(wrapper.find('button.safe-button').text()).toBe('Load Model');
        });
    });

    describe('loading', () => {
        const LOAD = name === 'ChatBotModelOptions' ? 'ChatBotWidget#loadChatBotModel' : 'ChatBotWidget#loadKokoroModel';

        it('does nothing when the model is loaded and the options did not change', async () => {
            const loads = [];
            emitter.on(LOAD, (p) => loads.push(p));
            store.isModelLoaded = true;
            mountIt();
            await wrapper.find('button.safe-button').trigger('click');
            expect(loads).toEqual([]);
        });

        it('shows the button as disabled while the model is loaded', async () => {
            store.isModelLoaded = true;
            mountIt();
            expect(wrapper.find('button.safe-button').classes()).toContain('disabled');
        });

        it('loads again, forced, after an option changed on a loaded model', async () => {
            const loads = [];
            emitter.on(LOAD, (p) => loads.push(p));
            store.isModelLoaded = true;
            store.oldModelOptions = structuredClone({ ...store.modelOptions });
            mountIt();
            await set(`#${prefix}-quant-select-dtype`, 'fp16');
            await wrapper.find('button.safe-button').trigger('click');
            expect(loads).toEqual([{ force: true }]);
        });

        it('putting the option back does not need a reload', async () => {
            const loads = [];
            emitter.on(LOAD, (p) => loads.push(p));
            store.isModelLoaded = true;
            store.oldModelOptions = structuredClone({ ...store.modelOptions });
            const original = store.modelOptions.dtype;
            mountIt();
            await set(`#${prefix}-quant-select-dtype`, 'fp16');
            await set(`#${prefix}-quant-select-dtype`, original);
            await wrapper.find('button.safe-button').trigger('click');
            expect(loads).toEqual([]);
        });
    });

    describe('the cache manager', () => {
        const manage = () => wrapper.findAll('button.safe-button').find((b) => b.text() === 'Manage model cache');

        it('cannot be opened with nothing downloaded', () => {
            cache.size = 0;
            mountIt();
            expect(manage().element.disabled).toBe(true);
            expect(wrapper.findComponent({ name: 'CacheManager' }).exists()).toBe(false);
        });

        it('opens and closes with something downloaded', async () => {
            cache.size = 2;
            mountIt();
            await manage().trigger('click');
            expect(wrapper.findComponent({ name: 'CacheManager' }).exists()).toBe(true);
            await wrapper.findAll('button.safe-button').find((b) => b.text() === 'Close').trigger('click');
            expect(wrapper.findComponent({ name: 'CacheManager' }).exists()).toBe(false);
        });
    });

    describe('what it leaves behind', () => {
        it('removes only its own listeners when unmounted', () => {
            const other = vi.fn();
            const other2 = vi.fn();
            emitter.on('ChatBotModelOptions#updateBtnTitle', other);
            emitter.on('modelOptions#forceReload', other2);
            mountIt();
            wrapper.unmount();
            emitter.emit('ChatBotModelOptions#updateBtnTitle');
            emitter.emit('modelOptions#forceReload');
            expect(other).toHaveBeenCalledTimes(1);
            expect(other2).toHaveBeenCalledTimes(1);
        });

        it('no listener of its own is left', () => {
            mountIt();
            wrapper.unmount();
            expect(emitter.all.get('ChatBotModelOptions#updateBtnTitle') || []).toHaveLength(0);
            expect(emitter.all.get('modelOptions#forceReload') || []).toHaveLength(0);
        });

        it('the delayed button title does not run after it was unmounted', () => {
            cache.size = 3;
            mountIt();
            wrapper.unmount();
            const before = cache.hasFilesArgs.length;
            expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
            expect(cache.hasFilesArgs.length).toBe(before);
        });
    });
});

describe('the two option panels in the same page', () => {
    it('have no duplicated ids and every label points to its own field', async () => {
        vi.useFakeTimers();
        setActivePinia(createPinia());
        const emitter = mitt();
        const a = mount(mods.ChatBotModelOptions, { props: { emitter }, attachTo: document.body, global: { stubs: { CacheManager: true } } });
        const b = mount(mods.KokoroModelOptions, { props: { emitter }, attachTo: document.body, global: { stubs: { CacheManager: true } } });
        const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
        expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
        for (const w of [a, b]) {
            for (const label of w.element.querySelectorAll('label[for]')) {
                expect(w.element.querySelector(`#${label.htmlFor}`), `label for=${label.htmlFor}`).not.toBeNull();
            }
        }
        a.unmount(); b.unmount();
    });
});

describe('KokoroModelOptions: voices', () => {
    let wrapper;
    afterEach(() => wrapper?.unmount());

    it('lists every voice once and saves the chosen one', async () => {
        vi.useFakeTimers();
        setActivePinia(createPinia());
        wrapper = mount(mods.KokoroModelOptions, { props: { emitter: mitt() }, global: { stubs: { CacheManager: true } } });
        const values = wrapper.findAll('#kokoro-voice-select option').map((o) => o.element.value);
        expect(new Set(values).size).toBe(values.length);
        await wrapper.find('#kokoro-voice-select').setValue('am_adam');
        expect(JSON.parse(localStorage.getItem('FlowerEvolverKokoroModelOptions')).voice).toBe('am_adam');
    });

    it('the voices cache can be opened and closed (needs a downloaded model)', async () => {
        vi.useFakeTimers();
        cache.size = 1;
        setActivePinia(createPinia());
        wrapper = mount(mods.KokoroModelOptions, { props: { emitter: mitt() }, global: { stubs: { CacheManager: true } } });
        const btn = () => wrapper.findAll('button.safe-button').find((b) => b.text() === 'Manage voices cache');
        await btn().trigger('click');
        expect(wrapper.findAllComponents({ name: 'CacheManager' })).toHaveLength(1);
        await wrapper.findAll('button.safe-button').filter((b) => b.text() === 'Close').at(-1).trigger('click');
        expect(wrapper.findAllComponents({ name: 'CacheManager' })).toHaveLength(0);
    });
});
