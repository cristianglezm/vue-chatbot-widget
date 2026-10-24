import { vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { FakeWorker } from './FakeWorker';

export const OPTIONS_KEY = 'chatbotWidget#Options';

/**
 * The ChatBotWidget with the real stores, fake workers and its children stubbed.
 * Call it inside a describe. The test file must mock transformers.js and kokoro-js itself (vi.mock is hoisted per file):
 *   vi.mock('@huggingface/transformers', () => ({ pipeline: vi.fn(), env: {}, TextStreamer: class {}, mean_pooling: vi.fn(), RawAudio: class {} }));
 *   vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: vi.fn() }, TextSplitterStream: class {} }));
 * Everything the tests use is a property of the returned object, it is renewed before each test.
 */
export const useWidgetHarness = () => {
    const h = { wrappers: [] };

    // The test files share one module registry (isolate: false): the widget and the stores are imported after a reset,
    // so they are bound to the mocks of the test file and the test talks to the same stores the widget uses.
    beforeAll(async () => {
        vi.resetModules();
        ({ default: h.mitt } = await import('mitt'));
        const pinia = await import('pinia');
        h.createPinia = pinia.createPinia;
        h.setActivePinia = pinia.setActivePinia;
        h.stores = {
            ...await import('../../src/stores/ChatBotStore'),
            ...await import('../../src/stores/KokoroStore'),
            ...await import('../../src/stores/ErrorStore'),
            ...await import('../../src/stores/vectorStore'),
        };
        h.ChatBotWidget = (await import('../../src/components/ChatBotWidget.vue')).default;
        // jsdom has none of these
        Element.prototype.scrollIntoView = vi.fn();
        HTMLDialogElement.prototype.showModal = vi.fn(function(){ this.setAttribute('open', ''); });
        HTMLDialogElement.prototype.close = vi.fn(function(){ this.removeAttribute('open'); });
        HTMLMediaElement.prototype.play = vi.fn(async () => {});
        HTMLMediaElement.prototype.pause = vi.fn();
    });

    beforeEach(() => {
        vi.useFakeTimers();
        // without crypto.subtle the audio cache is keyed by the text: no real async hashing, microtasks are enough
        vi.stubGlobal('crypto', {});
        h.setActivePinia(h.createPinia());
        h.emitter = h.mitt();
        h.wrappers = [];
        h.chatStore = h.stores.useChatBotStore();
        h.kokoroStore = h.stores.useKokoroStore();
        h.errorStore = h.stores.useErrorStore();
        h.vector = h.stores.useVectorStore();
        h.chatbot = new FakeWorker();
        h.kokoro = new FakeWorker();
        // replaces the worker of the (module level) worker manager, its handlers stay
        h.chatStore.wm.addWorker('chatbot', h.chatbot);
        h.kokoroStore.wm.addWorker('kokoro', h.kokoro);
    });
    afterEach(() => h.wrappers.forEach((w) => w.unmount()));

    // `options` are the widget's saved options (localStorage), `props` its props
    h.mountWidget = async ({ options = {}, props = {}, loaded = true, plugins = [] } = {}) => {
        localStorage.setItem(OPTIONS_KEY, JSON.stringify({ generateSpeech: false, useEmbeddings: false, threshold: 0.8, ...options }));
        const errors = [];
        const wrapper = shallowMount(h.ChatBotWidget, {
            props: { emitter: h.emitter, greetings: 'Hello, how can I help?', ...props },
            attachTo: document.body,
            global: { plugins, config: { errorHandler: (e) => errors.push(e) } },
        });
        wrapper.errors = errors;
        h.wrappers.push(wrapper);
        h.chatStore.isModelLoaded = loaded;
        vi.advanceTimersByTime(60); // the greeting is added after 50 ms
        await nextTick();
        return wrapper;
    };
    h.open = (wrapper) => wrapper.find('.drop-menu').trigger('click');
    h.type = (wrapper, text) => wrapper.find('textarea').setValue(text);
    h.send = (wrapper) => wrapper.find('.chat-buttons button').trigger('click');
    h.sent = (worker, ...jobTypes) => worker.posted.filter((m) => jobTypes.includes(m.jobType));
    h.bubbles = (wrapper) => wrapper.findAll('.message-bubble').map((b) => b.text());
    h.busy = (wrapper) => wrapper.find('textarea').element.disabled;

    return h;
};
