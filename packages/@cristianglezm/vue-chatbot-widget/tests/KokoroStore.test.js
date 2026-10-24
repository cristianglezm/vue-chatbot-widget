import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { freshStores } from './helpers/freshStores';
import { FakeWorker } from './helpers/FakeWorker';
import {
    STORAGE_KEY_KOKORO_MODEL_OPTIONS,
    STORAGE_KEY_KOKORO_REMOTE_OPTIONS,
    STORAGE_KEY_KOKORO_IS_LOCAL,
    hashText,
} from '../src/stores/KokoroStore';

// RawAudio remembers what it was built with, the merged audio is checked through it
vi.mock('@huggingface/transformers', () => ({
    RawAudio: class RawAudio {
        constructor(audio, samplingRate) { RawAudio.last = { audio, samplingRate }; }
        toBlob() { return new Blob(['wav']); }
    },
}));

const setup = async () => {
    const m = await freshStores();
    const store = m.useKokoroStore();
    const worker = new FakeWorker();
    store.registerWorker(() => worker);
    store.wm.ensureWorker('kokoro');
    const events = [];
    ['ChatBotWidget#audioResp', 'ChatBotWidget#AudioChunk', 'ChatBotWidget#AudioChunkDone', 'ChatBotWidget#ToEmitter']
        .forEach((name) => store.channel.on(name, (payload) => events.push([name, payload])));
    const emitted = (name) => events.filter(([n]) => n === name).map(([, p]) => p);
    return { store, worker, m, emitted };
};

describe('KokoroStore: saved options (localStorage)', () => {
    it('uses the defaults when nothing is saved', async () => {
        const { store } = await setup();
        expect(store.isLocal).toBe(true);
        expect(store.modelOptions).toMatchObject({ model: 'onnx-community/Kokoro-82M-v1.0-ONNX', device: 'CPU', dtype: 'q8', voice: 'af_bella' });
        expect(store.remoteOptions).toMatchObject({ url: 'http://localhost:8880', model: 'kokoro', voice: 'af_bella' });
    });

    it('reads what was saved, when the store is created', async () => {
        localStorage.setItem(STORAGE_KEY_KOKORO_IS_LOCAL, 'false');
        localStorage.setItem(STORAGE_KEY_KOKORO_MODEL_OPTIONS, JSON.stringify({ host: 'x', model: 'm', device: 'GPU', dtype: 'fp16', voice: 'am_adam' }));
        localStorage.setItem(STORAGE_KEY_KOKORO_REMOTE_OPTIONS, JSON.stringify({ url: 'http://srv' }));
        const { store } = await setup();
        expect(store.isLocal).toBe(false);
        expect(store.modelOptions.voice).toBe('am_adam');
        expect(store.remoteOptions.url).toBe('http://srv');
    });

    it('save* write them, and the next store reads them back', async () => {
        const first = await setup();
        first.store.isLocal = false;
        first.store.modelOptions.voice = 'am_adam';
        first.store.remoteOptions.url = 'http://other';
        await first.store.saveIsLocal();
        await first.store.saveModelOptions();
        await first.store.saveRemoteOptions();

        const second = await setup();
        expect(second.store.isLocal).toBe(false);
        expect(second.store.modelOptions.voice).toBe('am_adam');
        expect(second.store.remoteOptions.url).toBe('http://other');
    });

    it('hasModelOptionsChanged compares host, model, device, dtype and voice with the last requested load', async () => {
        const { store } = await setup();
        expect(store.hasModelOptionsChanged).toBe(true);
        await store.requestModelLoad();
        expect(store.hasModelOptionsChanged).toBe(false);
        for(const [field, value] of [['host', 'localhost'], ['model', 'x/y'], ['device', 'GPU'], ['dtype', 'fp16'], ['voice', 'am_adam']]){
            const before = store.modelOptions[field];
            store.modelOptions[field] = value;
            expect(store.hasModelOptionsChanged, field).toBe(true);
            store.modelOptions[field] = before;
            expect(store.hasModelOptionsChanged, field).toBe(false);
        }
    });

    it.todo('starts with the defaults when the saved value is corrupt');
});

