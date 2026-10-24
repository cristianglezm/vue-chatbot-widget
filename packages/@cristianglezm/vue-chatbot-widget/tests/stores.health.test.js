import { describe, it, expect, vi, afterEach } from 'vitest';
import { freshStores, flush } from './helpers/freshStores';

vi.mock('@huggingface/transformers', () => ({ RawAudio: class RawAudio{} }));

const reply = (body, ok = true) => ({ ok, json: async () => body });

describe.each([
    ['chatbot', 'useChatBotStore'],
    ['kokoro', 'useKokoroStore'],
])('%s store: remote server /health', (_name, useStore) => {
    afterEach(() => vi.unstubAllGlobals());

    // a remote model is "loaded" when the server says so, there is nothing to download.
    const check = async (respond) => {
        const fetchMock = vi.fn(respond);
        vi.stubGlobal('fetch', fetchMock);
        const store = (await freshStores())[useStore]();
        store.isLocal = false;
        store.remoteOptions.url = 'http://srv';
        await store.requestModelLoad();
        await flush();
        return { store, fetchMock };
    };

    it('asks <url>/health', async () => {
        const { fetchMock } = await check(async () => reply({ status: 'ok' }));
        expect(fetchMock).toHaveBeenCalledWith('http://srv/health');
    });

    it('is loaded when the server says it is ok', async () => {
        const { store } = await check(async () => reply({ status: 'ok' }));
        expect(store.isModelLoaded).toBe(true);
    });

    it('is NOT loaded while the server says it is still loading', async () => {
        const { store } = await check(async () => reply({ status: 'loading model' }));
        expect(store.isModelLoaded).toBe(false);
    });

    it('assumes it is loaded when the server has no /health (openAI, hf, ...)', async () => {
        const { store } = await check(async () => reply({}, false));
        expect(store.isModelLoaded).toBe(true);
    });

    it('assumes it is loaded when /health cannot be reached', async () => {
        const { store } = await check(async () => { throw new TypeError('Failed to fetch'); });
        expect(store.isModelLoaded).toBe(true);
    });
});
