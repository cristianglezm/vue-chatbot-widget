import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('@huggingface/transformers', () => ({ RawAudio: class RawAudio {} }));
vi.mock('waveform-data', () => ({ default: { createFromAudio: vi.fn() } }));

// The test files share one module registry (isolate: false): what is tested is imported after a reset so it is
// bound to the mocks of THIS file, and the store the test uses is the one the component gets.
let AudioPlayer, WaveformData, useKokoroStore, useErrorStore, pinia;
beforeAll(async () => {
    vi.resetModules();
    ({ default: WaveformData } = await import('waveform-data'));
    ({ useKokoroStore } = await import('../src/stores/KokoroStore'));
    ({ useErrorStore } = await import('../src/stores/ErrorStore'));
    AudioPlayer = (await import('../src/components/AudioPlayer.vue')).default;
    const { createPinia } = await import('pinia');
    pinia = createPinia;
});

const KEY = 'what the assistant said';
const AUDIO_RESP = 'ChatBotWidget#audioResp';

describe('AudioPlayer', () => {
    let kokoro, errors, audio, contexts, frames, ctx, wrappers;

    const fakeWaveform = (length) => ({ length, channel: () => ({ min_sample: () => -20, max_sample: () => 20 }) });
    const makeAudio = () => {
        const el = document.createElement('audio');
        el.play = vi.fn(async () => {});
        el.pause = vi.fn();
        let time = 0;
        Object.defineProperty(el, 'currentTime', { get: () => time, set: (v) => { time = v; }, configurable: true });
        Object.defineProperty(el, 'duration', { get: () => 10, configurable: true });
        return el;
    };
    const play = (wrapper) => wrapper.findAll('button')[0].trigger('click');
    const player = (props = {}) => {
        const wrapper = mount(AudioPlayer, {
            props: { audioKey: KEY, audioPlayer: audio, isAudioPlaying: false, ...props },
            attachTo: document.body,
        });
        wrappers.push(wrapper);
        return wrapper;
    };
    const playing = (wrapper) => wrapper.find('.inline').isVisible();
    const nextFrame = () => frames.shift()?.();

    beforeEach(async () => {
        const { setActivePinia } = await import('pinia');
        setActivePinia(pinia());
        kokoro = useKokoroStore();
        errors = useErrorStore();
        audio = makeAudio();
        wrappers = [];
        contexts = [];
        frames = [];
        ctx = {
            clearRect: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
            closePath: vi.fn(), stroke: vi.fn(), fill: vi.fn(), arc: vi.fn(),
            createLinearGradient: () => ({ addColorStop: vi.fn() }),
        };
        HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx);
        // without crypto.subtle the audio cache is keyed by the text (no real async hashing), so a play resolves in
        // microtasks and flushPromises() is enough to wait for it. The hash itself is tested with the KokoroStore.
        vi.stubGlobal('crypto', {});
        vi.stubGlobal('AudioContext', class { constructor() { contexts.push(this); } });
        vi.stubGlobal('fetch', vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })));
        vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => frames.push(cb)));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        WaveformData.createFromAudio.mockReset();
        WaveformData.createFromAudio.mockImplementation((options, cb) => cb(null, fakeWaveform(options.scaleX)));
        await kokoro.addAudio(KEY, 'blob:audio');
    });
    afterEach(() => wrappers.forEach((w) => w.unmount()));

    it('shows the play button, the stop button and the waveform are hidden', () => {
        const wrapper = player();
        expect(wrapper.findAll('button')).toHaveLength(2);
        expect(wrapper.find('.inline').isVisible()).toBe(false);
        expect(wrapper.findAll('button')[0].element.disabled).toBe(false);
    });

    it('the play button is disabled while the audio of the chat is being generated', () => {
        const wrapper = player({ isAudioPlaying: true });
        expect(wrapper.findAll('button')[0].element.disabled).toBe(true);
    });

    it('plays the audio that was kept for its text', async () => {
        const wrapper = player();
        await play(wrapper);
        await flushPromises();
        expect(audio.getAttribute('src')).toBe('blob:audio');
        expect(audio.play).toHaveBeenCalledOnce();
        expect(playing(wrapper)).toBe(true);
    });

    it('asks for the audio when there is none, and does not play', async () => {
        const wrapper = player({ audioKey: 'never spoken' });
        await play(wrapper);
        await flushPromises();
        expect(wrapper.emitted('onRequestAudio')).toEqual([['never spoken']]);
        expect(audio.play).not.toHaveBeenCalled();
        expect(playing(wrapper)).toBe(false);
    });

    it('stop pauses the audio and goes back to the play button', async () => {
        const wrapper = player();
        await play(wrapper);
        await flushPromises();
        await wrapper.findAll('button')[1].trigger('click');
        expect(audio.pause).toHaveBeenCalledOnce();
        expect(playing(wrapper)).toBe(false);
    });

    it('when the audio reaches its end it goes back to the play button', async () => {
        const wrapper = player();
        await play(wrapper);
        await flushPromises();
        audio.currentTime = 10;
        nextFrame();
        await flushPromises();
        expect(playing(wrapper)).toBe(false);
    });

    it('keeps animating while it plays, one frame after another', async () => {
        const wrapper = player();
        await play(wrapper);
        await flushPromises();
        audio.currentTime = 2;
        nextFrame();
        expect(frames).toHaveLength(1);
        expect(wrapper.vm).toBeDefined();
    });

    it('a waveform that cannot be read is reported, and the audio plays anyway', async () => {
        WaveformData.createFromAudio.mockImplementation((_options, cb) => cb(new Error('cannot decode')));
        const wrapper = player();
        await play(wrapper);
        await flushPromises();
        expect(errors.getErrors).toEqual(['Error loading waveform for audio ' + KEY]);
        expect(audio.play).toHaveBeenCalledOnce();
    });

    it('draws the waveform once, in the background canvas, and copies it to the front one', async () => {
        const wrapper = player({ mode: 'wf', maxWidth: 200, height: 32 });
        await play(wrapper);
        await flushPromises();
        expect(WaveformData.createFromAudio).toHaveBeenCalledWith(expect.objectContaining({ scaleY: 32, scaleX: 250 }), expect.any(Function));
        expect(ctx.fill).toHaveBeenCalled();
        expect(ctx.drawImage).toHaveBeenCalled();
        const canvases = wrapper.findAll('canvas');
        expect(canvases[0].element.width).toBe(200); // never wider than max-width
    });

    it('real time mode draws bars as it plays instead', async () => {
        const wrapper = player({ mode: 'rt', renderMode: 'bars' });
        await play(wrapper);
        await flushPromises();
        audio.currentTime = 1;
        nextFrame();
        expect(ctx.fillRect).toHaveBeenCalled();
    });

    it('reads the audio only once for the next plays', async () => {
        const wrapper = player();
        await play(wrapper);
        await flushPromises();
        await wrapper.findAll('button')[1].trigger('click');
        await play(wrapper);
        await flushPromises();
        expect(WaveformData.createFromAudio).toHaveBeenCalledOnce();
        expect(audio.play).toHaveBeenCalledTimes(2);
    });

    it('plays when the audio of its own text arrives', async () => {
        const wrapper = player();
        kokoro.channel.emit(AUDIO_RESP, { audio: 'blob:audio', text: KEY });
        await flushPromises();
        expect(audio.play).toHaveBeenCalledOnce();
        expect(playing(wrapper)).toBe(true);
    });

    it('ignores the audio of another text', async () => {
        player();
        kokoro.channel.emit(AUDIO_RESP, { audio: 'blob:other', text: 'something else' });
        await flushPromises();
        expect(audio.play).not.toHaveBeenCalled();
    });

    it('stops when the audio of another text arrives while the chat is speaking', async () => {
        const wrapper = player();
        await play(wrapper);
        await flushPromises();
        await wrapper.setProps({ isAudioPlaying: true });
        kokoro.channel.emit(AUDIO_RESP, { audio: 'blob:other', text: 'something else' });
        await flushPromises();
        expect(audio.pause).toHaveBeenCalledOnce();
    });

    it('clicking the waveform seeks to that point', async () => {
        const wrapper = player({ mode: 'wf' });
        await play(wrapper);
        await flushPromises();
        const fg = wrapper.findAll('canvas')[1];
        fg.element.getBoundingClientRect = () => ({ left: 100, right: 300, top: 0, bottom: 32, width: 200 });
        fg.element.dispatchEvent(new MouseEvent('click', { clientX: 200, clientY: 10 }));
        expect(audio.currentTime).toBe(5); // half of 10 s
    });

    it('a click outside the waveform does nothing', async () => {
        const wrapper = player({ mode: 'wf' });
        await play(wrapper);
        await flushPromises();
        audio.currentTime = 3;
        const fg = wrapper.findAll('canvas')[1];
        fg.element.getBoundingClientRect = () => ({ left: 100, right: 300, top: 0, bottom: 32, width: 200 });
        fg.element.dispatchEvent(new MouseEvent('click', { clientX: 50, clientY: 10 }));
        expect(audio.currentTime).toBe(3);
    });

    it('unmounting while it plays cancels the animation', async () => {
        const wrapper = player();
        await play(wrapper);
        await flushPromises();
        wrapper.unmount();
        expect(cancelAnimationFrame).toHaveBeenCalled();
        wrappers = [];
    });

    // every message mounts one player (user messages too, hidden), and each created an AudioContext it never closed
    it('players do not create an AudioContext until one has to decode something, and then share it', async () => {
        const before = contexts.length;
        const many = [player(), player(), player(), player(), player()];
        expect(contexts.length - before).toBe(0);
        await play(many[0]);
        await play(many[1]);
        await flushPromises();
        expect(contexts.length).toBeLessThanOrEqual(Math.max(before, 1));
    });

    // off(type) without the handler removed the listeners of everybody: the other players and the widget's own
    it('unmounting a player leaves the other listeners of the audio event alone', async () => {
        const widgetListener = vi.fn();
        kokoro.channel.on(AUDIO_RESP, widgetListener);
        const gone = player();
        const stays = player();
        gone.unmount();
        wrappers = [stays];

        kokoro.channel.emit(AUDIO_RESP, { audio: 'blob:audio', text: KEY });
        await flushPromises();
        expect(widgetListener).toHaveBeenCalledOnce();
        expect(audio.play).toHaveBeenCalledOnce(); // the one that is still there answered
    });

    // the players share one <audio> element, so two can "play" at once and animate the same audio
    it.todo('only one player plays at a time');
});