describe('KokoroStore: the audio cache', () => {
    it('hashText is the SHA-256 of the text', async () => {
        expect(await hashText('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('keeps the audio of a text, found again by the same text', async () => {
        const { store } = await setup();
        await store.addAudio('hello', 'blob:1');
        expect(await store.getAudio('hello')).toBe('blob:1');
        expect(await store.getAudio('other')).toBeUndefined();
    });

    it('is keyed by the hash, not by the text', async () => {
        const { store } = await setup();
        await store.addAudio('hello', 'blob:1');
        expect([...store.getAudios.keys()]).toEqual([await hashText('hello')]);
    });

    it('the audio of a text can be replaced', async () => {
        const { store } = await setup();
        await store.addAudio('hello', 'blob:1');
        await store.addAudio('hello', 'blob:2');
        expect(await store.getAudio('hello')).toBe('blob:2');
        expect(store.getAudios.size).toBe(1);
    });

    it('clearAudios forgets all of them', async () => {
        const { store } = await setup();
        await store.addAudio('a', 'blob:1');
        await store.addAudio('b', 'blob:2');
        await store.clearAudios();
        expect(store.getAudios.size).toBe(0);
    });

    // crypto.subtle only exists in secure contexts (https, localhost), the widget has to work on http too
    describe('on a page without crypto.subtle (plain http)', () => {
        beforeEach(() => vi.stubGlobal('crypto', {}));

        it('the audio is still kept and found', async () => {
            const { store } = await setup();
            await store.addAudio('hello', 'blob:1');
            expect(await store.getAudio('hello')).toBe('blob:1');
            expect(await store.getAudio('other')).toBeUndefined();
        });
    });
});

describe('KokoroStore: what is sent to the worker', () => {
    it.each([
        ['audioGen', 'requestAudioGen', 'audioGen'],
        ['streaming audio', 'requestStreamingAudioGen', 'streamingAudio'],
    ])('%s, local: only once the model is loaded', async (_name, action, jobType) => {
        const { store, worker } = await setup();
        await store[action]('hi');
        expect(worker.posted).toEqual([]);
        store.isModelLoaded = true;
        await store[action]('hi');
        expect(worker.posted).toEqual([{ jobType, text: 'hi' }]);
    });

    it.each([
        ['requestAudioGen', 'rAudioGen'],
        ['requestStreamingAudioGen', 'rStreamingAudio'],
    ])('%s, remote: asks the server, there is nothing to load', async (action, jobType) => {
        const { store, worker } = await setup();
        store.isLocal = false;
        await store[action]('hi');
        expect(worker.posted).toEqual([{ jobType, text: 'hi', remoteOptions: store.remoteOptions }]);
    });

    it('reset: only local models have something to reset', async () => {
        const { store, worker } = await setup();
        store.isModelLoaded = true;
        await store.requestReset();
        expect(worker.posted).toEqual([{ jobType: 'reset' }]);
        expect(store.isModelLoaded).toBe(false);
        store.isLocal = false;
        store.isModelLoaded = true;
        await store.requestReset();
        expect(worker.posted).toHaveLength(1);
        expect(store.isModelLoaded).toBe(true);
    });
});

describe('KokoroStore: audio from the worker', () => {
    it('an audio response is kept and announced', async () => {
        const { store, worker, emitted } = await setup();
        worker.reply({ jobType: 'audioResp', text: 'hi', audio: 'blob:1' });
        expect(emitted('ChatBotWidget#audioResp')).toEqual([{ audio: 'blob:1', text: 'hi' }]);
        await vi.waitFor(async () => expect(await store.getAudio('hi')).toBe('blob:1'));
    });

    it('streaming chunks are held and announced as they come', async () => {
        const { store, worker, emitted } = await setup();
        worker.reply({ jobType: 'streamingAudioChunk', text: 'hi', audio: 'blob:1' });
        worker.reply({ jobType: 'streamingAudioChunk', text: 'there', audio: 'blob:2' });
        expect(store.pendingChunks).toEqual([{ text: 'hi', audio: 'blob:1' }, { text: 'there', audio: 'blob:2' }]);
        expect(emitted('ChatBotWidget#AudioChunk')).toEqual([{ audio: 'blob:1', text: 'hi' }, { audio: 'blob:2', text: 'there' }]);
    });
});

describe('KokoroStore: merging the streamed chunks into one audio', () => {
    let decoded, contexts, RawAudio;
    const chunk = (samples, sampleRate = 24000) => ({ getChannelData: () => Float32Array.from(samples), sampleRate });

    beforeEach(async () => {
        decoded = [];
        contexts = [];
        ({ RawAudio } = await import('@huggingface/transformers'));
        RawAudio.last = undefined;
        vi.stubGlobal('fetch', vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })));
        vi.stubGlobal('AudioContext', class {
            constructor() { contexts.push(this); this.close = vi.fn(async () => {}); }
            async decodeAudioData() {
                const next = decoded.shift();
                if(next instanceof Error) throw next;
                return next;
            }
        });
        URL.createObjectURL = vi.fn(() => 'blob:merged');
    });
    afterEach(() => { delete URL.createObjectURL; });

    const stream = (worker, ...urls) => urls.forEach((audio) => worker.reply({ jobType: 'streamingAudioChunk', text: 't', audio }));

    it('one audio with the samples of all the chunks, in order, kept under the text', async () => {
        const { store, worker } = await setup();
        decoded.push(chunk([0.1, 0.2]), chunk([0.3]), chunk([0.4, 0.5], 22050));
        stream(worker, 'blob:1', 'blob:2', 'blob:3');
        await store._mergePendingChunks('the text');

        expect(Array.from(RawAudio.last.audio)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5].map(Math.fround));
        expect(RawAudio.last.samplingRate).toBe(22050);
        expect(await store.getAudio('the text')).toBe('blob:merged');
        expect(store.pendingChunks).toEqual([]);
    });

    it('reads every chunk by its url', async () => {
        const { store, worker } = await setup();
        decoded.push(chunk([1]), chunk([2]));
        stream(worker, 'blob:1', 'blob:2');
        await store._mergePendingChunks('t');
        expect(fetch.mock.calls.map((c) => c[0])).toEqual(['blob:1', 'blob:2']);
    });

    it('long chunks are merged too (no limit on the size of a chunk)', async () => {
        const { store, worker } = await setup();
        decoded.push(chunk(new Array(250_000).fill(0.5)));
        stream(worker, 'blob:1');
        await store._mergePendingChunks('t');
        expect(RawAudio.last.audio).toHaveLength(250_000);
    });

    it('nothing pending: nothing is read nor stored', async () => {
        const { store } = await setup();
        await store._mergePendingChunks('t');
        expect(fetch).not.toHaveBeenCalled();
        expect(store.getAudios.size).toBe(0);
    });

    // an AudioContext per chunk, never closed: browsers only allow a few open at a time
    it('decodes with one AudioContext, and closes it', async () => {
        const { store, worker } = await setup();
        decoded.push(chunk([1]), chunk([2]), chunk([3]));
        stream(worker, 'blob:1', 'blob:2', 'blob:3');
        await store._mergePendingChunks('t');
        expect(contexts).toHaveLength(1);
        expect(contexts[0].close).toHaveBeenCalledOnce();
    });

    // after a failure the old chunks stayed and were merged into the next audio
    it('a failure forgets the chunks, stores nothing and closes the AudioContext', async () => {
        const { store, worker } = await setup();
        decoded.push(chunk([1]), new Error('bad data'));
        stream(worker, 'blob:1', 'blob:2');
        await expect(store._mergePendingChunks('t')).rejects.toThrow('bad data');
        expect(store.pendingChunks).toEqual([]);
        expect(store.getAudios.size).toBe(0);
        expect(contexts[0].close).toHaveBeenCalled();
    });

    it('when the stream is done: merges, announces it, and the audio is there', async () => {
        const { store, worker, emitted } = await setup();
        decoded.push(chunk([1]), chunk([2]));
        stream(worker, 'blob:1', 'blob:2');
        worker.reply({ jobType: 'streamingAudioChunk#done', text: 'the text' });
        await vi.waitFor(() => expect(emitted('ChatBotWidget#AudioChunkDone')).toHaveLength(1));
        expect(await store.getAudio('the text')).toBe('blob:merged');
    });

    it('when the merge fails: the error is reported, the stream still ends, nothing is left over', async () => {
        const { store, worker, m, emitted } = await setup();
        decoded.push(new Error('bad data'));
        stream(worker, 'blob:1');
        worker.reply({ jobType: 'streamingAudioChunk#done', text: 'the text' });
        await vi.waitFor(() => expect(emitted('ChatBotWidget#AudioChunkDone')).toHaveLength(1));
        expect(m.useErrorStore().getErrors).toHaveLength(1);
        expect(String(m.useErrorStore().getErrors[0])).toContain('bad data');
        expect(store.pendingChunks).toEqual([]);
    });
});

describe('KokoroStore: errors', () => {
    // the widget is busy until the audio or the end of the stream comes: an error has to end it
    it.each([
        ['an error of a job', (worker) => worker.reply({ jobType: 'error', error: 'boom' })],
        ['an error of the worker', (worker) => worker.fail('boom', 'kokoro.worker.js', 1)],
    ])('%s is reported, ends the audio and forgets the chunks of the stream', async (_name, fail) => {
        const { store, worker, m, emitted } = await setup();
        worker.reply({ jobType: 'streamingAudioChunk', text: 'hi', audio: 'blob:1' });
        fail(worker);
        expect(m.useErrorStore().getErrors).toHaveLength(1);
        expect(emitted('ChatBotWidget#AudioChunkDone')).toHaveLength(1);
        expect(store.pendingChunks).toEqual([]);
    });
});
