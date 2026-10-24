import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { makeCaches } from './helpers/fakeCaches';

let CacheManager;
beforeAll(async () => {
    vi.resetModules();
    ({ CacheManager } = await import('../src/stores/CacheManager'));
});

const HF = 'https://huggingface.co';
const LH = 'http://localhost';
const NAME = 'fe-chatbot-cache';
const hf = (repo, file) => `${HF}/${repo}/resolve/main/${file}`;

let fake;
const setup = (urls = []) => {
    fake = makeCaches({ [NAME]: urls });
    vi.stubGlobal('caches', fake.caches);
};
const ready = async (urls) => {
    setup(urls);
    const cm = new CacheManager(NAME);
    await cm.initCache(); // the constructor already started it, this one waits for the same job
    await vi.waitFor(() => expect(cm.isInitialized).toBe(true));
    return cm;
};

describe('CacheManager: reading the cache', () => {
    it('groups the files by host', async () => {
        const cm = await ready([hf('a/b', 'config.json'), hf('a/b', 'model.onnx'), `${LH}:8080/x/config.json`]);
        expect(cm.size()).toBe(2);
        expect(cm.cacheHosts.get(HF)).toEqual(['config.json', 'model.onnx']);
        expect(cm.cacheHosts.get(`${LH}:8080`)).toEqual(['config.json']);
    });

    it('lists a file name once even if two models have it', async () => {
        const cm = await ready([hf('a/b', 'config.json'), hf('c/d', 'config.json')]);
        expect(cm.cacheHosts.get(HF)).toEqual(['config.json']);
    });

    it('an empty cache has no hosts', async () => {
        const cm = await ready([]);
        expect(cm.size()).toBe(0);
    });

    it('opens the cache that was asked for, once', async () => {
        setup([hf('a/b', 'config.json')]);
        const cm = new CacheManager(NAME); // the constructor already started reading
        await Promise.all([cm.initCache(), cm.initCache()]);
        await cm.initCache();
        expect(fake.opened).toEqual([NAME]);
        expect(cm.size()).toBe(1);
    });

    it('reload reads it again: new files appear, deleted ones go', async () => {
        const cm = await ready([hf('a/b', 'config.json')]);
        fake.stores.set(NAME, [{ url: `${LH}/m/model.onnx` }]);
        await cm.reload();
        expect([...cm.cacheHosts.keys()]).toEqual([LH]);
        expect(cm.hasFiles(HF, ['config.json'])).toBe(false);
    });

    it('without Cache Storage (plain http) it logs and stays empty', async () => {
        vi.stubGlobal('caches', undefined);
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const cm = new CacheManager(NAME);
        await cm.initCache();
        await vi.waitFor(() => expect(err).toHaveBeenCalled());
        expect(cm.size()).toBe(0);
        expect(cm.isInitialized).toBe(false);
    });

    it('a failing open logs and can be retried', async () => {
        setup([hf('a/b', 'config.json')]);
        fake.failOpen = new Error('denied');
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const cm = new CacheManager(NAME);
        await vi.waitFor(() => expect(err).toHaveBeenCalled());
        fake.failOpen = null;
        await cm.initCache();
        expect(cm.size()).toBe(1);
    });
});

describe('CacheManager.hasFiles', () => {
    let cm;
    beforeEach(async () => { cm = await ready([hf('a/b', 'config.json'), hf('a/b', 'model.onnx')]); });

    it('is true when every file is there', () => {
        expect(cm.hasFiles(HF, ['config.json', 'model.onnx'])).toBe(true);
    });
    it('is false when one is missing', () => {
        expect(cm.hasFiles(HF, ['config.json', 'tokenizer.json'])).toBe(false);
    });
    it('is false for an unknown host', () => {
        expect(cm.hasFiles(LH, ['config.json'])).toBe(false);
    });
    it('needs the exact name, not a part of it', () => {
        expect(cm.hasFiles(HF, ['config'])).toBe(false);
    });
});

