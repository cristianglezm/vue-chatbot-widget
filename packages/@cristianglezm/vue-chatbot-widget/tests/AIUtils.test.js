import { describe, it, expect, vi, beforeAll } from 'vitest';
import { makeCaches } from './helpers/fakeCaches';

let utils;
beforeAll(async () => { utils = await import('../src/stores/AIUtils'); });

describe('isGPUAvailable', () => {
    it('is false without WebGPU', () => {
        vi.stubGlobal('navigator', { ...navigator, gpu: undefined });
        expect(utils.isGPUAvailable()).toBe(false);
    });
    it('is true with WebGPU', () => {
        vi.stubGlobal('navigator', { ...navigator, gpu: {} });
        expect(utils.isGPUAvailable()).toBe(true);
    });
    it('returns a boolean, not the gpu object', () => {
        vi.stubGlobal('navigator', { ...navigator, gpu: { requestAdapter() {} } });
        expect(utils.isGPUAvailable()).toBe(true);
    });
});

describe('ModelCache', () => {
    it('uses the transformers cache by default', async () => {
        const fake = makeCaches();
        vi.stubGlobal('caches', fake.caches);
        await new utils.ModelCache().match('https://x/a');
        expect(fake.opened).toEqual(['transformers-cache']);
    });

    it('uses the cache it was given', async () => {
        const fake = makeCaches();
        vi.stubGlobal('caches', fake.caches);
        const mc = new utils.ModelCache('mine');
        await mc.put('https://x/a', 'response');
        expect(fake.opened).toEqual(['mine']);
        expect(fake.urls('mine')).toEqual(['https://x/a']);
    });

    it('match returns what put stored, and undefined for the rest', async () => {
        vi.stubGlobal('caches', makeCaches().caches);
        const mc = new utils.ModelCache('mine');
        await mc.put('https://x/a', 'response-a');
        expect(await mc.match('https://x/a')).toBe('response-a');
        expect(await mc.match('https://x/b')).toBeUndefined();
    });

    it('two instances with the same name share the files', async () => {
        vi.stubGlobal('caches', makeCaches().caches);
        await new utils.ModelCache('shared').put('https://x/a', 'r');
        expect(await new utils.ModelCache('shared').match('https://x/a')).toBe('r');
        expect(await new utils.ModelCache('other').match('https://x/a')).toBeUndefined();
    });
});

describe('dataURLToBlob', () => {
    const read = (blob) => new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(new Uint8Array(r.result));
        r.readAsArrayBuffer(blob);
    });

    it('takes the type from the url', () => {
        expect(utils.dataURLToBlob('data:text/plain;base64,aGk=').type).toBe('text/plain');
        expect(utils.dataURLToBlob('data:image/png;base64,iVBORw0KGgo=').type).toBe('image/png');
    });

    it('decodes the bytes', async () => {
        const blob = utils.dataURLToBlob('data:text/plain;base64,aGVsbG8=');
        expect(blob.size).toBe(5);
        expect([...(await read(blob))]).toEqual([...new TextEncoder().encode('hello')]);
    });

    it('keeps bytes above 127 (binary)', async () => {
        const bytes = [0, 127, 128, 200, 255];
        const b64 = btoa(String.fromCharCode(...bytes));
        expect([...(await read(utils.dataURLToBlob(`data:application/octet-stream;base64,${b64}`)))]).toEqual(bytes);
    });

    it('an empty payload gives an empty blob', () => {
        expect(utils.dataURLToBlob('data:image/png;base64,').size).toBe(0);
    });
});
