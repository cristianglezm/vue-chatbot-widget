/**
 * Scripted stand-ins for the two workers, for the e2e tests: the real UI, the real stores, no model download.
 * The demo uses them when the page is opened with `?fakeWorkers` (see main.ts); they speak the worker protocol
 * of `chatbot.worker.js` and `kokoro.worker.js` and nothing else.
 *
 * Handy model ids: `fake/fail` makes the load fail, `fake/slow` loads slowly (to see the progress modal).
 * Handy messages: `/raw <text>` is answered with exactly `<text>` (ie: a tool call), `/fail` makes the job fail.
 */
type Message = { role: string, content: string };
type Handler = (data: any) => void | Promise<void>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

abstract class ScriptedWorker {
    onmessage: ((e: { data: any }) => void) | null = null;
    onerror: ((e: { message: string, filename: string, lineno: number }) => void) | null = null;
    terminated = false;
    /** every job the widget sent, for tests that want to look at it: `window.__fakeWorkerLog`. */
    protected abstract name: string;
    protected abstract jobs: Record<string, Handler>;

    postMessage(data: any){
        if(this.terminated) return;
        (window as any).__fakeWorkerLog?.push({ worker: this.name, ...structuredClone(data) });
        const job = this.jobs[data.jobType];
        if(!job) return;
        // asynchronous, like a real worker
        setTimeout(async () => {
            try{
                await job.call(this, data);
            }catch(error){
                this.reply({ jobType: 'error', error });
            }
        }, 0);
    }
    terminate(){
        this.terminated = true;
    }
    protected reply(data: any){
        if(!this.terminated) this.onmessage?.({ data });
    }
    protected async loadModel(data: any){
        const model = data.modelOptions?.model ?? '';
        const slow = model === 'fake/slow';
        const step = slow ? 400 : 15;
        const file = 'model.onnx';
        const progress = (event: any) => this.reply({
            jobType: 'updateProgressBar', eventName: 'ChatBotWidget#requestMultiProgressBar', event,
        });
        try{
            progress({ status: 'init', name: file, progress: 0, total: 100 });
            for(const p of [25, 50, 75, 100]){
                await sleep(step);
                progress({ status: 'update', name: file, progress: p });
            }
            if(model === 'fake/fail'){
                throw new Error(`could not load ${model}`);
            }
            this.reply({ jobType: 'updateBtnTitle', eventName: 'ChatBotModelOptions#updateBtnTitle', event: '' });
        }finally{
            progress({ status: 'finish' });
        }
    }
}

export const replyTo = (messages: Message[]) => {
    const last = [...messages].reverse().find((m) => m.role === 'user');
    const content = last?.content ?? '';
    if(content.startsWith('/fail')){
        throw new Error('scripted failure');
    }
    if(content.startsWith('/raw ')){
        return content.slice('/raw '.length);
    }
    return `Fake reply to: ${content}`;
};

export class FakeChatBotWorker extends ScriptedWorker {
    protected name = 'chatbot';
    protected jobs: Record<string, Handler> = {
        loadModel: (data) => this.loadModel(data),
        reset: () => {},
        chat: (data) => this.answer(data, false, false),
        rChat: (data) => this.answer(data, true, false),
        streaming: (data) => this.answer(data, false, true),
        rStreaming: (data) => this.answer(data, true, true),
        embeddings: (data) => this.embeddings(data),
        rEmbeddings: (data) => this.embeddings(data),
    };
    private async answer(data: any, remote: boolean, streaming: boolean){
        const messages: Message[] = data.messages;
        const text = replyTo(messages);
        if(streaming){
            for(const word of text.split(/(?<= )/)){
                await sleep(10);
                this.reply({ jobType: 'streaming', response: word });
            }
        }
        this.reply({
            jobType: 'response',
            // local replies are shaped like transformers.js', remote ones are the text
            response: remote ? text : [{ generated_text: [...messages, { role: 'assistant', content: text }] }],
        });
        this.reply({ jobType: 'done' });
    }
    private embeddings(data: any){
        for(const text of data.texts as string[]){
            // deterministic: the same text always gets the same vector, similar texts get similar ones
            const vector = new Array(8).fill(0);
            for(let i = 0; i < text.length; i++) vector[i % 8] += text.charCodeAt(i);
            const norm = Math.hypot(...vector) || 1;
            this.reply({ jobType: 'embeddings', type: data.type, text, embeddings: vector.map((v) => v / norm) });
        }
    }
}

/** 0.1 s of silence, a valid WAV file. */
const silentWav = () => {
    const sampleRate = 8000, samples = 800;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const str = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, samples * 2, true);
    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
};

export class FakeKokoroWorker extends ScriptedWorker {
    protected name = 'kokoro';
    protected jobs: Record<string, Handler> = {
        loadModel: (data) => this.loadModel(data),
        reset: () => {},
        audioGen: (data) => this.reply({ jobType: 'audioResp', audio: silentWav(), text: data.text }),
        rAudioGen: (data) => this.reply({ jobType: 'audioResp', audio: silentWav(), text: data.text }),
        streamingAudio: (data) => this.chunks(data),
        rStreamingAudio: (data) => this.chunks(data),
    };
    private async chunks(data: any){
        const sentences = (data.text as string).match(/[^.!?]+[.!?]*/g) ?? [data.text];
        for(const text of sentences){
            await sleep(10);
            this.reply({ jobType: 'streamingAudioChunk', audio: silentWav(), text: text.trim() });
        }
        this.reply({ jobType: 'streamingAudioChunk#done', text: data.text });
    }
}

export const fakeWorkers = {
    chatbot: () => new FakeChatBotWorker() as unknown as Worker,
    kokoro: () => new FakeKokoroWorker() as unknown as Worker,
};