describe('CacheManager.deleteHost', () => {
    it('removes every file of the host and only those', async () => {
        const cm = await ready([hf('a/b', 'config.json'), hf('c/d', 'model.onnx'), `${LH}/m/config.json`]);
        await cm.deleteHost(HF);
        expect(fake.urls(NAME)).toEqual([`${LH}/m/config.json`]);
        expect([...cm.cacheHosts.keys()]).toEqual([LH]);
    });

    it('an unknown host deletes nothing', async () => {
        const cm = await ready([hf('a/b', 'config.json')]);
        await cm.deleteHost('https://example.org');
        expect(fake.deleted).toEqual([]);
        expect(cm.size()).toBe(1);
    });

    // host "http://localhost" is a prefix of "http://localhost:3000"
    it('does not touch another host that starts with the same text', async () => {
        const cm = await ready([`${LH}/m/config.json`, `${LH}:3000/m/config.json`]);
        await cm.deleteHost(LH);
        expect(fake.urls(NAME)).toEqual([`${LH}:3000/m/config.json`]);
        expect([...cm.cacheHosts.keys()]).toEqual([`${LH}:3000`]);
    });

    it('a file of that host is not found afterwards (no stale requests)', async () => {
        const cm = await ready([hf('a/b', 'config.json')]);
        await cm.deleteHost(HF);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        fake.deleted.length = 0;
        await cm.deleteFilesFrom(HF, ['config.json']);
        expect(fake.deleted).toEqual([]);
        expect(warn).toHaveBeenCalled();
    });

    it('a failure is logged and the host stays listed', async () => {
        const cm = await ready([hf('a/b', 'config.json')]);
        fake.failDelete = new Error('boom');
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await cm.deleteHost(HF);
        expect(err).toHaveBeenCalled();
        expect(cm.hasFiles(HF, ['config.json'])).toBe(true);
    });
});

describe('CacheManager.deleteFilesFrom', () => {
    it('deletes the named files', async () => {
        const cm = await ready([hf('a/b', 'config.json'), hf('a/b', 'model.onnx'), hf('a/b', 'tokenizer.json')]);
        await cm.deleteFilesFrom(HF, ['model.onnx', 'tokenizer.json']);
        expect(fake.urls(NAME)).toEqual([hf('a/b', 'config.json')]);
        expect(cm.cacheHosts.get(HF)).toEqual(['config.json']);
    });

    // 'tokenizer_config.json' ends with 'config.json'
    it('config.json does not delete tokenizer_config.json or generation_config.json', async () => {
        const cm = await ready([
            hf('a/b', 'tokenizer_config.json'), hf('a/b', 'generation_config.json'), hf('a/b', 'config.json'),
        ]);
        await cm.deleteFilesFrom(HF, ['config.json']);
        expect(fake.urls(NAME).sort()).toEqual([hf('a/b', 'generation_config.json'), hf('a/b', 'tokenizer_config.json')]);
        expect(cm.cacheHosts.get(HF).sort()).toEqual(['generation_config.json', 'tokenizer_config.json']);
    });

    // the list shows one config.json for the host, so the user means all of them
    it('deletes the file of every model that has it (the list shows one name per host)', async () => {
        const cm = await ready([hf('a/b', 'config.json'), hf('c/d', 'config.json'), hf('c/d', 'model.onnx')]);
        await cm.deleteFilesFrom(HF, ['config.json']);
        expect(fake.urls(NAME)).toEqual([hf('c/d', 'model.onnx')]);
        await cm.reload();
        expect(cm.cacheHosts.get(HF)).toEqual(['model.onnx']);
    });

    it('only the host asked for', async () => {
        const cm = await ready([hf('a/b', 'config.json'), `${LH}/m/config.json`]);
        await cm.deleteFilesFrom(HF, ['config.json']);
        expect(fake.urls(NAME)).toEqual([`${LH}/m/config.json`]);
        expect(cm.cacheHosts.get(LH)).toEqual(['config.json']);
    });

    it('removes the host when its last file goes', async () => {
        const cm = await ready([hf('a/b', 'config.json')]);
        await cm.deleteFilesFrom(HF, ['config.json']);
        expect(cm.size()).toBe(0);
    });

    it('a file that is not there is reported and does not stop the others', async () => {
        const cm = await ready([hf('a/b', 'config.json'), hf('a/b', 'model.onnx')]);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await cm.deleteFilesFrom(HF, ['nope.bin', 'model.onnx']);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(fake.urls(NAME)).toEqual([hf('a/b', 'config.json')]);
    });

    it('a failure is logged', async () => {
        const cm = await ready([hf('a/b', 'config.json')]);
        fake.failDelete = new Error('boom');
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await cm.deleteFilesFrom(HF, ['config.json']);
        expect(err).toHaveBeenCalled();
        expect(cm.hasFiles(HF, ['config.json'])).toBe(true);
    });
});
