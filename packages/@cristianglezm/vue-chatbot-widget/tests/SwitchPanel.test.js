import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import SwitchPanel from '../src/components/SwitchPanel.vue';

const make = (mode = true) => mount(SwitchPanel, {
    props: { mode, left: 'Local', right: 'Remote' },
    slots: { left: '<p id="l">left content</p>', right: '<p id="r">right content</p>' },
});

describe('SwitchPanel', () => {
    it('shows both labels', () => {
        const w = make();
        expect(w.find('.switch-panel-left').text()).toBe('Local');
        expect(w.find('.switch-panel-right').text()).toBe('Remote');
    });

    it('renders the left slot, and only that one, when mode is true', () => {
        const w = make(true);
        expect(w.find('#l').exists()).toBe(true);
        expect(w.find('#r').exists()).toBe(false);
    });

    it('renders the right slot, and only that one, when mode is false', async () => {
        const w = make(false);
        expect(w.find('#r').exists()).toBe(true);
        expect(w.find('#l').exists()).toBe(false);
    });

    it('swaps the slot when the mode prop changes', async () => {
        const w = make(true);
        await w.setProps({ mode: false });
        expect(w.find('#r').exists()).toBe(true);
        expect(w.find('#l').exists()).toBe(false);
    });

    it('puts the ball on the side of the mode', async () => {
        const w = make(true);
        expect(w.find('.switch-panel-inner').classes()).toContain('switch-panel-ball-left');
        await w.setProps({ mode: false });
        expect(w.find('.switch-panel-inner').classes()).toContain('switch-panel-ball-right');
        expect(w.find('.switch-panel-inner').classes()).not.toContain('switch-panel-ball-left');
    });

    it('emits on-change when the ball is clicked', async () => {
        const w = make();
        await w.find('.switch-panel-ball').trigger('click');
        expect(w.emitted('on-change')).toHaveLength(1);
    });

    it('does not flip itself: the parent owns the mode', async () => {
        const w = make(true);
        await w.find('.switch-panel-ball').trigger('click');
        expect(w.props('mode')).toBe(true);
        expect(w.find('#l').exists()).toBe(true);
    });
});
