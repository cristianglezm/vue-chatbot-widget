import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import mitt from 'mitt';
import ConfirmModal from '../src/components/ConfirmModal.vue';

const ON = 'ChatBotWidget#ConfirmModal';

// jsdom has no <dialog>.showModal()/close()
const stubDialog = () => {
    HTMLDialogElement.prototype.showModal = vi.fn(function(){ this.setAttribute('open', ''); });
    HTMLDialogElement.prototype.close = vi.fn(function(){ this.removeAttribute('open'); });
};

describe('ConfirmModal', () => {
    let channel, wrapper, dialog, errors;
    const request = (name, onConfirm = vi.fn()) => ({
        title: `title ${name}`, message: `message ${name}`, btnNo: `no ${name}`, btnYes: `yes ${name}`, onConfirm,
    });
    // the modal waits 20 ms before it opens, so requests that arrive together are shown one after another
    const ask = async (...requests) => {
        requests.forEach((r) => channel.emit(ON, r));
        vi.advanceTimersByTime(25);
        await nextTick();
    };
    const title = () => wrapper.find('h2').text();
    const no = () => wrapper.findAll('button')[0].trigger('click');
    const yes = () => wrapper.findAll('button')[1].trigger('click');
    const cross = () => wrapper.find('.close').trigger('click');
    const escape = async () => {
        dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
        await nextTick();
    };

    beforeEach(() => {
        vi.useFakeTimers();
        stubDialog();
        errors = [];
        channel = mitt();
        wrapper = mount(ConfirmModal, {
            props: { id: 'confirm', channel, on: ON },
            attachTo: document.body,
            global: { config: { errorHandler: (e) => errors.push(e) } },
        });
        dialog = document.getElementById('confirm');
    });
    afterEach(() => wrapper.unmount());

    it('is closed until somebody asks', () => {
        expect(dialog.open).toBe(false);
    });

    it('opens with the title, the message and the text of both buttons', async () => {
        await ask(request('A'));
        expect(dialog.open).toBe(true);
        expect(title()).toBe('title A');
        expect(wrapper.text()).toContain('message A');
        expect(wrapper.findAll('button').map((b) => b.text())).toEqual(['no A', 'yes A']);
    });

    it('yes runs onConfirm and closes', async () => {
        const r = request('A');
        await ask(r);
        await yes();
        expect(r.onConfirm).toHaveBeenCalledOnce();
        expect(dialog.open).toBe(false);
    });

    it.each([['no', no], ['the cross', cross]])('%s does not run onConfirm and closes', async (_name, answer) => {
        const r = request('A');
        await ask(r);
        await answer();
        expect(r.onConfirm).not.toHaveBeenCalled();
        expect(dialog.open).toBe(false);
    });

    // commandsToConfirm are emitted in a row, they have to be asked in that order (the queue was a stack)
    it('several requests are asked in the order they arrived', async () => {
        await ask(request('A'), request('B'), request('C'));
        const seen = [title()];
        await no();
        seen.push(title());
        await no();
        seen.push(title());
        expect(seen).toEqual(['title A', 'title B', 'title C']);
    });

    it('stays open between requests and closes after the last one', async () => {
        await ask(request('A'), request('B'));
        await no();
        expect(dialog.open).toBe(true);
        await no();
        expect(dialog.open).toBe(false);
    });

    it('every request is answered on its own', async () => {
        const a = request('A'), b = request('B');
        await ask(a, b);
        await yes(); // A
        await no();  // B
        expect(a.onConfirm).toHaveBeenCalledOnce();
        expect(b.onConfirm).not.toHaveBeenCalled();
    });

    // a request that arrives while another one is on screen used to replace it before it was answered
    it('a request that arrives while another one is shown waits for its turn', async () => {
        const a = request('A'), b = request('B');
        await ask(a);
        await ask(b);
        expect(title()).toBe('title A');
        await yes();
        expect(a.onConfirm).toHaveBeenCalledOnce();
        expect(title()).toBe('title B');
        expect(dialog.open).toBe(true);
        await yes();
        expect(b.onConfirm).toHaveBeenCalledOnce();
        expect(dialog.open).toBe(false);
    });

    it('opens again for a request that comes after everything was answered', async () => {
        await ask(request('A'));
        await no();
        await ask(request('B'));
        expect(dialog.open).toBe(true);
        expect(title()).toBe('title B');
    });

    // Escape closed the dialog by itself, the requests that were still waiting never came back
    it('Escape answers no and moves on to the next request', async () => {
        const a = request('A');
        await ask(a, request('B'));
        await escape();
        expect(a.onConfirm).not.toHaveBeenCalled();
        expect(title()).toBe('title B');
        expect(dialog.open).toBe(true);
        await escape();
        expect(dialog.open).toBe(false);
    });

    it('a request without onConfirm does not break the buttons', async () => {
        await ask({ title: 't', message: 'm', btnNo: 'no', btnYes: 'yes' });
        await yes();
        expect(errors).toEqual([]);
        expect(dialog.open).toBe(false);
    });

    // off(type) without the handler removes the listeners of everybody on that event
    it('on unmount it only removes its own listener', () => {
        const other = vi.fn();
        channel.on(ON, other);
        wrapper.unmount();
        channel.emit(ON, request('A'));
        expect(other).toHaveBeenCalledOnce();
        wrapper = mount(ConfirmModal, { props: { id: 'confirm2', channel, on: ON }, attachTo: document.body });
    });

    it('a request that arrives right before it is unmounted does not open anything later', async () => {
        channel.emit(ON, request('A'));
        wrapper.unmount();
        vi.advanceTimersByTime(100);
        expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
        wrapper = mount(ConfirmModal, { props: { id: 'confirm3', channel, on: ON }, attachTo: document.body });
    });
});
