import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('@huggingface/transformers', () => ({
    pipeline: vi.fn(), env: {}, TextStreamer: class {}, mean_pooling: vi.fn(), RawAudio: class {},
}));
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: vi.fn() }, TextSplitterStream: class {} }));
vi.mock('../src/stores/AIUtils', () => ({
    ModelCache: class { constructor(key) { this.key = key; } },
    isGPUAvailable: vi.fn(),
}));

// The test files share one module registry (isolate: false). The loaders are imported after a reset, so they are
// bound to the mocks of THIS file, not to the ones of a file that ran before.
let pipeline, env, KokoroTTS, ChatBot, Kokoro;
beforeAll(async () => {
    vi.resetModules();
    ({ pipeline, env } = await import('@huggingface/transformers'));
    ({ KokoroTTS } = await import('kokoro-js'));
    ({ ChatBot } = await import('../src/stores/ChatBotStore/ChatBot'));
    ({ Kokoro } = await import('../src/stores/KokoroStore/Kokoro'));
});

// both loaders are static singletons that load a model through transformers.js / kokoro-js
const loaders = {
    ChatBot: { loader: () => ChatBot, build: () => pipeline, buildArgs: (m) => [ChatBot.task, m.model] },
    Kokoro: { loader: () => Kokoro, build: () => KokoroTTS.from_pretrained, buildArgs: (m) => [m.model] },
};

describe.each(Object.keys(loaders))('%s loader', (name) => {
    let Loader, build, buildArgs;
    beforeAll(() => {
        Loader = loaders[name].loader();
        build = loaders[name].build();
        buildArgs = loaders[name].buildArgs;
    });

    const options = (extra = {}) => ({ host: 'huggingface', model: 'org/model', device: 'CPU', dtype: 'q4', voice: 'af_bella', ...extra });
    const model = () => ({ dispose: vi.fn() });

    beforeEach(() => {
        build.mockReset();
        build.mockImplementation(async () => model());
        Loader.instance = null;
        Loader.setModelOptions(options());
    });

    it('nothing is loaded until getInstance is called', () => {
        expect(Loader.hasModelLoaded()).toBe(false);
        expect(build).not.toHaveBeenCalled();
    });

    it('loads the model once and shares it', async () => {
        const a = await Loader.getInstance();
        const b = await Loader.getInstance();
        expect(a).toBe(b);
        expect(build).toHaveBeenCalledOnce();
        expect(Loader.hasModelLoaded()).toBe(true);
    });

    it('loads the configured model with its dtype and the progress callback', async () => {
        const cb = vi.fn();
        Loader.setModelOptions(options({ dtype: 'fp16' }));
        await Loader.getInstance(cb);
        expect(build).toHaveBeenCalledWith(...buildArgs(options()), expect.objectContaining({ dtype: 'fp16', device: 'wasm', progress_callback: cb }));
    });

    it('CPU runs on wasm, anything else on webgpu', async () => {
        Loader.setModelOptions(options({ device: 'GPU' }));
        await Loader.getInstance();
        expect(build.mock.calls[0].at(-1).device).toBe('webgpu');
    });

    it('localhost models are read from http://localhost/ and never downloaded', async () => {
        Loader.setModelOptions(options({ host: 'localhost' }));
        await Loader.getInstance();
        expect(env).toMatchObject({ localModelPath: 'http://localhost/', allowLocalModels: true, allowRemoteModels: false });
    });

    it('reset forgets the model so the next getInstance loads again', async () => {
        await Loader.getInstance();
        await Loader.reset();
        expect(Loader.hasModelLoaded()).toBe(false);
        await Loader.getInstance();
        expect(build).toHaveBeenCalledTimes(2);
    });

    it('reset on something that was never loaded does nothing', async () => {
        await expect(Loader.reset()).resolves.toBeUndefined();
    });

    // B2: a failed load used to stay cached as a rejected promise, so every later attempt failed with the same error
    describe('after a failed load', () => {
        beforeEach(() => {
            build.mockRejectedValueOnce(new Error('network down'));
        });

        it('the failure is reported to the caller', async () => {
            await expect(Loader.getInstance()).rejects.toThrow('network down');
        });

        it('is not loaded, and the failure is not kept', async () => {
            await Loader.getInstance().catch(() => {});
            expect(Loader.hasModelLoaded()).toBe(false);
        });

        it('the next getInstance tries again', async () => {
            await Loader.getInstance().catch(() => {});
            await expect(Loader.getInstance()).resolves.toBeDefined();
            expect(build).toHaveBeenCalledTimes(2);
        });

        it('reset does not throw', async () => {
            await Loader.getInstance().catch(() => {});
            await expect(Loader.reset()).resolves.toBeUndefined();
        });

        it('callers waiting on the same load all get the failure', async () => {
            const results = await Promise.allSettled([Loader.getInstance(), Loader.getInstance()]);
            expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
            expect(build).toHaveBeenCalledOnce();
        });
    });
});

describe('ChatBot.reset disposes the model, Kokoro.reset only forgets it', () => {
    it('ChatBot', async () => {
        const dispose = vi.fn();
        pipeline.mockReset();
        pipeline.mockResolvedValue({ dispose });
        ChatBot.instance = null;
        await ChatBot.getInstance();
        await ChatBot.reset();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('Kokoro', async () => {
        const dispose = vi.fn();
        KokoroTTS.from_pretrained.mockReset();
        KokoroTTS.from_pretrained.mockResolvedValue({ dispose });
        Kokoro.instance = null;
        await Kokoro.getInstance();
        await Kokoro.reset();
        expect(dispose).not.toHaveBeenCalled();
    });
});
