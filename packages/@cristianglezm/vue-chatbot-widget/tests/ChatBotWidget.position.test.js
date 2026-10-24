import { describe, it, expect, vi } from 'vitest';
import { nextTick } from 'vue';
import { useWidgetHarness } from './helpers/widgetHarness';

vi.mock('@huggingface/transformers', () => ({ pipeline: vi.fn(), env: {}, TextStreamer: class {}, mean_pooling: vi.fn(), RawAudio: class {} }));
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: vi.fn() }, TextSplitterStream: class {} }));

// jsdom has no layout: the widget is 300x120 closed and 300x500 with the chat open (window: 1024x768)
const stubLayout = () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(){
        const isWidget = this.classList.contains('chatbot-widget-core');
        const height = isWidget ? (this.querySelector('.chat-box') ? 500 : 120) : 0;
        const width = isWidget ? 300 : 0;
        return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON(){} };
    });
};
const place = (wrapper) => {
    const style = wrapper.find('.chatbot-widget-core').element.style;
    return { x: parseInt(style.left), y: parseInt(style.top) };
};

describe('ChatBotWidget: position', () => {
    const h = useWidgetHarness();

    it('starts in the bottom right corner', async () => {
        stubLayout();
        const w = await h.mountWidget();
        await vi.advanceTimersByTimeAsync(100);
        expect(place(w)).toEqual({ x: 1024 - 300 - 20, y: 768 - 120 - 20 });
    });

    it('opening the chat moves the widget up so the textarea and the button are inside the window', async () => {
        stubLayout();
        const w = await h.mountWidget();
        await vi.advanceTimersByTimeAsync(100);
        await h.open(w);
        await nextTick();
        expect(place(w).y).toBe(768 - 500 - 20);
        expect(place(w).x).toBe(1024 - 300 - 20);
    });

    it('a widget the user put where the open chat fits stays where it is', async () => {
        stubLayout();
        const w = await h.mountWidget();
        await vi.advanceTimersByTimeAsync(100);
        await w.find('.grab-hand').trigger('mousedown', { clientX: 704, clientY: 628 });
        document.dispatchEvent(Object.assign(new Event('mousemove'), { clientX: 104, clientY: 28 }));
        document.dispatchEvent(new Event('mouseup'));
        await nextTick();
        expect(place(w)).toEqual({ x: 104, y: 28 });
        await h.open(w);
        await nextTick();
        expect(place(w)).toEqual({ x: 104, y: 28 });
    });

    it('never moves the widget outside the top left corner', async () => {
        stubLayout();
        vi.stubGlobal('innerHeight', 300); // the open chat (500) does not fit at all
        const w = await h.mountWidget();
        await vi.advanceTimersByTimeAsync(100);
        await h.open(w);
        await nextTick();
        expect(place(w).y).toBe(0);
    });
});
