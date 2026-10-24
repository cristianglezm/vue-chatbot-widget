import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const OPTIONS = { host: 'huggingface', model: 'org/model', device: 'CPU', dtype: 'q4', voice: 'af_bella' };
const messages = [{ role: 'user', content: 'hi' }];
const remoteOptions = { url: 'http://srv', api_key: 'k', model: 'm' };

// stands in for kokoro-js's TextSplitterStream: yields what was pushed, one sentence at a time
class FakeSplitter {
    push(text) { this.text = text; }
    close() { this.closed = true; }
    async *[Symbol.asyncIterator]() { for(const part of this.text.split('. ')) { yield part; } }
}

const boom = new Error('boom');

// The workers register `self.onmessage` when imported, each test gets a fresh copy with the loader functions mocked.
const harness = (name, loaderPath, file) => {
    let posted, fns, loader;
    const setup = async (functions) => {
        vi.resetModules();
        fns = functions;
        loader = { modelOptions: { ...OPTIONS }, reset: vi.fn(), setModelOptions: vi.fn(), getInstance: vi.fn(async () => ({})) };
        vi.doMock(loaderPath, () => ({ [name]: loader, ...functions }));
        vi.doMock('kokoro-js', () => ({ TextSplitterStream: FakeSplitter }));
        await import(file);
    };
    return {
        setup,
        get posted() { return posted; },
        get loader() { return loader; },
        fns: () => fns,
        run: (data) => self.onmessage({ data }),
        types: () => posted.map((m) => m.jobType),
        record: () => {
            posted = [];
            vi.spyOn(self, 'postMessage').mockImplementation((m) => { posted.push(m); });
        },
        unmock: () => { vi.doUnmock(loaderPath); vi.doUnmock('kokoro-js'); },
    };
};

