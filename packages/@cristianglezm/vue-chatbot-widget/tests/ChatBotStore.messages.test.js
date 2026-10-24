import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { freshStores } from './helpers/freshStores';
import { FakeWorker } from './helpers/FakeWorker';
import {
    STORAGE_KEY_CHATBOT_MODEL_OPTIONS,
    STORAGE_KEY_CHATBOT_REMOTE_OPTIONS,
    STORAGE_KEY_CHATBOT_IS_LOCAL,
} from '../src/stores/ChatBotStore';

vi.mock('@huggingface/transformers', () => ({ RawAudio: class RawAudio{} }));

const setup = async () => {
    const m = await freshStores();
    const store = m.useChatBotStore();
    const worker = new FakeWorker();
    store.registerWorker(() => worker);
    return { store, worker, m };
};

describe('ChatBotStore: messages', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => vi.useRealTimers());

    it('starts with an empty history', async () => {
        const { store } = await setup();
        expect(store.getChatHistory).toEqual([]);
        expect(store.getLastMessage()).toBeUndefined();
    });

    it('adds messages as { id, role, content }, in order', async () => {
        const { store } = await setup();
        await store.addMessage('user', 'hello');
        await store.addMessage('assistant', 'hi');
        expect(store.getChatHistory).toEqual([
            { id: expect.any(Number), role: 'user', content: 'hello' },
            { id: expect.any(Number), role: 'assistant', content: 'hi' },
        ]);
        expect(store.getLastMessage().content).toBe('hi');
    });

    it('clearMessages empties the history', async () => {
        const { store } = await setup();
        await store.addMessage('user', 'hello');
        await store.clearMessages();
        expect(store.getChatHistory).toEqual([]);
    });

    it('ids grow with time, regenerate relies on that order', async () => {
        vi.useFakeTimers();
        const { store } = await setup();
        await store.addMessage('user', 'a');
        vi.advanceTimersByTime(5);
        await store.addMessage('assistant', 'b');
        const [a, b] = store.getChatHistory;
        expect(b.id).toBeGreaterThan(a.id);
    });

    // B7: the id was Date.now() + 1, two messages added in the same millisecond got the same id
    it('every message has its own id, even when added in the same millisecond', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
        const { store } = await setup();
        for(let i = 0; i < 50; i++){
            await store.addMessage('info', `m${i}`);
        }
        const ids = store.getChatHistory.map((m) => m.id);
        expect(new Set(ids).size).toBe(50);
        expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    });

    it('ids still follow the clock after a burst in the same millisecond', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
        const { store } = await setup();
        for(let i = 0; i < 5; i++){
            await store.addMessage('info', 'burst');
        }
        vi.advanceTimersByTime(10_000);
        await store.addMessage('user', 'later');
        const ids = store.getChatHistory.map((m) => m.id);
        expect(ids.at(-1)).toBeGreaterThanOrEqual(1_700_000_010_000);
    });
});

