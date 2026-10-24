import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { shallowMount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { FakeWorker } from './helpers/FakeWorker';

vi.mock('@huggingface/transformers', () => ({
    pipeline: vi.fn(), env: {}, TextStreamer: class {}, mean_pooling: vi.fn(), RawAudio: class {},
}));
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: vi.fn() }, TextSplitterStream: class {} }));

// The test files share one module registry (isolate: false): the widget and the stores are imported after a reset,
// so they are bound to the mocks of THIS file and the test talks to the same stores the widget uses.
let ChatBotWidget, mitt, createPinia, setActivePinia, stores;
beforeAll(async () => {
    vi.resetModules();
    ({ default: mitt } = await import('mitt'));
    ({ createPinia, setActivePinia } = await import('pinia'));
    stores = {
        ...await import('../src/stores/ChatBotStore'),
        ...await import('../src/stores/KokoroStore'),
        ...await import('../src/stores/ErrorStore'),
        ...await import('../src/stores/vectorStore'),
    };
    ChatBotWidget = (await import('../src/components/ChatBotWidget.vue')).default;
});

const OPTIONS_KEY = 'chatbotWidget#Options';
const LOAD_CHATBOT = 'ChatBotWidget#loadChatBotModel';
const PROGRESS = 'ChatBotWidget#requestMultiProgressBar';

