import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import mitt from 'mitt';
import MultiProgressModal from '../src/components/MultiProgressModal.vue';

const ON = 'ChatBotWidget#requestMultiProgressBar';

// jsdom has no <dialog>.showModal()/close()
const stubDialog = () => {
    HTMLDialogElement.prototype.showModal = vi.fn(function(){ this.setAttribute('open', ''); });
    HTMLDialogElement.prototype.close = vi.fn(function(){ this.removeAttribute('open'); });
};

describe('MultiProgressModal', () => {
    let channel, wrapper, dialog;
    const emit = async (event) => { channel.emit(ON, event); await nextTick(); };
    const setup = (onLoad = () => {}) => emit({ status: 'setup', title: 'downloading', onLoad });
    const init = (name, total = 100) => emit({ status: 'init', name, progress: 0, total });
    const update = (name, progress) => emit({ status: 'update', name, progress });
    const bar = (name) => document.getElementById('Bar-' + name);

    beforeEach(() => {
        vi.useFakeTimers();
        stubDialog();
        channel = mitt();
        wrapper = mount(MultiProgressModal, { props: { id: 'mp', channel, on: ON }, attachTo: document.body });
        dialog = document.getElementById('mp');
    });
    afterEach(() => {
        wrapper.unmount();
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    it('opens on setup, shows the title and calls onLoad', async () => {
        const onLoad = vi.fn();
        await setup(onLoad);
        expect(dialog.open).toBe(true);
        expect(wrapper.text()).toContain('downloading');
        expect(onLoad).toHaveBeenCalledOnce();
    });

    it('shows one bar per file with its progress', async () => {
        await setup();
        await init('config.json');
        await init('model.onnx');
        await update('model.onnx', 50);

        expect(wrapper.text()).toContain('50.00 / 100');
        expect(bar('model.onnx').getAttribute('style')).toContain('width: 50%');
        expect(document.querySelector('[role=progressbar][aria-valuenow="50"]')).not.toBeNull();
    });

    it('labels every bar with its file name (aria-labelledby points to an existing id)', async () => {
        await setup();
        await init('config.json');
        const labelled = document.querySelector('[role=progressbar]').getAttribute('aria-labelledby');
        expect(document.getElementById(labelled)).not.toBeNull();
    });

    // transformers.js downloads config/tokenizer first and only initiates the model file after the config is
    // loaded, so the small files can all be finished before the big one even starts.
    it('keeps showing progress when the small files finish before the model file is initiated', async () => {
        await setup();
        await init('config.json');
        await init('tokenizer.json');
        await update('config.json', 100);
        await update('tokenizer.json', 100);
        vi.advanceTimersByTime(50);       // the model file starts a moment later
        await init('model.onnx');
        await update('model.onnx', 40);

        expect(dialog.open).toBe(true);
        expect(wrapper.text()).toContain('40.00 / 100');
        expect(bar('model.onnx').getAttribute('style')).toContain('width: 40%');
    });

    it('closes by itself once every file is done and nothing else starts', async () => {
        await setup();
        await init('model.onnx');
        await update('model.onnx', 100);
        vi.advanceTimersByTime(5000);
        expect(dialog.open).toBe(false);
    });

    it('a finish event closes it right away, whatever is pending', async () => {
        await setup();
        await init('model.onnx');
        await update('model.onnx', 10);
        await emit({ status: 'finish' });
        expect(dialog.open).toBe(false);
    });

    it('a later setup starts from a clean list', async () => {
        await setup();
        await init('old.onnx');
        await emit({ status: 'finish' });
        await setup();
        expect(wrapper.text()).not.toContain('old.onnx');
    });
});
