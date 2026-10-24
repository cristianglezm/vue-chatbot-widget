import { describe, it, expect, vi, beforeEach } from 'vitest';
import { freshStores } from './helpers/freshStores';
import { FakeWorker } from './helpers/FakeWorker';

vi.mock('@huggingface/transformers', () => ({ RawAudio: class RawAudio{} }));

// the store as the widget uses it: a worker that answers, a channel the widget listens to
const setup = async () => {
    const m = await freshStores();
    const store = m.useChatBotStore();
    const worker = new FakeWorker();
    store.registerWorker(() => worker);
    store.wm.ensureWorker('chatbot'); // spawn it so it can talk
    const events = [];
    const listen = (name) => store.channel.on(name, (payload) => events.push([name, payload]));
    ['ChatBotWidget#ConfirmModal', 'ChatBotWidget#stream', 'ChatBotWidget#done', 'ChatBotWidget#ToEmitter',
        'ChatBotWidget#userEmbeddings', 'ChatBotWidget#documentEmbeddings', 'ChatBotWidget#toolEmbeddings'].forEach(listen);
    const emitted = (name) => events.filter(([n]) => n === name).map(([, p]) => p);
    return { store, worker, m, emitted };
};

const localReply = (content) => ({
    jobType: 'response',
    response: [{ generated_text: [{ role: 'user', content: 'question' }, { role: 'assistant', content }] }],
});
const contents = (store) => store.chatHistory.map((m) => [m.role, m.content]);

describe('ChatBotStore: replies from the worker', () => {
    beforeEach(() => localStorage.clear());

    it('a local model replies with the last message of its generated text', async () => {
        const { store, worker } = await setup();
        worker.reply(localReply('hello'));
        expect(contents(store)).toEqual([['assistant', 'hello']]);
    });

    it('a remote server replies with a plain string', async () => {
        const { store, worker } = await setup();
        store.isLocal = false;
        worker.reply({ jobType: 'response', response: 'hello' });
        expect(contents(store)).toEqual([['assistant', 'hello']]);
    });

    it('the executor gets the text of the model', async () => {
        const { store, worker } = await setup();
        store.executor = vi.fn(() => ({ textForUser: [], infoForUser: [], commandsToConfirm: [] }));
        worker.reply(localReply('do it'));
        expect(store.executor).toHaveBeenCalledWith('do it');
    });

    it('shows what the executor says: text as the assistant, info as info, commands to confirm in the modal', async () => {
        const { store, worker, emitted } = await setup();
        store.executor = () => ({ textForUser: ['a', 'b'], infoForUser: ['i1', 'i2'], commandsToConfirm: ['rm', 'ls'] });
        worker.reply(localReply('x'));
        expect(contents(store)).toEqual([['assistant', 'a\nb'], ['info', 'i1\ni2']]);
        expect(emitted('ChatBotWidget#ConfirmModal')).toEqual(['rm', 'ls']);
    });

    it('only info: no assistant message', async () => {
        const { store, worker } = await setup();
        store.executor = () => ({ textForUser: [], infoForUser: ['ran it'], commandsToConfirm: [] });
        worker.reply(localReply('x'));
        expect(contents(store)).toEqual([['info', 'ran it']]);
    });

    it('nothing to show: no message at all', async () => {
        const { store, worker } = await setup();
        store.executor = () => ({ textForUser: [], infoForUser: [], commandsToConfirm: [] });
        worker.reply(localReply('x'));
        expect(store.chatHistory).toEqual([]);
    });

    // B10: text was built as "" + "\n" + msg, so every message started with a newline (the bubble is pre-wrap)
    it('the message is the text, without a newline in front', async () => {
        const { store, worker } = await setup();
        worker.reply(localReply('hello'));
        expect(store.getLastMessage().content).toBe('hello');
    });

    it('an executor that only had a tool call to run (empty text) does not add an empty bubble', async () => {
        const { store, worker } = await setup();
        store.executor = () => ({ textForUser: [''], infoForUser: [], commandsToConfirm: ['cmd'] });
        worker.reply(localReply('<tool_call>'));
        expect(store.chatHistory).toEqual([]);
    });

    // B9: the handler did result.infoForUser.values(), an executor that left a field out crashed it
    it.each([
        ['without infoForUser', { textForUser: ['x'], commandsToConfirm: [] }, [['assistant', 'x']]],
        ['without commandsToConfirm', { textForUser: ['x'], infoForUser: [] }, [['assistant', 'x']]],
        ['without textForUser', { infoForUser: ['i'] }, [['info', 'i']]],
        ['returning {}', {}, []],
        ['returning nothing', undefined, []],
    ])('an executor %s does not break the handler', async (_name, result, expected) => {
        const { store, worker } = await setup();
        store.executor = () => result;
        expect(() => worker.reply(localReply('x'))).not.toThrow();
        expect(contents(store)).toEqual(expected);
    });

    it('the default executor (store used without the widget) shows the text as it is', async () => {
        const { store, worker } = await setup();
        worker.reply(localReply('hello'));
        expect(contents(store)).toEqual([['assistant', 'hello']]);
    });
});

describe('ChatBotStore: the rest of the worker messages', () => {
    beforeEach(() => localStorage.clear());

    it('streaming: the text goes to the widget as it comes', async () => {
        const { worker, emitted } = await setup();
        worker.reply({ jobType: 'streaming', response: 'tok' });
        worker.reply({ jobType: 'streaming', response: 'en' });
        expect(emitted('ChatBotWidget#stream')).toEqual(['tok', 'en']);
    });

    it('done is passed on to the widget', async () => {
        const { worker, emitted } = await setup();
        worker.reply({ jobType: 'done' });
        expect(emitted('ChatBotWidget#done')).toHaveLength(1);
    });

    it.each([
        ['user', 'ChatBotWidget#userEmbeddings'],
        ['document', 'ChatBotWidget#documentEmbeddings'],
        ['tool', 'ChatBotWidget#toolEmbeddings'],
    ])('embeddings of a %s go to %s', async (type, event) => {
        const { worker, emitted } = await setup();
        worker.reply({ jobType: 'embeddings', type, text: 't', embeddings: [1, 2] });
        expect(emitted(event)).toEqual([{ text: 't', embeddings: [1, 2] }]);
    });

    it('updateBtnTitle marks the model as loaded and tells the emitter', async () => {
        const { store, worker, emitted } = await setup();
        const data = { jobType: 'updateBtnTitle', eventName: 'ChatBotModelOptions#updateBtnTitle', event: '' };
        worker.reply(data);
        expect(store.isModelLoaded).toBe(true);
        expect(emitted('ChatBotWidget#ToEmitter')).toEqual([data]);
    });

    it('updateProgressBar goes to the emitter', async () => {
        const { worker, emitted } = await setup();
        const data = { jobType: 'updateProgressBar', eventName: 'x#y', event: { status: 'init' } };
        worker.reply(data);
        expect(emitted('ChatBotWidget#ToEmitter')).toEqual([data]);
    });

    it('an error goes to the ErrorStore and ends the pending message', async () => {
        const { m, worker, emitted } = await setup();
        worker.reply({ jobType: 'error', error: 'boom' });
        expect(m.useErrorStore().getErrors).toEqual(['boom']);
        expect(emitted('ChatBotWidget#done')).toHaveLength(1);
    });
});
