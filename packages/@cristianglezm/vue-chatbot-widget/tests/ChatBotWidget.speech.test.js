import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { useWidgetHarness } from './helpers/widgetHarness';

vi.mock('@huggingface/transformers', () => ({
    pipeline: vi.fn(), env: {}, TextStreamer: class {}, mean_pooling: vi.fn(), RawAudio: class {},
}));
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: vi.fn() }, TextSplitterStream: class {} }));

const AUDIO_CHUNK = 'ChatBotWidget#AudioChunk';
const AUDIO_CHUNK_DONE = 'ChatBotWidget#AudioChunkDone';
const AUDIO_RESP = 'ChatBotWidget#audioResp';

describe('ChatBotWidget: speech, audio and regenerate', () => {
    const h = useWidgetHarness();

    // an audio element that behaves like the browsers': paused is false as soon as play() is called,
    // the time does not move until the audio starts, and it is paused again when it ends
    const audioElement = (wrapper) => {
        const el = wrapper.find('audio').element;
        let paused = true;
        Object.defineProperty(el, 'paused', { get: () => paused, configurable: true });
        el.play = vi.fn(async () => { paused = false; });
        el.endPlayback = () => {
            paused = true;
            el.dispatchEvent(new Event('ended'));
        };
        return el;
    };
    const src = (el) => el.getAttribute('src');
    const chunk = (n) => h.kokoroStore.channel.emit(AUDIO_CHUNK, { audio: `blob:${n}`, text: `chunk ${n}` });
    const answer = async (wrapper, text = 'the answer') => {
        await h.open(wrapper);
        await h.type(wrapper, 'hello');
        await h.send(wrapper);
        h.chatbot.reply({ jobType: 'response', response: [{ generated_text: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: text }] }] });
        h.chatbot.reply({ jobType: 'done' });
        await flushPromises();
    };

    describe('speech after the answer', () => {
        beforeEach(() => { h.kokoroStore.isModelLoaded = true; });

        it('asks for the speech of the answer, and is busy until it is there', async () => {
            const wrapper = await h.mountWidget({ options: { generateSpeech: true } });
            await answer(wrapper);
            expect(h.sent(h.kokoro, 'streamingAudio')).toEqual([{ jobType: 'streamingAudio', text: 'the answer' }]);
            expect(h.busy(wrapper)).toBe(true);
        });

        it('a speech that was already generated is played again, not generated again', async () => {
            const wrapper = await h.mountWidget({ options: { generateSpeech: true } });
            await h.kokoroStore.addAudio('the answer', 'blob:cached');
            const played = vi.fn();
            h.kokoroStore.channel.on(AUDIO_RESP, played);
            await answer(wrapper);
            expect(played).toHaveBeenCalledWith({ audio: 'blob:cached', text: 'the answer' });
            expect(h.kokoro.posted).toEqual([]);
            expect(h.busy(wrapper)).toBe(false);
        });

        it('nothing is generated for an error (the last message is the user\'s)', async () => {
            const wrapper = await h.mountWidget({ options: { generateSpeech: true } });
            await h.open(wrapper);
            await h.type(wrapper, 'hello');
            await h.send(wrapper);
            h.chatbot.reply({ jobType: 'error', error: 'boom' });
            await flushPromises();
            expect(h.kokoro.posted).toEqual([]);
            expect(h.busy(wrapper)).toBe(false);
        });

        it('nothing without the option', async () => {
            const wrapper = await h.mountWidget({ options: { generateSpeech: false } });
            await answer(wrapper);
            expect(h.kokoro.posted).toEqual([]);
        });

        it('nothing when the speech model is not loaded', async () => {
            h.kokoroStore.isModelLoaded = false;
            const wrapper = await h.mountWidget({ options: { generateSpeech: true } });
            await answer(wrapper);
            expect(h.kokoro.posted).toEqual([]);
        });
    });

    describe('playing the speech as the chunks come', () => {
        it('the first chunk plays at once, and the chat is busy until the chunks are done', async () => {
            const wrapper = await h.mountWidget();
            await h.open(wrapper);
            const el = audioElement(wrapper);
            chunk(1);
            await nextTick();
            expect(src(el)).toBe('blob:1');
            expect(el.play).toHaveBeenCalledOnce();
            expect(h.busy(wrapper)).toBe(true);
            h.kokoroStore.channel.emit(AUDIO_CHUNK_DONE);
            await nextTick();
            expect(h.busy(wrapper)).toBe(false);
        });

        it('chunks that arrive while one plays wait, and play in order as each one ends', async () => {
            const wrapper = await h.mountWidget();
            const el = audioElement(wrapper);
            chunk(1);
            chunk(2);
            chunk(3);
            expect(el.play).toHaveBeenCalledOnce();
            expect(src(el)).toBe('blob:1');
            el.endPlayback();
            expect(src(el)).toBe('blob:2');
            el.endPlayback();
            expect(src(el)).toBe('blob:3');
            expect(el.play).toHaveBeenCalledTimes(3);
        });

        // right after play() the time is still 0 but the audio is not paused: a chunk that came then replaced the first one
        it('a chunk right behind the first one does not play over it', async () => {
            const wrapper = await h.mountWidget();
            const el = audioElement(wrapper);
            chunk(1);
            chunk(2); // nothing has played yet, currentTime is still 0
            expect(src(el)).toBe('blob:1');
            expect(el.play).toHaveBeenCalledOnce();
            el.endPlayback();
            expect(src(el)).toBe('blob:2');
        });

        // generation is faster than playback, so "done" comes while chunks wait; it removed the listener that moves the queue
        it('the chunks that still wait when the stream is done are played anyway', async () => {
            const wrapper = await h.mountWidget();
            const el = audioElement(wrapper);
            chunk(1);
            chunk(2);
            chunk(3);
            h.kokoroStore.channel.emit(AUDIO_CHUNK_DONE);
            el.endPlayback();
            expect(src(el)).toBe('blob:2');
            el.endPlayback();
            expect(src(el)).toBe('blob:3');
        });

        it('after the last one nothing else plays, and a later chunk starts again', async () => {
            const wrapper = await h.mountWidget();
            const el = audioElement(wrapper);
            chunk(1);
            el.endPlayback();
            expect(el.play).toHaveBeenCalledOnce();
            chunk(2);
            expect(src(el)).toBe('blob:2');
            expect(el.play).toHaveBeenCalledTimes(2);
        });

        it('a chunk plays when the audio was stopped', async () => {
            const wrapper = await h.mountWidget();
            const el = audioElement(wrapper);
            chunk(1);
            el.pause();
            el.play.mockClear();
            Object.defineProperty(el, 'paused', { get: () => true, configurable: true }); // stopped by the user
            chunk(2);
            expect(src(el)).toBe('blob:2');
        });
    });

    describe('the speech of a message, asked by its player', () => {
        const asks = (wrapper, text) => wrapper.findAllComponents({ name: 'AudioPlayer' })[0].vm.$emit('onRequestAudio', text);

        it('asks for it and is busy until it is there', async () => {
            h.kokoroStore.isModelLoaded = true;
            const wrapper = await h.mountWidget();
            await h.open(wrapper);
            asks(wrapper, 'say this');
            await nextTick();
            expect(h.sent(h.kokoro, 'audioGen')).toEqual([{ jobType: 'audioGen', text: 'say this' }]);
            expect(h.busy(wrapper)).toBe(true);
        });

        it('tells the user the speech model is not loaded', async () => {
            h.kokoroStore.isModelLoaded = false;
            const wrapper = await h.mountWidget();
            await h.open(wrapper);
            asks(wrapper, 'say this');
            expect(h.errorStore.getErrors).toEqual(['The Speech generation model is not loaded, please load it first.']);
            expect(h.kokoro.posted).toEqual([]);
        });

        // the answer was "not loaded" although it was loaded and busy generating another one
        it('while one is being generated it waits, it is not an error', async () => {
            h.kokoroStore.isModelLoaded = true;
            const wrapper = await h.mountWidget();
            await h.open(wrapper);
            asks(wrapper, 'one');
            asks(wrapper, 'two');
            expect(h.sent(h.kokoro, 'audioGen')).toHaveLength(1);
            expect(h.errorStore.getErrors).toEqual([]);
        });
    });

    describe('a speech that fails', () => {
        it('is reported and the chat is free again (it was busy until the audio came)', async () => {
            h.kokoroStore.isModelLoaded = true;
            const wrapper = await h.mountWidget();
            await h.open(wrapper);
            wrapper.findAllComponents({ name: 'AudioPlayer' })[0].vm.$emit('onRequestAudio', 'say this');
            await nextTick();
            expect(h.busy(wrapper)).toBe(true);
            h.kokoro.reply({ jobType: 'error', error: 'tts server down' });
            await nextTick();
            expect(h.errorStore.getErrors).toEqual(['tts server down']);
            expect(h.busy(wrapper)).toBe(false);
        });
    });

    describe('regenerate', () => {
        const tools = [{ name: 'weather', description: 'get the weather' }, { name: 'mail', description: 'send an email' }];
        const documents = [{ title: 'doc a', content: 'A' }, { title: 'doc b', content: 'B' }];
        // greeting, a question and an answer
        const conversation = async (wrapper) => {
            await h.chatStore.addMessage('user', 'what now?');
            await h.chatStore.addMessage('assistant', 'the answer');
            await h.open(wrapper);
        };
        const messages = (wrapper) => wrapper.findAll('.chat-message');
        const regenerate = (wrapper) => wrapper.findAll('button').filter((b) => b.text() === 'Regenerate');
        const lastId = () => h.chatStore.getLastMessage().id;

        it('the button shows when the mouse is over an answer, not over the questions', async () => {
            const wrapper = await h.mountWidget();
            await conversation(wrapper);
            expect(regenerate(wrapper).every((b) => !b.isVisible())).toBe(true);
            await messages(wrapper)[1].trigger('mouseover'); // the question
            expect(regenerate(wrapper).every((b) => !b.isVisible())).toBe(true);
            await messages(wrapper)[2].trigger('mouseover'); // the answer
            expect(regenerate(wrapper)[2].isVisible()).toBe(true);
            // mouseleave does not bubble, it is listened to on the element around the message
            messages(wrapper)[2].element.parentElement.dispatchEvent(new MouseEvent('mouseleave'));
            await nextTick();
            expect(regenerate(wrapper)[2].isVisible()).toBe(false);
        });

        it('drops that answer and asks again with what came before', async () => {
            const wrapper = await h.mountWidget();
            await conversation(wrapper);
            await messages(wrapper)[2].trigger('mouseover');
            await regenerate(wrapper)[2].trigger('click');
            expect(h.chatStore.getChatHistory.map((m) => m.content)).toEqual(['Hello, how can I help?', 'what now?']);
            expect(h.sent(h.chatbot, 'streaming')).toHaveLength(1);
            expect(h.sent(h.chatbot, 'streaming')[0].messages.map((m) => m.content)).toEqual(['Hello, how can I help?', 'what now?']);
            expect(h.busy(wrapper)).toBe(true);
        });

        it('tells the user when the model is not loaded', async () => {
            const wrapper = await h.mountWidget({ loaded: false });
            await conversation(wrapper);
            wrapper.vm.$.setupState.regenerate(lastId());
            expect(h.errorStore.getErrors).toEqual(['ChatBot not loaded, please load it by clicking the red dot.']);
            expect(h.chatbot.posted).toEqual([]);
        });

        it('is not asked twice while it is answering', async () => {
            const wrapper = await h.mountWidget();
            await conversation(wrapper);
            const id = lastId();
            wrapper.vm.$.setupState.regenerate(id);
            wrapper.vm.$.setupState.regenerate(id);
            expect(h.sent(h.chatbot, 'streaming')).toHaveLength(1);
        });

        it('without embeddings it gives the model all the tools and documents', async () => {
            const wrapper = await h.mountWidget({ options: { useEmbeddings: false }, props: { tools, documents } });
            await conversation(wrapper);
            wrapper.vm.$.setupState.regenerate(lastId());
            expect(h.sent(h.chatbot, 'streaming')[0]).toMatchObject({ tools, documents: ['doc a', 'doc b'] });
        });

        it('with embeddings, only the ones close to the question that came before', async () => {
            const wrapper = await h.mountWidget({ options: { useEmbeddings: true, threshold: 0.8 }, props: { tools, documents } });
            h.vector.addToolEmbeddings('get the weather', [1, 0]);
            h.vector.addToolEmbeddings('send an email', [0, 1]);
            h.vector.addDocumentEmbeddings('doc a', [0, 1]);
            h.vector.addDocumentEmbeddings('doc b', [1, 0]);
            await conversation(wrapper);
            h.chatStore.getChatHistory.find((m) => m.content === 'what now?').embeddings = [1, 0];
            wrapper.vm.$.setupState.regenerate(lastId());
            expect(h.sent(h.chatbot, 'streaming')[0]).toMatchObject({ tools: [tools[0]], documents: ['doc b'] });
        });

        it('with embeddings but none for that question, it falls back to all of them', async () => {
            const wrapper = await h.mountWidget({ options: { useEmbeddings: true }, props: { tools, documents } });
            await conversation(wrapper);
            wrapper.vm.$.setupState.regenerate(lastId());
            expect(h.sent(h.chatbot, 'streaming')[0]).toMatchObject({ tools, documents: ['doc a', 'doc b'] });
        });
    });

    describe('what the models tell the app', () => {
        it('the chat model being ready is announced, and the embeddings are computed', async () => {
            const tools = [{ name: 'weather', description: 'get the weather' }];
            const wrapper = await h.mountWidget({ options: { useEmbeddings: true }, props: { tools }, loaded: false });
            const announced = vi.fn();
            h.emitter.on('ChatBotModelOptions#updateBtnTitle', announced);
            h.chatbot.reply({ jobType: 'updateBtnTitle', eventName: 'ChatBotModelOptions#updateBtnTitle', event: '' });
            await nextTick();
            expect(announced).toHaveBeenCalledOnce();
            // a request is posted for the documents too, with nothing to embed
            expect(h.sent(h.chatbot, 'embeddings').map((m) => [m.type, m.texts])).toEqual([['tool', ['get the weather']], ['document', []]]);
            expect(h.chatStore.getLastMessage().content).toBe('I am computing the embeddings, please wait.');
            expect(wrapper.exists()).toBe(true);
        });

        it('the speech model being ready is announced, nothing to embed', async () => {
            await h.mountWidget({ options: { useEmbeddings: true }, loaded: false });
            const announced = vi.fn();
            h.emitter.on('ChatBotModelOptions#updateBtnTitle', announced);
            h.kokoro.reply({ jobType: 'updateBtnTitle', eventName: 'ChatBotModelOptions#updateBtnTitle', event: '' });
            expect(announced).toHaveBeenCalledOnce();
            expect(h.chatbot.posted).toEqual([]);
        });

        it('the progress of a download reaches the progress bar through the emitter', async () => {
            await h.mountWidget();
            const seen = [];
            h.emitter.on('ChatBotWidget#requestMultiProgressBar', (e) => seen.push(e));
            h.chatbot.reply({ jobType: 'updateProgressBar', eventName: 'ChatBotWidget#requestMultiProgressBar', event: { status: 'init', name: 'model.onnx', progress: 0, total: 100 } });
            expect(seen).toEqual([{ status: 'init', name: 'model.onnx', progress: 0, total: 100 }]);
        });
    });
});
