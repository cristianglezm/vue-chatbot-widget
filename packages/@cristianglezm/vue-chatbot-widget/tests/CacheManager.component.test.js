import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { defineComponent } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { makeCaches } from './helpers/fakeCaches';

let CacheManager;
beforeAll(async () => {
    vi.resetModules();
    CacheManager = (await import('../src/components/CacheManager.vue')).default;
});

const NAME = 'fe-chatbot-cache';
const HF = 'https://huggingface.co';
const LH = 'http://localhost';
const hf = (repo, file) => `${HF}/${repo}/resolve/main/${file}`;

// the real ConfirmModal needs <dialog>.showModal(): the stub records what was asked and lets the test answer
let asked;
const ConfirmModal = defineComponent({
    props: ['id', 'channel', 'on'],
    mounted() { this.channel.on(this.on, (req) => asked.push(req)); },
    template: '<div class="confirm-stub" />',
});

let fake, wrapper;
const mountIt = async (urls) => {
    fake = makeCaches({ [NAME]: urls });
    vi.stubGlobal('caches', fake.caches);
    wrapper = mount(CacheManager, { props: { cacheName: NAME }, global: { stubs: { ConfirmModal } } });
    await flushPromises();
};
const hostsSelect = () => wrapper.findAll('select')[0];
const filesSelect = () => wrapper.findAll('select')[1];
const options = (sel) => sel.findAll('option').map((o) => o.element.value);
const pickHost = async (host) => { await hostsSelect().setValue(host); };
const pickFiles = async (...files) => {
    for (const o of filesSelect().findAll('option')) o.element.selected = files.includes(o.element.value);
    await filesSelect().trigger('change');
};
const button = (text) => wrapper.findAll('button').find((b) => b.text().includes(text));

beforeEach(() => { asked = []; });
afterEach(() => wrapper?.unmount());

describe('CacheManager component', () => {
    const URLS = () => [hf('a/b', 'config.json'), hf('a/b', 'model.onnx'), `${LH}/m/config.json`];

    it('lists the hosts of the cache', async () => {
        await mountIt(URLS());
        expect(options(hostsSelect())).toEqual([HF, LH]);
    });

    it('shows no host for an empty cache', async () => {
        await mountIt([]);
        expect(options(hostsSelect())).toEqual([]);
    });

    it('lists the files of the selected host', async () => {
        await mountIt(URLS());
        await pickHost(HF);
        expect(options(filesSelect())).toEqual(['config.json', 'model.onnx']);
        await pickHost(LH);
        expect(options(filesSelect())).toEqual(['config.json']);
    });

    it('changing the host clears the selected files', async () => {
        await mountIt(URLS());
        await pickHost(HF);
        await pickFiles('model.onnx');
        expect(button('Delete Selected Files').element.disabled).toBe(false);
        await pickHost(LH);
        expect(button('Delete Selected Files').element.disabled).toBe(true);
    });

    it('the delete buttons need a selection', async () => {
        await mountIt(URLS());
        expect(button('Delete Selected Host').element.disabled).toBe(true);
        expect(button('Delete Selected Files').element.disabled).toBe(true);
        await pickHost(HF);
        expect(button('Delete Selected Host').element.disabled).toBe(false);
        expect(button('Delete Selected Files').element.disabled).toBe(true);
    });

    describe('deleting a host', () => {
        it('asks first and deletes nothing until it is confirmed', async () => {
            await mountIt(URLS());
            await pickHost(HF);
            await button('Delete Selected Host').trigger('click');
            expect(asked).toHaveLength(1);
            expect(asked[0].message).toMatch(/delete the selected host/i);
            expect(fake.deleted).toEqual([]);
            expect(wrapper.emitted('on-delete-host')).toBeUndefined();
        });

        it('deletes the host, refreshes the lists and tells the parent once confirmed', async () => {
            await mountIt(URLS());
            await pickHost(HF);
            await button('Delete Selected Host').trigger('click');
            await asked[0].onConfirm();
            await flushPromises();
            expect(fake.urls(NAME)).toEqual([`${LH}/m/config.json`]);
            expect(options(hostsSelect())).toEqual([LH]);
            expect(options(filesSelect())).toEqual([]);
            expect(button('Delete Selected Host').element.disabled).toBe(true);
            expect(wrapper.emitted('on-delete-host')).toHaveLength(1);
        });
    });

    describe('deleting files', () => {
        it('asks first, naming the files, and deletes nothing until it is confirmed', async () => {
            await mountIt(URLS());
            await pickHost(HF);
            await pickFiles('model.onnx');
            await button('Delete Selected Files').trigger('click');
            expect(asked).toHaveLength(1);
            expect(asked[0].message).toContain('model.onnx');
            expect(fake.deleted).toEqual([]);
        });

        it('deletes only the selected files, refreshes the list and tells the parent once confirmed', async () => {
            await mountIt(URLS());
            await pickHost(HF);
            await pickFiles('model.onnx');
            await button('Delete Selected Files').trigger('click');
            await asked[0].onConfirm();
            await flushPromises();
            expect(fake.urls(NAME)).toEqual([hf('a/b', 'config.json'), `${LH}/m/config.json`]);
            expect(options(filesSelect())).toEqual(['config.json']);
            expect(wrapper.emitted('on-delete-files')).toHaveLength(1);
            expect(wrapper.emitted('on-delete-host')).toBeUndefined();
        });

        it('a host left without files disappears from the list', async () => {
            await mountIt(URLS());
            await pickHost(LH);
            await pickFiles('config.json');
            await button('Delete Selected Files').trigger('click');
            await asked[0].onConfirm();
            await flushPromises();
            expect(options(hostsSelect())).toEqual([HF]);
            expect(button('Delete Selected Host').element.disabled).toBe(true);
        });
    });

    it('not confirming leaves the cache as it was', async () => {
        await mountIt(URLS());
        await pickHost(HF);
        await button('Delete Selected Host').trigger('click');
        await pickFiles(); // the user goes on without answering
        expect(fake.urls(NAME)).toEqual(URLS());
    });

    it('manages the cache it was given', async () => {
        await mountIt(URLS());
        expect(fake.opened).toContain(NAME);
        expect(new Set(fake.opened)).toEqual(new Set([NAME]));
    });
});
