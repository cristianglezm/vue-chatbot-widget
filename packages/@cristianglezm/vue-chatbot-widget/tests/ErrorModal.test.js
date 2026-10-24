import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import ErrorModal from '../src/components/ErrorModal.vue';
import { useErrorStore } from '../src/stores/ErrorStore';

describe('ErrorModal', () => {
    let store, wrapper;
    const push = async (...errors) => {
        errors.forEach((e) => store.push(e));
        await nextTick();
    };

    beforeEach(() => {
        const pinia = createPinia();
        setActivePinia(pinia);
        store = useErrorStore();
        wrapper = mount(ErrorModal, { global: { plugins: [pinia] } });
    });

    it('shows nothing when there are no errors', () => {
        expect(wrapper.find('.ErrorModal').exists()).toBe(false);
    });

    it('shows the error and how many there are', async () => {
        await push('network down');
        expect(wrapper.text()).toContain('network down');
        expect(wrapper.find('.ErrorModal-content span').text()).toBe('1');
    });

    it('shows only the latest one, with the total', async () => {
        await push('first', 'second', 'third');
        expect(wrapper.findAll('.ErrorModal-content')).toHaveLength(1);
        expect(wrapper.text()).toContain('third');
        expect(wrapper.text()).not.toContain('first');
        expect(wrapper.find('.ErrorModal-content span').text()).toBe('3');
    });

    it('Ok dismisses the latest and shows the previous one', async () => {
        await push('first', 'second');
        await wrapper.find('button').trigger('click');
        expect(wrapper.text()).toContain('first');
        expect(wrapper.text()).not.toContain('second');
        expect(store.getErrors).toEqual(['first']);
    });

    it('Ok on the last one closes it', async () => {
        await push('only');
        await wrapper.find('button').trigger('click');
        expect(wrapper.find('.ErrorModal').exists()).toBe(false);
    });

    it('the cross dismisses all of them', async () => {
        await push('first', 'second', 'third');
        await wrapper.find('.close').trigger('click');
        expect(store.getLength).toBe(0);
        expect(wrapper.find('.ErrorModal').exists()).toBe(false);
    });

    it('shows the message of an Error object, that is what the workers report', async () => {
        await push(new Error('model failed'));
        expect(wrapper.text()).toContain('model failed');
    });

    it('an error that arrives later is shown', async () => {
        await push('first');
        await push('later');
        expect(wrapper.text()).toContain('later');
    });

    // a modal <dialog> (the options of the widget) makes everything outside of it inert and covers it: an error shown
    // as a plain element is behind it, nobody can read it or press Ok.
    describe('over another modal dialog', () => {
        it('is itself a modal dialog, opened when the error arrives', async () => {
            const shown = [];
            HTMLDialogElement.prototype.showModal = function(){ shown.push(this); this.setAttribute('open', ''); };
            wrapper.unmount();
            const pinia = createPinia();
            setActivePinia(pinia);
            store = useErrorStore();
            wrapper = mount(ErrorModal, { global: { plugins: [pinia] }, attachTo: document.body });
            await push('behind the options');
            expect(wrapper.find('.ErrorModal').element.tagName).toBe('DIALOG');
            expect(shown).toEqual([wrapper.find('.ErrorModal').element]);
            wrapper.unmount();
        });

        it('Escape dismisses the latest error instead of leaving a closed dialog with errors in it', async () => {
            await push('first', 'second');
            await wrapper.find('.ErrorModal').trigger('cancel');
            expect(wrapper.text()).toContain('first');
            expect(wrapper.text()).not.toContain('second');
        });
    });
});
