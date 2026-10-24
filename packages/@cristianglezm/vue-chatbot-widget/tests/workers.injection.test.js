import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeWorker } from './helpers/FakeWorker';

// the real package loads onnxruntime; the stores only need RawAudio's name.
vi.mock('@huggingface/transformers', () => ({ RawAudio: class RawAudio{} }));

// the stores keep `channel` and `wm` at module level, so every test gets fresh modules and a fresh pinia.
const fresh = async () => {
    vi.resetModules();
    const { createPinia, setActivePinia } = await import('pinia');
    const pinia = createPinia();
    setActivePinia(pinia);
    return {
        pinia,
        ...await import('../src/stores/ChatBotStore'),
        ...await import('../src/stores/KokoroStore'),
        ...await import('../src/stores/ErrorStore'),
        ...await import('../src/plugin'),
    };
};

describe('workers are injected, not imported', () => {
    let WorkerSpy;
    beforeEach(() => {
        WorkerSpy = vi.fn();
        vi.stubGlobal('Worker', WorkerSpy);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('importing the library creates no worker', async () => {
        await fresh();
        expect(WorkerSpy).not.toHaveBeenCalled();
    });

    it.each([
        ['chatbot', 'useChatBotStore'],
        ['kokoro', 'useKokoroStore'],
    ])('%s: the worker is built on the first request, once', async (name, useStore) => {
        const m = await fresh();
        const store = m[useStore]();
        const worker = new FakeWorker();
        const factory = vi.fn(() => worker);

        store.registerWorker(factory);
        expect(factory).not.toHaveBeenCalled();

        await store.requestReset();
        await store.requestReset();

        expect(factory).toHaveBeenCalledOnce();
        expect(worker.posted).toEqual([{ jobType: 'reset' }, { jobType: 'reset' }]);
    });

    it('chatbot: worker messages reach the store and the widget channel', async () => {
        const m = await fresh();
        const store = m.useChatBotStore();
        const worker = new FakeWorker();
        const toWidget = vi.fn();
        store.registerWorker(() => worker);
        store.channel.on('ChatBotWidget#ToEmitter', toWidget);
        await store.requestReset(); // spawns it

        expect(store.isModelLoaded).toBe(false);
        worker.reply({ jobType: 'updateBtnTitle', title: 'ready' });

        expect(store.isModelLoaded).toBe(true);
        expect(toWidget).toHaveBeenCalledWith({ jobType: 'updateBtnTitle', title: 'ready' });
    });

    it('chatbot: a job error and an uncaught worker error both end up in the ErrorStore', async () => {
        const m = await fresh();
        const store = m.useChatBotStore();
        const errors = m.useErrorStore();
        const worker = new FakeWorker();
        store.registerWorker(() => worker);
        await store.requestReset();

        worker.reply({ jobType: 'error', error: 'model failed' });
        worker.fail('boom', 'chatbot.worker.js', 3);

        expect(errors.getErrors).toEqual(['model failed', 'boom at chatbot.worker.js at line 3']);
    });

    it('kokoro: an audio response is stored and announced', async () => {
        const m = await fresh();
        const store = m.useKokoroStore();
        const worker = new FakeWorker();
        const audioResp = vi.fn();
        store.registerWorker(() => worker);
        store.channel.on('ChatBotWidget#audioResp', audioResp);
        await store.requestReset();

        worker.reply({ jobType: 'audioResp', text: 'hi', audio: 'AUDIO' });

        expect(audioResp).toHaveBeenCalledWith({ audio: 'AUDIO', text: 'hi' });
        expect(await store.getAudio('hi')).toBeDefined();
    });

    it('a missing worker is reported to the user, not just to the console', async () => {
        const m = await fresh();
        const store = m.useChatBotStore();
        const errors = m.useErrorStore();
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});

        await store.requestReset(); // nothing registered

        expect(log).toHaveBeenCalledOnce();
        expect(errors.getErrors).toHaveLength(1);
        expect(errors.getErrors[0]).toContain('chatbot');
        expect(errors.getErrors[0]).toContain('workers');
    });

    it('registering something that is not a function fails loudly', async () => {
        const m = await fresh();
        // what `import W from '...?worker'` gives is a class: it must be wrapped, () => new W()
        expect(() => m.useChatBotStore().registerWorker('chatbot.worker.js')).toThrow(/must be a function/);
    });
});

describe('initStores / plugin options', () => {
    beforeEach(() => vi.stubGlobal('Worker', vi.fn()));
    afterEach(() => vi.unstubAllGlobals());

    it('registers the given factories, each in its own store', async () => {
        const m = await fresh();
        const chatbot = new FakeWorker(), kokoro = new FakeWorker();
        m.initStores({ pinia: m.pinia, workers: { chatbot: () => chatbot, kokoro: () => kokoro } });

        await m.useChatBotStore(m.pinia).requestReset();
        expect(chatbot.posted).toHaveLength(1);
        expect(kokoro.posted).toHaveLength(0);

        await m.useKokoroStore(m.pinia).requestReset();
        expect(kokoro.posted).toHaveLength(1);
    });

    it('works without workers (they are optional until something needs them)', async () => {
        const m = await fresh();
        expect(() => m.initStores({ pinia: m.pinia })).not.toThrow();
    });

    it('creates a pinia when none is given and returns it', async () => {
        const m = await fresh();
        expect(m.initStores()).toBeDefined();
    });
});
