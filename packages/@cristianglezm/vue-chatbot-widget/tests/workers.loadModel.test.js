import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const MODAL = 'ChatBotWidget#requestMultiProgressBar';
const OPTIONS = { host: 'h', model: 'm', device: 'CPU', dtype: 'q4', voice: 'af_bella' };

// The workers register `self.onmessage` when they are imported, so each test imports a fresh copy
// with the model loader mocked: `getInstance(cb)` replays what transformers.js reports through `cb`.
const workers = {
    chatbot: {
        file: '../src/workers/chatbot.worker.js',
        mock: ['../src/stores/ChatBotStore/ChatBot', 'ChatBot'],
        extra: { getREmbeddings: vi.fn(), getEmbeddings: vi.fn(), chat: vi.fn(), rChat: vi.fn(), rStreamingChat: vi.fn(), streamingChat: vi.fn() },
    },
    kokoro: {
        file: '../src/workers/kokoro.worker.js',
        mock: ['../src/stores/KokoroStore/Kokoro', 'Kokoro'],
        extra: { audioGen: vi.fn(), rAudioGen: vi.fn(), streamingAudioGen: vi.fn() },
    },
};

describe.each(Object.keys(workers))('%s worker: loadModel', (name) => {
    const w = workers[name];
    let loader, posted;
    const progressEvents = () => posted.filter(m => m.jobType === 'updateProgressBar').map(m => m.event);
    const load = async (getInstance) => {
        vi.resetModules();
        loader = { modelOptions: { ...OPTIONS }, reset: vi.fn(), setModelOptions: vi.fn(), getInstance: vi.fn(getInstance) };
        vi.doMock(w.mock[0], () => ({ [w.mock[1]]: loader, ...w.extra }));
        vi.doMock('kokoro-js', () => ({ TextSplitterStream: class {} }));
        await import(w.file);
        await self.onmessage({ data: { jobType: 'loadModel', modelOptions: OPTIONS } });
    };

    beforeEach(() => {
        posted = [];
        vi.spyOn(self, 'postMessage').mockImplementation((m) => { posted.push(m); });
    });
    afterEach(() => { vi.doUnmock(w.mock[0]); vi.doUnmock('kokoro-js'); });

    it('forwards the download progress to the modal, then tells it it is finished', async () => {
        await load(async (cb) => {
            cb({ status: 'initiate', file: 'model.onnx' });
            cb({ status: 'progress', file: 'model.onnx', progress: 50 });
            cb({ status: 'progress', file: 'model.onnx', progress: 100 });
        });
        expect(progressEvents()).toEqual([
            { status: 'init', name: 'model.onnx', progress: 0, total: 100 },
            { status: 'update', name: 'model.onnx', progress: 50 },
            { status: 'update', name: 'model.onnx', progress: 100 },
            { status: 'finish' },
        ]);
        expect(posted.filter(m => m.eventName === MODAL)).toHaveLength(4);
    });

    it('a failed load reports the error and still closes the modal', async () => {
        await load(async (cb) => {
            cb({ status: 'initiate', file: 'model.onnx' });
            throw new Error('network down');
        });
        expect(posted.find(m => m.jobType === 'error')?.error.message).toBe('network down');
        expect(progressEvents().at(-1)).toEqual({ status: 'finish' });
    });
});
