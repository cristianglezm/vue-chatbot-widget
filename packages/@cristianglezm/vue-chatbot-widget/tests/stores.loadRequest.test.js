import { describe, it, expect, vi } from 'vitest';
import { freshStores } from './helpers/freshStores';
import { FakeWorker } from './helpers/FakeWorker';

vi.mock('@huggingface/transformers', () => ({ RawAudio: class RawAudio{} }));

describe.each([
    ['chatbot', 'useChatBotStore'],
    ['kokoro', 'useKokoroStore'],
])('%s store: requestModelLoad', (_name, useStore) => {
    const request = async (...args) => {
        const store = (await freshStores())[useStore]();
        const worker = new FakeWorker();
        store.registerWorker(() => worker);
        await store.requestModelLoad(...args);
        return worker.posted[0];
    };

    it('asks the worker to load the model with the current options', async () => {
        const msg = await request();
        expect(msg).toMatchObject({ jobType: 'loadModel', modelOptions: expect.objectContaining({ host: expect.any(String) }) });
    });

    it('does not force a reload by default', async () => {
        expect((await request()).force).toBe(false);
    });

    it('can force a reload of the model that is already loaded', async () => {
        expect((await request(true)).force).toBe(true);
    });
});
