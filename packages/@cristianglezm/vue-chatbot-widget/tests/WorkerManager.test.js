import { describe, it, expect, vi, beforeEach } from 'vitest';
import mitt from 'mitt';
import WorkerManager from '../src/stores/WorkerManager';
import { FakeWorker } from './helpers/FakeWorker';

describe('WorkerManager', () => {
    let channel, wm, worker;
    beforeEach(() => {
        channel = mitt();
        wm = new WorkerManager(channel);
        worker = new FakeWorker();
    });
    it('knows which workers were added', () => {
        expect(wm.has('a')).toBe(false);
        wm.addWorker('a', worker);
        expect(wm.has('a')).toBe(true);
    });
    it('forwards worker messages to the channel as "<name>#onmessage"', () => {
        const spy = vi.fn();
        wm.addWorker('a', worker);
        wm.onResponse('a', spy);
        worker.reply({ jobType: 'done' });
        expect(spy).toHaveBeenCalledWith({ jobType: 'done' });
    });
    it('forwards worker errors to the channel as a readable string', () => {
        const spy = vi.fn();
        wm.addWorker('a', worker);
        wm.onError('a', spy);
        worker.fail('boom', 'w.js', 7);
        expect(spy).toHaveBeenCalledWith('boom at w.js at line 7');
    });
    it('keeps workers isolated by name', () => {
        const other = new FakeWorker();
        const spyA = vi.fn(), spyB = vi.fn();
        wm.addWorker('a', worker);
        wm.addWorker('b', other);
        wm.onResponse('a', spyA);
        wm.onResponse('b', spyB);
        other.reply('for b');
        expect(spyA).not.toHaveBeenCalled();
        expect(spyB).toHaveBeenCalledWith('for b');
    });
    it('sends requests to the right worker', () => {
        wm.addWorker('a', worker);
        wm.sendRequest('a', { jobType: 'x' });
        expect(worker.posted).toEqual([{ jobType: 'x' }]);
    });
    it('logs instead of throwing when the worker does not exist', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => wm.sendRequest('nope', {})).not.toThrow();
        expect(err).toHaveBeenCalledOnce();
    });
    it('deleteWorker terminates it, removes it and its listeners', () => {
        const spy = vi.fn();
        wm.addWorker('a', worker);
        wm.onResponse('a', spy);
        wm.deleteWorker('a');
        expect(worker.terminated).toBe(true);
        expect(wm.has('a')).toBe(false);
        channel.emit('a#onmessage', 'late');
        expect(spy).not.toHaveBeenCalled();
    });
    it('deleteWorker on an unknown name does nothing', () => {
        expect(() => wm.deleteWorker('nope')).not.toThrow();
    });
});
