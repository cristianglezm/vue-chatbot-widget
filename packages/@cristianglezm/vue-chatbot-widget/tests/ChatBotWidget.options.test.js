import { describe, it, expect, vi } from 'vitest';
import { nextTick } from 'vue';
import { useWidgetHarness, OPTIONS_KEY } from './helpers/widgetHarness';

vi.mock('@huggingface/transformers', () => ({
    pipeline: vi.fn(), env: {}, TextStreamer: class {}, mean_pooling: vi.fn(), RawAudio: class {},
}));
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: vi.fn() }, TextSplitterStream: class {} }));

describe('ChatBotWidget: options, panels and config', () => {
    const h = useWidgetHarness();
    const saved = () => JSON.parse(localStorage.getItem(OPTIONS_KEY));
    const checkbox = (wrapper, id) => wrapper.find(`#${id}`);
    const switchPanel = (wrapper, index) => wrapper.findAllComponents({ name: 'SwitchPanel' })[index];

    describe('the options of the widget', () => {
        it('shows the saved ones', async () => {
            const wrapper = await h.mountWidget({ options: { generateSpeech: true, useEmbeddings: false } });
            expect(checkbox(wrapper, 'generateSpeech').element.checked).toBe(true);
            expect(checkbox(wrapper, 'useEmbeddings').element.checked).toBe(false);
        });

        it('has defaults: no speech, embeddings on', async () => {
            localStorage.clear();
            const wrapper = await h.mountWidget();
            localStorage.removeItem(OPTIONS_KEY);
            wrapper.unmount();
            h.wrappers = [];
            const fresh = (await import('@vue/test-utils')).shallowMount(h.ChatBotWidget, { props: { emitter: h.emitter }, attachTo: document.body });
            h.wrappers.push(fresh);
            expect(checkbox(fresh, 'generateSpeech').element.checked).toBe(false);
            expect(checkbox(fresh, 'useEmbeddings').element.checked).toBe(true);
        });

        it('changing one saves all of them', async () => {
            const wrapper = await h.mountWidget({ options: { generateSpeech: false, useEmbeddings: false, threshold: 0.8 } });
            await checkbox(wrapper, 'generateSpeech').setValue(true);
            expect(saved()).toEqual({ generateSpeech: true, useEmbeddings: false, threshold: 0.8 });
        });

        it('the next widget starts with what was saved', async () => {
            const first = await h.mountWidget();
            await checkbox(first, 'useEmbeddings').setValue(true);
            first.unmount();
            h.wrappers = [];
            const { shallowMount } = await import('@vue/test-utils');
            const second = shallowMount(h.ChatBotWidget, { props: { emitter: h.emitter }, attachTo: document.body });
            h.wrappers.push(second);
            expect(checkbox(second, 'useEmbeddings').element.checked).toBe(true);
        });
    });

    describe.each([
        { name: 'the chat model', index: 0, store: () => h.chatStore, worker: () => h.chatbot, key: 'FlowerEvolverChatBotIsLocal', load: 'ChatBotWidget#loadChatBotModel' },
        { name: 'the speech model', index: 1, store: () => h.kokoroStore, worker: () => h.kokoro, key: 'FlowerEvolverKokoroIsLocal', load: 'ChatBotWidget#loadKokoroModel' },
    ])('switching $name between local and remote', ({ index, store, worker, key, load }) => {
        const toggle = (wrapper) => switchPanel(wrapper, index).vm.$emit('onChange');

        it('saves the choice', async () => {
            const wrapper = await h.mountWidget();
            toggle(wrapper);
            expect(store().isLocal).toBe(false);
            expect(localStorage.getItem(key)).toBe('false');
            toggle(wrapper);
            expect(store().isLocal).toBe(true);
            expect(localStorage.getItem(key)).toBe('true');
        });

        // the reset was asked after isLocal had been changed, and a store that is not local ignores it:
        // the local model stayed in memory and the led stayed green
        it('local to remote: the local model that was loaded is reset', async () => {
            const wrapper = await h.mountWidget();
            store().isModelLoaded = true;
            toggle(wrapper);
            expect(h.sent(worker(), 'reset')).toHaveLength(1);
            expect(store().isModelLoaded).toBe(false);
            expect(store().isLocal).toBe(false);
        });

        it('local to remote: nothing to reset when nothing was loaded', async () => {
            const wrapper = await h.mountWidget({ loaded: false });
            store().isModelLoaded = false;
            toggle(wrapper);
            expect(worker().posted).toEqual([]);
        });

        it('remote to local: loads the local model if something was loaded', async () => {
            const wrapper = await h.mountWidget();
            store().isLocal = false;
            store().isModelLoaded = true;
            const asked = vi.fn();
            h.emitter.on(load, asked);
            toggle(wrapper);
            expect(asked).toHaveBeenCalledOnce();
            expect(store().isLocal).toBe(true);
        });

        it('remote to local: nothing to load when nothing was loaded', async () => {
            const wrapper = await h.mountWidget({ loaded: false });
            store().isLocal = false;
            store().isModelLoaded = false;
            const asked = vi.fn();
            h.emitter.on(load, asked);
            toggle(wrapper);
            expect(asked).not.toHaveBeenCalled();
        });
    });

    describe('the config prop', () => {
        const config = (c) => ({ editable: false, config: c });

        it('sets the models and servers of the stores, merging what it does not mention', async () => {
            await h.mountWidget({ props: config({
                llm: { isLocal: false, modelOptions: { model: 'org/other' }, remoteOptions: { url: 'http://srv' } },
                tts: { modelOptions: { voice: 'am_adam' }, remoteOptions: { model: 'x' } },
            }) });
            expect(h.chatStore.isLocal).toBe(false);
            expect(h.chatStore.modelOptions).toMatchObject({ model: 'org/other', dtype: 'q4', device: 'CPU' });
            expect(h.chatStore.remoteOptions).toMatchObject({ url: 'http://srv', max_tokens: 256 });
            expect(h.kokoroStore.modelOptions).toMatchObject({ voice: 'am_adam', dtype: 'q8' });
            expect(h.kokoroStore.remoteOptions).toMatchObject({ model: 'x', url: 'http://localhost:8880' });
        });

        it('ignores what the stores do not have', async () => {
            await h.mountWidget({ props: config({ llm: { nothing: 1, modelOptions: { nope: 2 } } }) });
            expect(h.chatStore.nothing).toBeUndefined();
            expect(h.chatStore.modelOptions.nope).toBeUndefined();
        });

        it('sets the options of the widget', async () => {
            const wrapper = await h.mountWidget({ options: { generateSpeech: false, useEmbeddings: false }, props: config({ generateSpeech: true, useEmbeddings: true }) });
            expect(checkbox(wrapper, 'generateSpeech').element.checked).toBe(true);
            expect(checkbox(wrapper, 'useEmbeddings').element.checked).toBe(true);
        });

        // `if(props.config.useEmbeddings)`: false is falsy, so a config could only turn things on
        it('can also turn them off, over what was saved', async () => {
            const wrapper = await h.mountWidget({ options: { generateSpeech: true, useEmbeddings: true }, props: config({ generateSpeech: false, useEmbeddings: false }) });
            expect(checkbox(wrapper, 'generateSpeech').element.checked).toBe(false);
            expect(checkbox(wrapper, 'useEmbeddings').element.checked).toBe(false);
        });

        it('a threshold of 0 is a threshold: what is orthogonal to the message is retrieved', async () => {
            const tools = [{ name: 'weather', description: 'get the weather' }];
            const wrapper = await h.mountWidget({ options: { useEmbeddings: true, threshold: 0.8 }, props: { tools, ...config({ threshold: 0 }) } });
            await h.open(wrapper);
            await h.type(wrapper, 'hello');
            await h.send(wrapper); // computes the embeddings first
            h.chatbot.reply({ jobType: 'embeddings', type: 'tool', text: 'get the weather', embeddings: [0, 1] });
            await nextTick();
            await h.send(wrapper);
            h.chatbot.reply({ jobType: 'embeddings', type: 'user', text: 'hello', embeddings: [1, 0] }); // similarity 0
            expect(h.sent(h.chatbot, 'streaming')[0].tools).toEqual(tools);
        });

        it('is not saved: the next widget without it starts from what the user saved', async () => {
            await h.mountWidget({ props: config({ generateSpeech: true }) });
            expect(saved().generateSpeech).toBe(false);
        });
    });
});
