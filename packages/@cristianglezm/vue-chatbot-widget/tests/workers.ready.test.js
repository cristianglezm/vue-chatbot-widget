import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const OPTIONS = { host: 'h', model: 'm', device: 'CPU', dtype: 'q4', voice: 'af_bella' };
const files = ['config.json', 'tokenizer.json', 'model.onnx'];
const READY = 'updateBtnTitle';

// what transformers.js reports for every file it downloads
const download = (cb) => files.forEach((file) => {
    cb({ status: 'initiate', file });
    cb({ status: 'progress', file, progress: 100 });
    cb({ status: 'done', file });
});

describe('workers announce "the model is ready" (updateBtnTitle)', () => {
    let posted;
    const types = () => posted.map((m) => m.jobType);
    const load = async ({ worker, loaderPath, name, extra, getInstance }) => {
        vi.resetModules();
        const loader = { modelOptions: { ...OPTIONS }, reset: vi.fn(), setModelOptions: vi.fn(), getInstance: vi.fn(getInstance) };
        vi.doMock(loaderPath, () => ({ [name]: loader, ...extra }));
        vi.doMock('kokoro-js', () => ({ TextSplitterStream: class {} }));
        await import(worker);
        await self.onmessage({ data: { jobType: 'loadModel', modelOptions: OPTIONS } });
    };
    const kokoro = (getInstance) => load({
        worker: '../src/workers/kokoro.worker.js',
        loaderPath: '../src/stores/KokoroStore/Kokoro',
        name: 'Kokoro',
        extra: { audioGen: vi.fn(), rAudioGen: vi.fn(), streamingAudioGen: vi.fn() },
        getInstance,
    });
    const chatbot = (getInstance) => load({
        worker: '../src/workers/chatbot.worker.js',
        loaderPath: '../src/stores/ChatBotStore/ChatBot',
        name: 'ChatBot',
        extra: { getREmbeddings: vi.fn(), getEmbeddings: vi.fn(), chat: vi.fn(), rChat: vi.fn(), rStreamingChat: vi.fn(), streamingChat: vi.fn() },
        getInstance,
    });

    beforeEach(() => {
        posted = [];
        vi.spyOn(self, 'postMessage').mockImplementation((m) => { posted.push(m); });
    });
    afterEach(() => {
        vi.doUnmock('../src/stores/KokoroStore/Kokoro');
        vi.doUnmock('../src/stores/ChatBotStore/ChatBot');
        vi.doUnmock('kokoro-js');
    });

    describe('kokoro', () => {
        it('once, after the whole model is loaded, not after every file', async () => {
            await kokoro(async (cb) => download(cb));
            expect(types().filter((t) => t === READY)).toHaveLength(1);
            const lastProgress = types().lastIndexOf('updateProgressBar', types().length - 2);
            expect(types().indexOf(READY)).toBeGreaterThan(lastProgress - 1);
            // the only thing after the ready signal is the modal being told to close
            expect(posted.slice(types().indexOf(READY) + 1).map((m) => m.event?.status)).toEqual(['finish']);
        });

        it('not at all when the load fails', async () => {
            await kokoro(async (cb) => { download(cb); throw new Error('boom'); });
            expect(types()).not.toContain(READY);
            expect(types()).toContain('error');
        });
    });

    describe('chatbot (pipeline() reports "ready" itself)', () => {
        it('once, when the pipeline is ready', async () => {
            await chatbot(async (cb) => { download(cb); cb({ status: 'ready' }); });
            expect(types().filter((t) => t === READY)).toHaveLength(1);
        });

        it('not at all when the load fails', async () => {
            await chatbot(async (cb) => { download(cb); throw new Error('boom'); });
            expect(types()).not.toContain(READY);
        });
    });
});
