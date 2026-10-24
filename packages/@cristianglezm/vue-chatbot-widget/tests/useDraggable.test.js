import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { useDraggable } from '../src/composables/useDraggable';

let wrapper;
const make = () => {
    let api;
    wrapper = mount(defineComponent({ setup() { api = useDraggable(); return {}; }, template: '<div/>' }));
    return api;
};
const fire = (type, init = {}) => document.dispatchEvent(Object.assign(new Event(type), init));
const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });
afterEach(() => wrapper?.unmount());

describe('useDraggable', () => {
    it('starts at 0,0 and not dragging', () => {
        const d = make();
        expect(d.position.value).toEqual({ x: 0, y: 0 });
        expect(d.isDragging.value).toBe(false);
    });

    it('setPosition moves it', () => {
        const d = make();
        d.setPosition({ x: 10, y: 20 });
        expect(d.position.value).toEqual({ x: 10, y: 20 });
    });

    it('follows the mouse keeping the grab point', () => {
        const d = make();
        d.setPosition({ x: 100, y: 100 });
        d.onMouseDown({ clientX: 110, clientY: 130 }); // grabbed 10,30 inside
        expect(d.isDragging.value).toBe(true);
        fire('mousemove', { clientX: 210, clientY: 230 });
        expect(d.position.value).toEqual({ x: 200, y: 200 });
    });

    it('a mouse move without grabbing does nothing', () => {
        const d = make();
        fire('mousemove', { clientX: 50, clientY: 50 });
        expect(d.position.value).toEqual({ x: 0, y: 0 });
    });

    it('mouseup drops it', () => {
        const d = make();
        d.onMouseDown({ clientX: 0, clientY: 0 });
        fire('mouseup');
        expect(d.isDragging.value).toBe(false);
        fire('mousemove', { clientX: 80, clientY: 80 });
        expect(d.position.value).toEqual({ x: 0, y: 0 });
    });

    it('follows a finger and drops it on touchend', () => {
        const d = make();
        d.setPosition({ x: 5, y: 5 });
        d.onTouchStart(touch(15, 25));
        expect(d.isDragging.value).toBe(true);
        fire('touchmove', touch(115, 125));
        expect(d.position.value).toEqual({ x: 105, y: 105 });
        fire('touchend');
        expect(d.isDragging.value).toBe(false);
        fire('touchmove', touch(500, 500));
        expect(d.position.value).toEqual({ x: 105, y: 105 });
    });

    it('a second drag starts from where the first one ended', () => {
        const d = make();
        d.onMouseDown({ clientX: 0, clientY: 0 });
        fire('mousemove', { clientX: 40, clientY: 40 });
        fire('mouseup');
        d.onMouseDown({ clientX: 45, clientY: 45 });
        fire('mousemove', { clientX: 55, clientY: 55 });
        expect(d.position.value).toEqual({ x: 50, y: 50 });
    });

    describe('what it leaves behind', () => {
        it('every document listener it adds is removed on unmount', () => {
            const add = vi.spyOn(document, 'addEventListener');
            const remove = vi.spyOn(document, 'removeEventListener');
            make();
            wrapper.unmount();
            const added = add.mock.calls.map(([t, h]) => [t, h]);
            expect(added.map(([t]) => t).sort()).toEqual(['mousemove', 'mouseup', 'touchend', 'touchmove']);
            for (const [type, handler] of added) {
                expect(remove.mock.calls.some(([t, h]) => t === type && h === handler), type).toBe(true);
            }
            expect(add.mock.calls.length).toBe(4);
        });

        it('a finger moving after unmount does nothing', () => {
            const d = make();
            d.onTouchStart(touch(0, 0));
            wrapper.unmount();
            fire('touchmove', touch(90, 90));
            expect(d.position.value).toEqual({ x: 0, y: 0 });
        });

        it('two instances do not interfere', () => {
            const a = make();
            const first = wrapper;
            const b = make();
            first.unmount();
            b.onMouseDown({ clientX: 0, clientY: 0 });
            fire('mousemove', { clientX: 7, clientY: 7 });
            expect(b.position.value).toEqual({ x: 7, y: 7 });
            expect(a.position.value).toEqual({ x: 0, y: 0 });
        });
    });
});