describe('ChatBotWidget', () => {
    let emitter, chatbot, kokoro, chatStore, kokoroStore, errorStore, vector, wrappers;

    // `options` are the widget's saved options (localStorage), `props` its props
    const mountWidget = async ({ options = {}, props = {}, loaded = true, plugins = [] } = {}) => {
        localStorage.setItem(OPTIONS_KEY, JSON.stringify({ generateSpeech: false, useEmbeddings: false, threshold: 0.8, ...options }));
        const errors = []; // errors Vue catches in hooks, ie: the one a widget throws when it is badly configured
        const wrapper = shallowMount(ChatBotWidget, {
            props: { emitter, greetings: 'Hello, how can I help?', ...props },
            attachTo: document.body,
            global: { plugins, config: { errorHandler: (e) => errors.push(e) } },
        });
        wrapper.errors = errors;
        wrappers.push(wrapper);
        chatStore.isModelLoaded = loaded;
        vi.advanceTimersByTime(60); // the greeting is added after 50 ms
        await nextTick();
        return wrapper;
    };
    const open = (wrapper) => wrapper.find('.drop-menu').trigger('click');
    const type = (wrapper, text) => wrapper.find('textarea').setValue(text);
    const send = (wrapper) => wrapper.find('.chat-buttons button').trigger('click');
    const sent = (worker, ...jobTypes) => worker.posted.filter((m) => jobTypes.includes(m.jobType));
    const bubbles = (wrapper) => wrapper.findAll('.message-bubble').map((b) => b.text());

    beforeAll(() => {
        // jsdom has none of these
        Element.prototype.scrollIntoView = vi.fn();
        HTMLDialogElement.prototype.showModal = vi.fn(function(){ this.setAttribute('open', ''); });
        HTMLDialogElement.prototype.close = vi.fn(function(){ this.removeAttribute('open'); });
    });

    beforeEach(() => {
        vi.useFakeTimers();
        setActivePinia(createPinia());
        emitter = mitt();
        wrappers = [];
        chatStore = stores.useChatBotStore();
        kokoroStore = stores.useKokoroStore();
        errorStore = stores.useErrorStore();
        vector = stores.useVectorStore();
        chatbot = new FakeWorker();
        kokoro = new FakeWorker();
        // replaces the worker of the (module level) worker manager, its handlers stay
        chatStore.wm.addWorker('chatbot', chatbot);
        kokoroStore.wm.addWorker('kokoro', kokoro);
    });
    afterEach(() => wrappers.forEach((w) => w.unmount()));

    describe('the window', () => {
        it('starts closed, with the greeting waiting in the history', async () => {
            const wrapper = await mountWidget({ props: { system: 'You are helpful' } });
            expect(wrapper.find('.chat-box').exists()).toBe(false);
            expect(chatStore.getChatHistory.map((m) => [m.role, m.content])).toEqual([
                ['system', 'You are helpful'],
                ['assistant', 'Hello, how can I help?'],
            ]);
        });

        it('the arrow opens and closes the chat, the system message is not shown', async () => {
            const wrapper = await mountWidget({ props: { system: 'You are helpful' } });
            await open(wrapper);
            expect(wrapper.find('.chat-box').exists()).toBe(true);
            expect(bubbles(wrapper)).toEqual(['Hello, how can I help?']);
            await wrapper.find('.drop-menu').trigger('click');
            expect(wrapper.find('.chat-box').exists()).toBe(false);
        });

        it('expanding opens the chat too, and un-expanding closes it', async () => {
            const wrapper = await mountWidget();
            await wrapper.find('.expand-button').trigger('click');
            expect(wrapper.classes()).toContain('chatbot-widget-expanded');
            expect(wrapper.find('.chat-box').exists()).toBe(true);
            await wrapper.find('.expand-button').trigger('click');
            expect(wrapper.classes()).toContain('chatbot-widget-unexpanded');
            expect(wrapper.find('.chat-box').exists()).toBe(false);
        });

        it('the gear opens the options', async () => {
            const wrapper = await mountWidget();
            await wrapper.find('.gear-button').trigger('click');
            expect(wrapper.find('dialog').element.open).toBe(true);
            await wrapper.find('.gear-button').trigger('click');
            expect(wrapper.find('dialog').element.open).toBe(false);
        });

        it('with editable false the gear does nothing, and a config is required', async () => {
            const wrapper = await mountWidget({ props: { editable: false, config: {} } });
            await wrapper.find('.gear-button').trigger('click');
            expect(wrapper.find('dialog').element.open).toBe(false);

            // mounting throws, and what it registered before throwing stays: the app is unmounted by hand
            let app;
            await expect(mountWidget({ props: { editable: false }, plugins: [{ install(a) { app = a; } }] }))
                .rejects.toThrow('props.config is null');
            app.unmount();
        });

        it('the led is red until the model is loaded', async () => {
            const wrapper = await mountWidget({ loaded: false });
            expect(wrapper.find('.status-icon circle').classes()).toContain('status-icon-offline');
            chatStore.isModelLoaded = true;
            await nextTick();
            expect(wrapper.find('.status-icon circle').classes()).toContain('status-icon-online');
        });
    });

    describe('sending a message', () => {
        it('tells the user to load the model first, and sends nothing', async () => {
            const wrapper = await mountWidget({ loaded: false });
            await open(wrapper);
            await type(wrapper, 'hello');
            await send(wrapper);
            expect(errorStore.getErrors).toEqual(['ChatBot not loaded, please load it by clicking the red dot.']);
            expect(chatbot.posted).toEqual([]);
        });

        it('an empty message is not sent', async () => {
            const wrapper = await mountWidget();
            await open(wrapper);
            await send(wrapper);
            expect(chatbot.posted).toEqual([]);
        });

        // the blank message went to the model
        it('a message of only spaces is not sent either', async () => {
            const wrapper = await mountWidget();
            await open(wrapper);
            await type(wrapper, '   \n  ');
            await send(wrapper);
            expect(chatbot.posted).toEqual([]);
            expect(chatStore.getChatHistory.filter((m) => m.role === 'user')).toEqual([]);
        });

        it('adds the message, asks the model to stream the answer and clears the box', async () => {
            const wrapper = await mountWidget();
            await open(wrapper);
            await type(wrapper, 'hello');
            await send(wrapper);
            expect(chatStore.getLastMessage()).toMatchObject({ role: 'user', content: 'hello' });
            expect(sent(chatbot, 'streaming')).toHaveLength(1);
            expect(sent(chatbot, 'streaming')[0].messages.map((m) => m.content)).toEqual(['Hello, how can I help?', 'hello']);
            expect(wrapper.find('textarea').element.value).toBe('');
        });

        it('sends the template, the tools and the documents it was given', async () => {
            const tools = [{ name: 'weather', description: 'get the weather' }];
            const documents = [{ title: 'doc', content: 'text' }];
            const wrapper = await mountWidget({ props: { tools, documents, chatTemplate: 'my template' } });
            await open(wrapper);
            await type(wrapper, 'hello');
            await send(wrapper);
            expect(sent(chatbot, 'streaming')[0]).toMatchObject({ chat_template: 'my template', tools, documents: ['doc'] });
        });

        it('is busy until the answer is done: the box and the button are disabled', async () => {
            const wrapper = await mountWidget();
            await open(wrapper);
            await type(wrapper, 'hello');
            await send(wrapper);
            expect(wrapper.find('textarea').element.disabled).toBe(true);
            expect(wrapper.find('.chat-buttons button').element.disabled).toBe(true);
            expect(wrapper.find('.bouncing-dots').exists()).toBe(true);
        });

        it('a second message while it is busy is not sent', async () => {
            const wrapper = await mountWidget();
            await open(wrapper);
            await type(wrapper, 'one');
            await send(wrapper);
            await wrapper.vm.$nextTick();
            wrapper.vm.sendMessage?.();
            expect(sent(chatbot, 'streaming')).toHaveLength(1);
        });

        describe('the keyboard', () => {
            const press = (wrapper, init) => wrapper.find('textarea').trigger('keydown', init);

            it('Enter sends', async () => {
                const wrapper = await mountWidget();
                await open(wrapper);
                await type(wrapper, 'hello');
                await press(wrapper, { key: 'Enter' });
                expect(sent(chatbot, 'streaming')).toHaveLength(1);
            });

            it('Shift+Enter adds a new line', async () => {
                const wrapper = await mountWidget();
                await open(wrapper);
                await type(wrapper, 'hello');
                await press(wrapper, { key: 'Enter', shiftKey: true });
                expect(sent(chatbot, 'streaming')).toHaveLength(0);
                expect(wrapper.find('textarea').element.value).toBe('hello\n');
            });

            // Enter confirms the text being composed (Chinese, Japanese, Korean), it is not "send"
            it('Enter while an input method is composing does not send', async () => {
                const wrapper = await mountWidget();
                await open(wrapper);
                await type(wrapper, 'konnichiwa');
                await press(wrapper, { key: 'Enter', isComposing: true });
                expect(sent(chatbot, 'streaming')).toHaveLength(0);
            });
        });
    });

    describe('with embeddings', () => {
        const tools = [{ name: 'weather', description: 'get the weather' }];
        const documents = [{ title: 'doc', content: 'text' }];
        const embed = (type, text, embeddings) => chatbot.reply({ jobType: 'embeddings', type, text, embeddings });

        it('the first send computes the embeddings of tools and documents instead, and keeps the message', async () => {
            const wrapper = await mountWidget({ options: { useEmbeddings: true }, props: { tools, documents } });
            await open(wrapper);
            await type(wrapper, 'hello');
            await send(wrapper);
            expect(sent(chatbot, 'embeddings').map((m) => [m.type, m.texts])).toEqual([['tool', ['get the weather']], ['document', ['doc']]]);
            expect(sent(chatbot, 'streaming')).toEqual([]);
            expect(chatStore.getLastMessage()).toMatchObject({ role: 'info', content: 'I am computing the embeddings, please wait.' });
            expect(wrapper.find('textarea').element.value).toBe('hello');
        });

        it('it is busy until all of them are computed', async () => {
            const wrapper = await mountWidget({ options: { useEmbeddings: true }, props: { tools, documents } });
            await open(wrapper);
            await type(wrapper, 'hello');
            await send(wrapper);
            expect(wrapper.find('textarea').element.disabled).toBe(true);
            embed('tool', 'get the weather', [1, 0]);
            await nextTick();
            expect(wrapper.find('textarea').element.disabled).toBe(true);
            embed('document', 'doc', [0, 1]);
            await nextTick();
            expect(wrapper.find('textarea').element.disabled).toBe(false);
            expect(vector.getToolsEmbeddings()).toEqual([{ key: 'get the weather', embeddings: [1, 0] }]);
        });

        it('then the message is embedded, and the answer is asked with the tools and documents that are close', async () => {
            const wrapper = await mountWidget({ options: { useEmbeddings: true }, props: { tools, documents } });
            await open(wrapper);
            await type(wrapper, 'hello');
            await send(wrapper);
            embed('tool', 'get the weather', [1, 0]);
            embed('document', 'doc', [0, 1]);
            await nextTick();
            await send(wrapper); // the message is still in the box
            expect(sent(chatbot, 'embeddings').at(-1)).toMatchObject({ type: 'user', texts: ['hello'] });
            expect(sent(chatbot, 'streaming')).toEqual([]);

            embed('user', 'hello', [1, 0]); // close to the tool, orthogonal to the document
            expect(sent(chatbot, 'streaming')).toHaveLength(1);
            expect(sent(chatbot, 'streaming')[0].tools).toEqual(tools);
            expect(sent(chatbot, 'streaming')[0].documents).toEqual([]);
            expect(chatStore.getLastMessage().embeddings).toEqual([1, 0]);
        });
    });

    describe('the answer', () => {
        const ask = async (wrapper, text = 'hello') => {
            await open(wrapper);
            await type(wrapper, text);
            await send(wrapper);
        };

        it('shows what the model streams as it comes, then keeps the full answer', async () => {
            const wrapper = await mountWidget();
            await ask(wrapper);
            chatbot.reply({ jobType: 'streaming', response: 'Hel' });
            chatbot.reply({ jobType: 'streaming', response: 'lo!' });
            await nextTick();
            expect(bubbles(wrapper).at(-1)).toBe('Hello!');
            expect(wrapper.find('.bouncing-dots').exists()).toBe(false);

            chatbot.reply({ jobType: 'response', response: [{ generated_text: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'Hello!' }] }] });
            chatbot.reply({ jobType: 'done' });
            await nextTick();
            expect(chatStore.getLastMessage()).toMatchObject({ role: 'assistant', content: 'Hello!' });
            expect(bubbles(wrapper).filter((b) => b === 'Hello!')).toHaveLength(1);
            expect(wrapper.find('textarea').element.disabled).toBe(false);
        });

        it('what streams while nothing was asked is ignored', async () => {
            const wrapper = await mountWidget();
            await open(wrapper);
            chatbot.reply({ jobType: 'streaming', response: 'stray' });
            await nextTick();
            expect(bubbles(wrapper)).not.toContain('stray');
        });

        it('an error is shown to the user and the chat is free again', async () => {
            const wrapper = await mountWidget();
            await ask(wrapper);
            chatbot.reply({ jobType: 'error', error: 'model failed' });
            await nextTick();
            expect(errorStore.getErrors).toEqual(['model failed']);
            expect(wrapper.find('textarea').element.disabled).toBe(false);
        });
    });

    describe('loading the model', () => {
        const progress = () => {
            const seen = [];
            emitter.on(PROGRESS, (e) => seen.push(e));
            return seen;
        };

        it('the led asks for a load when the model is not loaded', async () => {
            const wrapper = await mountWidget({ loaded: false });
            const asked = vi.fn();
            emitter.on(LOAD_CHATBOT, asked);
            await wrapper.find('.status-icon').trigger('click');
            expect(asked).toHaveBeenCalledOnce();
        });

        it('and does nothing when it already is loaded', async () => {
            const wrapper = await mountWidget();
            const asked = vi.fn();
            emitter.on(LOAD_CHATBOT, asked);
            await wrapper.find('.status-icon').trigger('click');
            expect(asked).not.toHaveBeenCalled();
        });

        it('a load request opens the progress bar after 2 s, and loads the model when it is ready', async () => {
            await mountWidget({ loaded: false });
            const seen = progress();
            emitter.emit(LOAD_CHATBOT);
            vi.advanceTimersByTime(1999);
            expect(seen).toEqual([]);
            vi.advanceTimersByTime(1);
            expect(seen).toEqual([{ status: 'setup', title: 'downloading or loading chatbot model', onLoad: expect.any(Function) }]);
            expect(chatbot.posted).toEqual([]);
            await seen[0].onLoad();
            expect(sent(chatbot, 'loadModel')).toEqual([expect.objectContaining({ jobType: 'loadModel', force: false })]);
        });

        // the options component asks with { force: true } after the cache of a loaded model was deleted
        it('a forced request is a forced load', async () => {
            await mountWidget({ loaded: false });
            const seen = progress();
            emitter.emit(LOAD_CHATBOT, { force: true });
            vi.advanceTimersByTime(2000);
            await seen[0].onLoad();
            expect(sent(chatbot, 'loadModel')[0].force).toBe(true);
        });

        it('the same for the speech model', async () => {
            await mountWidget();
            const seen = progress();
            emitter.emit('ChatBotWidget#loadKokoroModel', { force: true });
            vi.advanceTimersByTime(2000);
            expect(seen[0].title).toBe('downloading or loading Kokoro model');
            await seen[0].onLoad();
            expect(sent(kokoro, 'loadModel')[0].force).toBe(true);
        });

        it('with a remote server the led checks the server, there is nothing to download', async () => {
            vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ status: 'ok' }) })));
            const wrapper = await mountWidget({ loaded: false });
            chatStore.isLocal = false;
            chatStore.remoteOptions.url = 'http://srv';
            await wrapper.find('.status-icon').trigger('click');
            await flushPromises();
            expect(fetch).toHaveBeenCalledWith('http://srv/health');
            expect(chatStore.isModelLoaded).toBe(true);
        });

        it('with speech on, the led also loads the speech model', async () => {
            const wrapper = await mountWidget({ options: { generateSpeech: true } });
            kokoroStore.isModelLoaded = false;
            await wrapper.find('.status-icon').trigger('click');
            expect(sent(kokoro, 'loadModel')).toHaveLength(1);
        });
    });

    describe('what it leaves behind', () => {
        // the chat was wiped every time the style of the parent changed, not only when it appeared again
        it('a style change of the parent element does not reset the conversation', async () => {
            const wrapper = await mountWidget();
            await chatStore.addMessage('user', 'something I wrote');
            wrapper.element.parentElement.style.opacity = '0.5';
            await Promise.resolve();
            vi.advanceTimersByTime(100);
            expect(chatStore.getChatHistory.map((m) => m.content)).toContain('something I wrote');
        });

        it('it starts again when the parent is shown after being hidden', async () => {
            const wrapper = await mountWidget();
            const parent = wrapper.element.parentElement;
            await chatStore.addMessage('user', 'something I wrote');
            parent.style.display = 'none';
            await Promise.resolve();
            vi.advanceTimersByTime(100);
            expect(chatStore.getChatHistory.map((m) => m.content)).toContain('something I wrote');
            parent.style.display = 'block';
            await Promise.resolve();
            vi.advanceTimersByTime(100);
            expect(chatStore.getChatHistory.map((m) => m.content)).toEqual(['Hello, how can I help?']);
        });

        // off(type) without the handler removed everybody's listeners of these events, the app's too
        it('unmounting leaves the listeners of others alone', async () => {
            const wrapper = await mountWidget();
            const onLoad = vi.fn(), onDone = vi.fn(), onAudio = vi.fn();
            emitter.on(LOAD_CHATBOT, onLoad);
            chatStore.channel.on('ChatBotWidget#done', onDone);
            kokoroStore.channel.on('ChatBotWidget#audioResp', onAudio);
            wrapper.unmount();
            wrappers = [];
            emitter.emit(LOAD_CHATBOT);
            chatStore.channel.emit('ChatBotWidget#done');
            kokoroStore.channel.emit('ChatBotWidget#audioResp', {});
            expect(onLoad).toHaveBeenCalledOnce();
            expect(onDone).toHaveBeenCalledOnce();
            expect(onAudio).toHaveBeenCalledOnce();
        });

        it('after unmounting it no longer reacts to anything', async () => {
            const wrapper = await mountWidget({ loaded: false });
            const seen = [];
            emitter.on(PROGRESS, (e) => seen.push(e));
            wrapper.unmount();
            wrappers = [];
            emitter.emit(LOAD_CHATBOT);
            vi.advanceTimersByTime(3000);
            expect(seen).toEqual([]);
        });

        // `default: mitt()` is one object, created when the module is loaded, shared by every widget without an emitter
        it('widgets without an emitter do not share one', async () => {
            const a = shallowMount(ChatBotWidget, { attachTo: document.body });
            const b = shallowMount(ChatBotWidget, { attachTo: document.body });
            wrappers.push(a, b);
            expect(a.props('emitter')).not.toBe(b.props('emitter'));
        });
    });

    // todo: pressing send the first time with embeddings on only computes them, even with no tools and documents to compute
    it.todo('the first send is not swallowed when there are no tools or documents');
    // todo: the userEmbeddings handler throws (nothing is sent) when the embeddings do not match the stored ones, and the chat stays busy
    it.todo('a failure while preparing the request frees the chat');
});