describe('the chatbot worker: its jobs', () => {
    const w = harness('ChatBot', '../src/stores/ChatBotStore/ChatBot', '../src/workers/chatbot.worker.js');
    const functions = () => ({
        chat: vi.fn(async () => [{ generated_text: 'chat' }]),
        rChat: vi.fn(async () => 'remote chat'),
        streamingChat: vi.fn(async (_m, callback) => { callback('a'); callback('b'); return [{ generated_text: 'ab' }]; }),
        rStreamingChat: vi.fn(async (_m, callback) => { callback('x'); callback('y'); return 'xy'; }),
        getEmbeddings: vi.fn(async (text) => [text.length]),
        getREmbeddings: vi.fn(async (text) => [text.length, 0]),
    });
    const extra = { tools: [{ name: 't' }], documents: ['d'], chat_template: 'tpl' };

    beforeEach(async () => { w.record(); await w.setup(functions()); });
    afterEach(() => w.unmock());

    it('chat: the answer, then done', async () => {
        await w.run({ jobType: 'chat', messages, ...extra });
        expect(w.fns().chat).toHaveBeenCalledWith(messages, extra);
        expect(w.posted).toEqual([{ jobType: 'response', response: [{ generated_text: 'chat' }] }, { jobType: 'done' }]);
    });

    it('rChat: asks the server of the options', async () => {
        await w.run({ jobType: 'rChat', messages, remoteOptions, ...extra });
        expect(w.fns().rChat).toHaveBeenCalledWith(messages, remoteOptions, extra);
        expect(w.posted).toEqual([{ jobType: 'response', response: 'remote chat' }, { jobType: 'done' }]);
    });

    it('streaming: every piece as it comes, then the whole answer, then done', async () => {
        await w.run({ jobType: 'streaming', messages, ...extra });
        expect(w.fns().streamingChat).toHaveBeenCalledWith(messages, expect.any(Function), extra);
        expect(w.posted).toEqual([
            { jobType: 'streaming', response: 'a' }, { jobType: 'streaming', response: 'b' },
            { jobType: 'response', response: [{ generated_text: 'ab' }] }, { jobType: 'done' },
        ]);
    });

    it('rStreaming: the same against a server', async () => {
        await w.run({ jobType: 'rStreaming', messages, remoteOptions, ...extra });
        expect(w.fns().rStreamingChat).toHaveBeenCalledWith(messages, expect.any(Function), remoteOptions, extra);
        expect(w.posted).toEqual([
            { jobType: 'streaming', response: 'x' }, { jobType: 'streaming', response: 'y' },
            { jobType: 'response', response: 'xy' }, { jobType: 'done' },
        ]);
    });

    it('embeddings: one message per text, in order, with the type that was asked', async () => {
        await w.run({ jobType: 'embeddings', type: 'tool', texts: ['a', 'bb'] });
        expect(w.posted).toEqual([
            { jobType: 'embeddings', type: 'tool', text: 'a', embeddings: [1] },
            { jobType: 'embeddings', type: 'tool', text: 'bb', embeddings: [2] },
        ]);
    });

    it('rEmbeddings: the same against a server', async () => {
        await w.run({ jobType: 'rEmbeddings', type: 'user', texts: ['abc'], remoteOptions });
        expect(w.fns().getREmbeddings).toHaveBeenCalledWith('abc', remoteOptions);
        expect(w.posted).toEqual([{ jobType: 'embeddings', type: 'user', text: 'abc', embeddings: [3, 0] }]);
    });

    it('an empty list of texts is no message', async () => {
        await w.run({ jobType: 'embeddings', type: 'document', texts: [] });
        expect(w.posted).toEqual([]);
    });

    it('reset resets the model', async () => {
        await w.run({ jobType: 'reset' });
        expect(w.loader.reset).toHaveBeenCalledOnce();
    });

    it('a job it does not know is ignored', async () => {
        await expect(w.run({ jobType: 'nothing' })).resolves.toBeUndefined();
        expect(w.posted).toEqual([]);
    });

    it.each([
        ['chat', { messages }, 'chat'],
        ['rChat', { messages, remoteOptions }, 'rChat'],
        ['streaming', { messages }, 'streamingChat'],
        ['rStreaming', { messages, remoteOptions }, 'rStreamingChat'],
        ['embeddings', { type: 't', texts: ['a'] }, 'getEmbeddings'],
        ['rEmbeddings', { type: 't', texts: ['a'], remoteOptions }, 'getREmbeddings'],
    ])('%s: a failure is reported as an error, and nothing else', async (jobType, data, fn) => {
        w.fns()[fn].mockRejectedValue(boom);
        await w.run({ jobType, ...data });
        expect(w.posted).toEqual([{ jobType: 'error', error: boom }]);
    });

    it('reset: a failure is reported as an error', async () => {
        w.loader.reset.mockRejectedValue(boom);
        await w.run({ jobType: 'reset' });
        expect(w.posted).toEqual([{ jobType: 'error', error: boom }]);
    });
});