describe('ChatBotStore: what is sent to the worker', () => {
    beforeEach(() => localStorage.clear());
    const history = async (store) => {
        await store.addMessage('user', 'hello');
        await store.addMessage('info', 'ran a command');
        await store.addMessage('assistant', 'hi');
    };
    const extras = { chat_template: 'tpl', tools: [{ name: 't' }], documents: ['d'] };

    it('chat: messages without the info ones, plus template, tools and documents', async () => {
        const { store, worker } = await setup();
        await history(store);
        await store.requestChat(extras);
        expect(worker.posted).toHaveLength(1);
        expect(worker.posted[0]).toMatchObject({ jobType: 'chat', ...extras });
        expect(worker.posted[0].messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    });

    it('template, tools and documents default to null', async () => {
        const { store, worker } = await setup();
        await store.requestChat({});
        expect(worker.posted[0]).toMatchObject({ chat_template: null, tools: null, documents: null });
    });

    it('chat on a remote server also sends the remote options', async () => {
        const { store, worker } = await setup();
        store.isLocal = false;
        await store.requestChat({});
        expect(worker.posted[0]).toMatchObject({ jobType: 'rChat', remoteOptions: store.remoteOptions });
    });

    it('streaming: local and remote', async () => {
        const { store, worker } = await setup();
        await store.requestStreamingChat({});
        store.isLocal = false;
        await store.requestStreamingChat({});
        expect(worker.posted.map((m) => m.jobType)).toEqual(['streaming', 'rStreaming']);
        expect(worker.posted[0].remoteOptions).toBeUndefined();
        expect(worker.posted[1].remoteOptions).toBeDefined();
    });

    it('what the worker receives is a copy, changing it does not touch the history', async () => {
        const { store, worker } = await setup();
        await store.addMessage('user', 'hello');
        await store.requestChat({});
        worker.posted[0].messages[0].content = 'changed';
        expect(store.getChatHistory[0].content).toBe('hello');
    });

    it('embeddings: local and remote', async () => {
        const { store, worker } = await setup();
        await store.requestEmbeddings('user', ['a']);
        store.isLocal = false;
        await store.requestEmbeddings('tool', ['b']);
        expect(worker.posted[0]).toEqual({ jobType: 'embeddings', type: 'user', texts: ['a'] });
        expect(worker.posted[1]).toMatchObject({ jobType: 'rEmbeddings', type: 'tool', texts: ['b'], remoteOptions: expect.any(Object) });
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

    // todo: the worker also gets `id` (and `hover`, which the template writes on the message), the wire format is not defined
    it.todo('only { role, content } of each message goes to the worker');
});

describe('ChatBotStore: regenerate', () => {
    beforeEach(() => localStorage.clear());
    // ids are given so the test does not depend on the clock
    const withHistory = async () => {
        const ctx = await setup();
        ctx.store.chatHistory.push(
            { id: 1, role: 'user', content: 'u1' },
            { id: 2, role: 'info', content: 'i1' },
            { id: 3, role: 'assistant', content: 'a1' },
            { id: 4, role: 'user', content: 'u2' },
            { id: 5, role: 'assistant', content: 'a2' },
        );
        return ctx;
    };

    it('drops the message and everything after it, and asks again', async () => {
        const { store, worker } = await withHistory();
        await store.requestRegenerate(5, {});
        expect(store.chatHistory.map((m) => m.id)).toContain(4);
        expect(store.chatHistory.map((m) => m.id)).not.toContain(5);
        expect(worker.posted).toHaveLength(1);
        expect(worker.posted[0].jobType).toBe('streaming');
    });

    it('does not send the info messages to the model', async () => {
        const { store, worker } = await withHistory();
        await store.requestRegenerate(5, {});
        expect(worker.posted[0].messages.map((m) => m.content)).toEqual(['u1', 'a1', 'u2']);
    });

    // B8: the visible history was replaced by the list that is sent to the model, which has no info messages
    it('keeps the info messages that came before in the visible history', async () => {
        const { store } = await withHistory();
        await store.requestRegenerate(5, {});
        expect(store.chatHistory.map((m) => m.content)).toEqual(['u1', 'i1', 'a1', 'u2']);
    });

    it('regenerating an earlier message drops the later turns as well', async () => {
        const { store, worker } = await withHistory();
        await store.requestRegenerate(3, {});
        expect(store.chatHistory.map((m) => m.content)).toEqual(['u1', 'i1']);
        expect(worker.posted[0].messages.map((m) => m.content)).toEqual(['u1']);
    });

    it('remote server: rStreaming with the remote options, template, tools and documents', async () => {
        const { store, worker } = await withHistory();
        store.isLocal = false;
        await store.requestRegenerate(5, { chat_template: 'tpl', tools: [1], documents: [2] });
        expect(worker.posted[0]).toMatchObject({ jobType: 'rStreaming', chat_template: 'tpl', tools: [1], documents: [2] });
        expect(worker.posted[0].remoteOptions).toBeDefined();
    });
});

describe('ChatBotStore: saved options (localStorage)', () => {
    beforeEach(() => localStorage.clear());

    it('uses the defaults when nothing is saved', async () => {
        const { store } = await setup();
        expect(store.isLocal).toBe(true);
        expect(store.modelOptions).toMatchObject({ model: 'HuggingFaceTB/SmolLM2-135M-Instruct', device: 'CPU', dtype: 'q4' });
        expect(store.remoteOptions).toMatchObject({ url: 'http://localhost:8080', max_tokens: 256 });
    });

    it('reads what was saved, when the store is created', async () => {
        localStorage.setItem(STORAGE_KEY_CHATBOT_IS_LOCAL, 'false');
        localStorage.setItem(STORAGE_KEY_CHATBOT_MODEL_OPTIONS, JSON.stringify({ host: 'x', model: 'm', device: 'GPU', dtype: 'fp16' }));
        localStorage.setItem(STORAGE_KEY_CHATBOT_REMOTE_OPTIONS, JSON.stringify({ url: 'http://srv' }));
        const { store } = await setup();
        expect(store.isLocal).toBe(false);
        expect(store.modelOptions.model).toBe('m');
        expect(store.remoteOptions.url).toBe('http://srv');
    });

    it('save* write them, and the next store reads them back', async () => {
        const first = await setup();
        first.store.isLocal = false;
        first.store.modelOptions.dtype = 'fp16';
        first.store.remoteOptions.url = 'http://other';
        await first.store.saveIsLocal();
        await first.store.saveModelOptions();
        await first.store.saveRemoteOptions();

        const second = await setup();
        expect(second.store.isLocal).toBe(false);
        expect(second.store.modelOptions.dtype).toBe('fp16');
        expect(second.store.remoteOptions.url).toBe('http://other');
    });

    it('nothing is saved until save* is called', async () => {
        const { store } = await setup();
        store.modelOptions.dtype = 'fp16';
        expect(localStorage.getItem(STORAGE_KEY_CHATBOT_MODEL_OPTIONS)).toBeNull();
    });

    it('hasModelOptionsChanged compares host, model, device and dtype with the last requested load', async () => {
        const { store } = await setup();
        expect(store.hasModelOptionsChanged).toBe(true); // nothing was loaded yet
        await store.requestModelLoad();
        expect(store.hasModelOptionsChanged).toBe(false);
        for(const [field, value] of [['host', 'localhost'], ['model', 'x/y'], ['device', 'GPU'], ['dtype', 'fp16']]){
            const before = store.modelOptions[field];
            store.modelOptions[field] = value;
            expect(store.hasModelOptionsChanged, field).toBe(true);
            store.modelOptions[field] = before;
            expect(store.hasModelOptionsChanged, field).toBe(false);
        }
    });

    // todo: JSON.parse runs while the store is created, a corrupt value breaks the whole widget until the storage is cleared
    it.todo('starts with the defaults when the saved value is corrupt');
});
