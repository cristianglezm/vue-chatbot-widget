/**
 * Stand-in for a Web Worker (jsdom has none). Records what the stores send and lets a test
 * play the worker's side: `reply(data)` is a message from the worker, `fail()` an uncaught error in it.
 */
export class FakeWorker{
    constructor(){
        this.posted = [];
        this.terminated = false;
        this.onmessage = null;
        this.onerror = null;
    }
    postMessage(data){
        this.posted.push(data);
    }
    terminate(){
        this.terminated = true;
    }
    reply(data){
        this.onmessage?.({ data });
    }
    fail(message = 'boom', filename = 'worker.js', lineno = 1){
        this.onerror?.({ message, filename, lineno });
    }
}