describe('the speech worker: its jobs', () => {
    const w = harness('Kokoro', '../src/stores/KokoroStore/Kokoro', '../src/workers/kokoro.worker.js');
    const wav = (name) => ({ toBlob: vi.fn(async () => name) });
    // what kokoro-js streams: { text, phonemes, audio }
    const stream = (...chunks) => async function* () { yield* chunks; };
    const fakeStream = (chunks, fail) => (async function* () {
        for(const c of chunks) { yield { text: c, audio: { toBlob: () => `blob of ${c}` } }; }
        if(fail) { throw boom; }
    })();
    const functions = () => ({
        audioGen: vi.fn(async () => wav('whole audio')),
        rAudioGen: vi.fn(async (text) => `remote blob of ${text}`),
        // as the real one: it hands the splitter and the stream to the callback
        streamingAudioGen: vi.fn(async (callback) => callback({ push: vi.fn(), close: vi.fn() }, fakeStream(['one', 'two']))),
    });

    beforeEach(async () => {
        vi.useFakeTimers();
        let n = 0;
        URL.createObjectURL = vi.fn((blob) => `blob:${++n}:${blob}`);
        w.record();
        await w.setup(functions());
    });
    afterEach(() => { w.unmock(); delete URL.createObjectURL; });

    it('audioGen: one audio for the whole text', async () => {
        await w.run({ jobType: 'audioGen', text: 'hello' });
        expect(w.fns().audioGen).toHaveBeenCalledWith('hello');
        expect(w.posted).toEqual([{ jobType: 'audioResp', audio: 'blob:1:whole audio', text: 'hello' }]);
    });

    it('streamingAudio: a chunk for every piece, then that the stream is done', async () => {
        await w.run({ jobType: 'streamingAudio', text: 'one two' });
        expect(w.posted).toEqual([
            { jobType: 'streamingAudioChunk', audio: 'blob:1:blob of one', text: 'one' },
            { jobType: 'streamingAudioChunk', audio: 'blob:2:blob of two', text: 'two' },
            { jobType: 'streamingAudioChunk#done', text: 'one two' },
        ]);
    });

    it('streamingAudio: the whole text goes to the splitter and it is closed', async () => {
        const splitter = { push: vi.fn(), close: vi.fn() };
        w.fns().streamingAudioGen.mockImplementation(async (callback) => callback(splitter, fakeStream([])));
        await w.run({ jobType: 'streamingAudio', text: 'one two' });
        expect(splitter.push).toHaveBeenCalledWith('one two');
        expect(splitter.close).toHaveBeenCalledOnce();
    });

    it('rAudioGen: one audio from the server', async () => {
        await w.run({ jobType: 'rAudioGen', text: 'hello', remoteOptions });
        expect(w.fns().rAudioGen).toHaveBeenCalledWith('hello', remoteOptions);
        expect(w.posted).toEqual([{ jobType: 'audioResp', audio: 'blob:1:remote blob of hello', text: 'hello' }]);
    });

    it('rStreamingAudio: a chunk per sentence from the server, then done (after a short pause)', async () => {
        const done = w.run({ jobType: 'rStreamingAudio', text: 'First one. Second one', remoteOptions });
        await vi.advanceTimersByTimeAsync(200);
        await done;
        expect(w.fns().rAudioGen.mock.calls.map((c) => [c[0], c[1]])).toEqual([['First one', remoteOptions], ['Second one', remoteOptions]]);
        expect(w.posted).toEqual([
            { jobType: 'streamingAudioChunk', audio: 'blob:1:remote blob of First one', text: 'First one' },
            { jobType: 'streamingAudioChunk', audio: 'blob:2:remote blob of Second one', text: 'Second one' },
            { jobType: 'streamingAudioChunk#done', text: 'First one. Second one' },
        ]);
    });

    it('reset resets the model', async () => {
        await w.run({ jobType: 'reset' });
        expect(w.loader.reset).toHaveBeenCalledOnce();
    });

    it('a job it does not know is ignored', async () => {
        await expect(w.run({ jobType: 'nothing' })).resolves.toBeUndefined();
        expect(w.posted).toEqual([]);
    });

    // the four routes called the job without await inside a try/catch: a failure was nobody's, and nothing was reported
    it.each([
        ['audioGen', { text: 'hi' }, 'audioGen'],
        ['rAudioGen', { text: 'hi', remoteOptions }, 'rAudioGen'],
    ])('%s: a failure is reported as an error, and nothing else', async (jobType, data, fn) => {
        w.fns()[fn].mockRejectedValue(boom);
        await w.run({ jobType, ...data });
        expect(w.posted).toEqual([{ jobType: 'error', error: boom }]);
    });

    it('rStreamingAudio: a failure of the server is reported as an error, and the stream is not "done"', async () => {
        w.fns().rAudioGen.mockRejectedValue(boom);
        const job = w.run({ jobType: 'rStreamingAudio', text: 'First one. Second one', remoteOptions });
        await vi.advanceTimersByTimeAsync(300);
        await job;
        expect(w.types()).toEqual(['error']);
    });

    it('streamingAudio: the model failing before it streams anything is reported as an error', async () => {
        w.fns().streamingAudioGen.mockRejectedValue(boom);
        await w.run({ jobType: 'streamingAudio', text: 'hi' });
        expect(w.posted).toEqual([{ jobType: 'error', error: boom }]);
    });

    it('streamingAudio: failing halfway reports the error after the chunks that were made, and is not "done"', async () => {
        w.fns().streamingAudioGen.mockImplementation(async (callback) => callback({ push: vi.fn(), close: vi.fn() }, fakeStream(['one'], true)));
        await w.run({ jobType: 'streamingAudio', text: 'one two' });
        expect(w.types()).toEqual(['streamingAudioChunk', 'error']);
        expect(w.posted[1].error).toBe(boom);
    });
});
