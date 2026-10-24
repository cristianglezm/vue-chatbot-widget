import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ToolTip from '../src/components/ToolTip.vue';

const make = () => mount(ToolTip, { props: { info: 'what it does' } });
const tip = (w) => w.find('.tipInfo');
const box = (w) => w.find('.infoBox');

describe('ToolTip', () => {
    it('is hidden at first, the "i" is shown', () => {
        const w = make();
        expect(tip(w).text()).toBe('i');
        expect(box(w).exists()).toBe(false);
    });

    it('shows the info while the pointer is over it, and hides it when it leaves', async () => {
        const w = make();
        await tip(w).trigger('mouseenter');
        expect(box(w).text()).toBe('what it does');
        await tip(w).trigger('mouseleave');
        expect(box(w).exists()).toBe(false);
    });

    // a tap on a touch screen fires mouseenter and then click
    it('a tap (mouseenter, click) leaves the info visible', async () => {
        const w = make();
        await tip(w).trigger('mouseenter');
        await tip(w).trigger('click');
        expect(box(w).exists()).toBe(true);
    });

    it('a click without hover (keyboard, programmatic) shows it', async () => {
        const w = make();
        await tip(w).trigger('click');
        expect(box(w).exists()).toBe(true);
    });

    it('hover, click and leave keeps it open until the next click', async () => {
        const w = make();
        await tip(w).trigger('mouseenter');
        await tip(w).trigger('click');
        await tip(w).trigger('mouseleave');
        expect(box(w).exists()).toBe(true);
        await tip(w).trigger('click');
        expect(box(w).exists()).toBe(false);
    });

    it('hover then leave twice never gets inverted', async () => {
        const w = make();
        for (let i = 0; i < 3; i++) {
            await tip(w).trigger('mouseenter');
            expect(box(w).exists()).toBe(true);
            await tip(w).trigger('mouseleave');
            expect(box(w).exists()).toBe(false);
        }
    });
});
