import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const OPTIONS = { host: 'huggingface', model: 'org/model', device: 'CPU', dtype: 'q4', voice: 'af_bella' };
const READY = 'updateBtnTitle';

const workers = {
    chatbot: {
        file: '../src/workers/chatbot.worker.js',
        loaderPath: '../src/stores/ChatBotStore/ChatBot',
        name: 'ChatBot',
        extra: { getREmbeddings: vi.fn(), getEmbeddings: vi.fn(), chat: vi.fn(), rChat: vi.fn(), rStreamingChat: vi.fn(), streamingChat: vi.fn() },
        changes: { host: 'localhost', model: 'org/other', device: 'GPU', dtype: 'fp16' },
    },
    kokoro: {
        file: '../src/workers/kokoro.worker.js',
        loaderPath: '../src/stores/KokoroStore/Kokoro',
        name: 'Kokoro',
        extra: { audioGen: vi.fn(), rAudioGen: vi.fn(), streamingAudioGen: vi.fn() },
        changes: { host: 'localhost', model: 'org/other', device: 'GPU', dtype: 'fp16', voice: 'am_adam' },
    },
};

describe.each(Object.keys(workers))('%s worker: loadModel and the model options', (key) => {
    const w = workers[key];
    let loader, posted;
    const types = () => posted.map((m) => m.jobType);

    // `current` are the options of the model that is already in the loader
    const load = async (requested, { current = OPTIONS, getInstance = async () => ({}), force } = {}) => {
        vi.resetModules();
        loader = { modelOptions: { ...current }, reset: vi.fn(), setModelOptions: vi.fn(), getInstance: vi.fn(getInstance) };
        vi.doMock(w.loaderPath, () => ({ [w.name]: loader, ...w.extra }));
        vi.doMock('kokoro-js', () => ({ TextSplitterStream: class {} }));
        await import(w.file);
        await self.onmessage({ data: { jobType: 'loadModel', modelOptions: requested, force } });
    };

    beforeEach(() => {
        posted = [];
        vi.spyOn(self, 'postMessage').mockImplementation((m) => { posted.push(m); });
    });
    afterEach(() => { vi.doUnmock(w.loaderPath); vi.doUnmock('kokoro-js'); });

    // B1: `modelOptions.dtpe` (typo) made "options changed" always true, so the model was reset on every load
    it('does not reset the model when the options are the same', async () => {
        await load({ ...OPTIONS });
        expect(loader.reset).not.toHaveBeenCalled();
    });

    it.each(Object.entries(w.changes))('resets the model when %s changes', async (field, value) => {
        await load({ ...OPTIONS, [field]: value });
        expect(loader.reset).toHaveBeenCalledOnce();
    });

    // after the user deletes the cache of a loaded model the UI asks for a reload with the same options
    it('force: resets the model even when the options are the same', async () => {
        await load({ ...OPTIONS }, { force: true });
        expect(loader.reset).toHaveBeenCalledOnce();
    });

    it('force: false does not reset it', async () => {
        await load({ ...OPTIONS }, { force: false });
        expect(loader.reset).not.toHaveBeenCalled();
    });

    it('the reset happens before the new options are set and the model is loaded', async () => {
        const order = [];
        await load({ ...OPTIONS, model: 'org/other' }, {});
        loader.reset.mock.invocationCallOrder.forEach((n) => order.push(['reset', n]));
        loader.setModelOptions.mock.invocationCallOrder.forEach((n) => order.push(['set', n]));
        loader.getInstance.mock.invocationCallOrder.forEach((n) => order.push(['get', n]));
        expect(order.sort((a, b) => a[1] - b[1]).map((o) => o[0])).toEqual(['reset', 'set', 'get']);
    });

    it('loads with the requested options', async () => {
        const requested = { ...OPTIONS, dtype: 'fp16' };
        await load(requested);
        expect(loader.setModelOptions).toHaveBeenCalledWith(requested);
    });

    // when nothing is reset the model is already there: no progress, no "ready" callback from transformers.js
    it('still announces the model as ready when it was already loaded', async () => {
        await load({ ...OPTIONS }, { getInstance: async () => ({}) }); // resolves without calling the progress callback
        expect(types().filter((t) => t === READY)).toHaveLength(1);
    });

    it('a failed load reports the error and can be tried again', async () => {
        await load({ ...OPTIONS }, { getInstance: async () => { throw new Error('network down'); } });
        expect(posted.find((m) => m.jobType === 'error')?.error.message).toBe('network down');
        expect(types()).not.toContain(READY);
        // nothing is left over in the worker, a second request is handled like the first
        posted.length = 0;
        loader.getInstance.mockImplementation(async () => ({}));
        await self.onmessage({ data: { jobType: 'loadModel', modelOptions: { ...OPTIONS } } });
        expect(types().filter((t) => t === READY)).toHaveLength(1);
        expect(types()).not.toContain('error');
    });
});
