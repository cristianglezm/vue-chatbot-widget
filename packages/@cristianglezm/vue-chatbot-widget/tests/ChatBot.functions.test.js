import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// what the mocked packages recorded, shared with the factories below
const hf = vi.hoisted(() => ({ ctor: [], endpoints: [], streamers: [], client: {} }));

vi.mock('@huggingface/inference', () => ({
    HfInference: class {
        constructor(apiKey) { hf.ctor.push(apiKey); }
        endpoint(url) { hf.endpoints.push(url); return hf.client; }
    },
}));
vi.mock('@huggingface/transformers', () => ({
    pipeline: vi.fn(), env: {}, mean_pooling: vi.fn(), RawAudio: class {},
    TextStreamer: class {
        constructor(tokenizer, options) { this.tokenizer = tokenizer; this.options = options; hf.streamers.push(this); }
    },
}));
vi.mock('../src/stores/AIUtils', () => ({ ModelCache: class {}, isGPUAvailable: vi.fn() }));

// The test files share one module registry (isolate: false): ChatBot.js is imported after a reset so it is bound to the
// mocks of THIS file. @huggingface/jinja is the real one, the templates are really rendered.
let ChatBot, fns, pipeline, mean_pooling;
beforeAll(async () => {
    vi.resetModules();
    ({ pipeline, mean_pooling } = await import('@huggingface/transformers'));
    ({ ChatBot, ...fns } = await import('../src/stores/ChatBotStore/ChatBot'));
});

const server = (...parts) => parts.join('\n'); // a rendered ChatML, like the template of the models produces
const TEMPLATE = "<|im_start|>system\nTools: {% for t in tools %}{{ t.name }};{% endfor %} Docs: {{ documents | join(',') }}<|im_end|>\n"
    + "{% for m in messages %}<|im_start|>{{ m.role }}\n{{ m.content }}<|im_end|>\n{% endfor %}"
    + "{% if add_generation_prompt %}<|im_start|>assistant\n{% endif %}";
const tools = [{ name: 'weather', description: 'get the weather' }];
const documents = ['doc a', 'doc b'];
const messages = [{ role: 'user', content: 'hi' }];

describe('ChatBot.js: chat, streaming, remote and embeddings', () => {
    let model;
    // the pipeline transformers.js returns: a function that has a tokenizer and a model
    const makePipeline = (output) => {
        const fn = vi.fn(async () => output);
        fn.tokenizer = Object.assign(vi.fn(), { apply_chat_template: vi.fn(async () => 'RENDERED PROMPT') });
        fn.model = vi.fn();
        return fn;
    };
    const answering = (generated_text) => {
        model = makePipeline([{ generated_text }]);
        pipeline.mockResolvedValue(model);
    };

    beforeEach(() => {
        Object.assign(hf, { ctor: [], endpoints: [], streamers: [] });
        hf.client = { chatCompletion: vi.fn(), chatCompletionStream: vi.fn(), request: vi.fn() };
        pipeline.mockReset();
        mean_pooling.mockReset();
        ChatBot.instance = null;
        ChatBot.setModelOptions({ host: 'huggingface', model: 'org/model', device: 'CPU', dtype: 'q4' });
        answering('unused');
    });

    describe('chat, local', () => {
        it('without tools and documents the messages go to the model as they are', async () => {
            const output = [{ generated_text: [...messages, { role: 'assistant', content: 'hello' }] }];
            model = makePipeline(output);
            pipeline.mockResolvedValue(model);
            expect(await fns.chat(messages, {})).toBe(output);
            expect(model).toHaveBeenCalledWith(messages, { max_new_tokens: 256, do_sample: false });
        });

        it('with tools, documents and a template, the prompt is rendered and the reply read back as messages', async () => {
            answering(server('<|im_start|>system', 'be nice<|im_end|>', '<|im_start|>user', 'hi<|im_end|>', '<|im_start|>assistant', 'Hello!<|im_end|>'));
            const result = await fns.chat(messages, { tools, documents, chat_template: 'tpl' });
            expect(model.tokenizer.apply_chat_template).toHaveBeenCalledWith(messages,
                { chat_template: 'tpl', tokenize: false, add_generation_prompt: true, tools, documents });
            expect(model).toHaveBeenCalledWith('RENDERED PROMPT', { max_new_tokens: 256, do_sample: false });
            expect(result).toEqual([{ generated_text: [
                { role: 'system', content: 'be nice' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello!' },
            ] }]);
        });

        it('a template without tools or documents is not used', async () => {
            await fns.chat(messages, { chat_template: 'tpl' });
            expect(model.tokenizer.apply_chat_template).not.toHaveBeenCalled();
            expect(model).toHaveBeenCalledWith(messages, expect.any(Object));
        });

        it('tools without a template cannot be rendered, the messages go as they are', async () => {
            await fns.chat(messages, { tools, documents });
            expect(model.tokenizer.apply_chat_template).not.toHaveBeenCalled();
        });

        // `tools && documents && chat_template`: with only tools (or only documents) they never reached the model
        it.each([['only tools', { tools }], ['only documents', { documents }]])('%s and a template: it is used', async (_name, extra) => {
            await fns.chat(messages, { ...extra, chat_template: 'tpl' });
            expect(model.tokenizer.apply_chat_template).toHaveBeenCalledOnce();
            expect(model).toHaveBeenCalledWith('RENDERED PROMPT', expect.any(Object));
        });
    });

    describe('reading the reply back as messages (the template path)', () => {
        const reply = async (generated_text) => (await fns.chat(messages, { tools, documents, chat_template: 'tpl' }, answering(generated_text)))[0].generated_text;

        // the lines of a message were joined with a space: lists and code lost their lines
        it('keeps the lines of a message', async () => {
            expect(await reply(server('<|im_start|>assistant', 'line 1', '- item', '    indented<|im_end|>')))
                .toEqual([{ role: 'assistant', content: 'line 1\n- item\n    indented' }]);
        });

        // any line that began with system, user or assistant was taken for a role
        it('a line of a message that starts with a role name is not a role (without the special tokens)', async () => {
            expect(await reply(server('system', 'be nice', 'user', 'user manuals are long', 'assistant', 'ok')))
                .toEqual([
                    { role: 'system', content: 'be nice' },
                    { role: 'user', content: 'user manuals are long' },
                    { role: 'assistant', content: 'ok' },
                ]);
        });

        // currentRole was null: currentRole.trim() threw
        it('text without any role is one user message', async () => {
            expect(await reply('just text')).toEqual([{ role: 'user', content: 'just text' }]);
        });

        it('empty messages are dropped', async () => {
            expect(await reply(server('<|im_start|>user', 'hi<|im_end|>', '<|im_start|>assistant', '')))
                .toEqual([{ role: 'user', content: 'hi' }]);
        });
    });

    describe('streamingChat, local', () => {
        it('streams the tokens of the answer to the callback, without the prompt', async () => {
            const callback = vi.fn();
            const output = [{ generated_text: 'x' }];
            model = makePipeline(output);
            pipeline.mockResolvedValue(model);
            expect(await fns.streamingChat(messages, callback, {})).toBe(output);
            expect(hf.streamers).toHaveLength(1);
            expect(hf.streamers[0].tokenizer).toBe(model.tokenizer);
            expect(hf.streamers[0].options).toEqual({ skip_prompt: true, callback_function: callback });
            expect(model).toHaveBeenCalledWith(messages, { max_new_tokens: 256, do_sample: false, streamer: hf.streamers[0] });
        });

        it('with tools, documents and a template: rendered, streamed, and read back as messages', async () => {
            answering(server('<|im_start|>user', 'hi<|im_end|>', '<|im_start|>assistant', 'Hello!<|im_end|>'));
            const result = await fns.streamingChat(messages, vi.fn(), { tools, documents, chat_template: 'tpl' });
            expect(model.tokenizer.apply_chat_template).toHaveBeenCalledWith(messages,
                { chat_template: 'tpl', tokenize: false, tools, documents, add_generation_prompt: true });
            expect(model).toHaveBeenCalledWith('RENDERED PROMPT', expect.objectContaining({ streamer: hf.streamers[0] }));
            expect(result).toEqual([{ generated_text: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello!' }] }]);
        });

        it.each([['only tools', { tools }], ['only documents', { documents }]])('%s and a template: it is used', async (_name, extra) => {
            await fns.streamingChat(messages, vi.fn(), { ...extra, chat_template: 'tpl' });
            expect(model.tokenizer.apply_chat_template).toHaveBeenCalledOnce();
        });
    });

    describe('chat, remote', () => {
        const completion = (content) => hf.client.chatCompletion.mockResolvedValue({ choices: [{ message: { content } }] });

        it('asks the server of the options, with their defaults, and returns the text', async () => {
            completion('hello');
            expect(await fns.rChat(messages, {}, {})).toBe('hello');
            expect(hf.ctor).toEqual(['sk-no-key-required']);
            expect(hf.endpoints).toEqual(['http://localhost:8080']);
            expect(hf.client.chatCompletion).toHaveBeenCalledWith({
                model: 'HuggingFaceTB/SmolLM2-135M-Instruct', messages, max_tokens: 256, temperature: 0.4, min_p: 0.05, top_p: 0.95, top_k: 1,
            });
        });

        it('uses the options it is given', async () => {
            completion('hello');
            await fns.rChat(messages, { url: 'http://srv', api_key: 'k', max_tokens: 10, temperature: 1, min_p: 0.1, top_p: 0.5, top_k: 5, model: 'm' }, {});
            expect(hf.ctor).toEqual(['k']);
            expect(hf.endpoints).toEqual(['http://srv']);
            expect(hf.client.chatCompletion).toHaveBeenCalledWith({ model: 'm', messages, max_tokens: 10, temperature: 1, min_p: 0.1, top_p: 0.5, top_k: 5 });
        });

        it('with tools, documents and a template the server gets the rendered messages (the real template)', async () => {
            completion('hello');
            await fns.rChat(messages, {}, { tools, documents, chat_template: TEMPLATE });
            const sent = hf.client.chatCompletion.mock.calls[0][0].messages;
            expect(sent[0]).toEqual({ role: 'system', content: 'Tools: weather; Docs: doc a,doc b' });
            expect(sent[1]).toEqual({ role: 'user', content: 'hi' });
        });

        // the generation prompt of the template ends with an empty assistant turn, it went to the server as a message
        it('the generation prompt is not sent as an empty assistant message', async () => {
            completion('hello');
            await fns.rChat(messages, {}, { tools, documents, chat_template: TEMPLATE });
            expect(hf.client.chatCompletion.mock.calls[0][0].messages.map((m) => m.role)).toEqual(['system', 'user']);
        });

        it.each([['only tools', { tools }], ['only documents', { documents }]])('%s and a template: it is used', async (_name, extra) => {
            completion('hello');
            await fns.rChat(messages, {}, { ...extra, chat_template: TEMPLATE });
            expect(hf.client.chatCompletion.mock.calls[0][0].messages[0].role).toBe('system');
        });
    });

    describe('streaming chat, remote', () => {
        const chunks = (...list) => hf.client.chatCompletionStream.mockImplementation(async function* () { yield* list; });
        const content = (text) => ({ choices: [{ delta: { content: text } }] });

        it('gives the callback every piece of text and returns all of it', async () => {
            chunks(content('He'), { choices: [] }, { choices: [{ delta: {} }] }, {}, content('llo'));
            const callback = vi.fn();
            expect(await fns.rStreamingChat(messages, callback, {}, {})).toBe('Hello');
            expect(callback.mock.calls).toEqual([['He'], ['llo']]);
        });

        it('asks the server with the options and the messages', async () => {
            chunks(content('x'));
            await fns.rStreamingChat(messages, vi.fn(), { url: 'http://srv', api_key: 'k', model: 'm', max_tokens: 7 }, {});
            expect(hf.endpoints).toEqual(['http://srv']);
            expect(hf.client.chatCompletionStream).toHaveBeenCalledWith(expect.objectContaining({ model: 'm', messages, max_tokens: 7 }));
        });

        it('with tools and a template the server gets the rendered messages', async () => {
            chunks(content('x'));
            await fns.rStreamingChat(messages, vi.fn(), {}, { tools, chat_template: TEMPLATE });
            expect(hf.client.chatCompletionStream.mock.calls[0][0].messages.map((m) => m.role)).toEqual(['system', 'user']);
        });
    });

    describe('embeddings', () => {
        const embedder = (output) => {
            const tensor = { normalize: vi.fn(() => 'normalized') };
            model = makePipeline();
            model.tokenizer.mockResolvedValue({ attention_mask: 'mask' });
            model.model.mockResolvedValue(output(tensor));
            mean_pooling.mockReturnValue({ data: Float32Array.from([1, 2]) });
            pipeline.mockResolvedValue(model);
            return tensor;
        };

        it('is the mean pooling of the normalized hidden states', async () => {
            const tensor = embedder((t) => ({ last_hidden_states: t }));
            expect(await fns.getEmbeddings('some text')).toEqual([1, 2]);
            expect(model.tokenizer).toHaveBeenCalledWith('some text', { padding: true, truncation: true });
            expect(model.model).toHaveBeenCalledWith({ attention_mask: 'mask' }, { output_hidden_states: true });
            expect(tensor.normalize).toHaveBeenCalledWith(2, -1);
            expect(mean_pooling).toHaveBeenCalledWith('normalized', 'mask');
        });

        it.each(['logits', 'token_embeddings'])('uses %s when the model has no hidden states', async (field) => {
            const tensor = embedder((t) => ({ [field]: t }));
            await fns.getEmbeddings('some text');
            expect(tensor.normalize).toHaveBeenCalled();
        });

        it('remote: asks <url>/v1/embeddings', async () => {
            hf.client.request.mockResolvedValue([{ index: 0, embedding: [[0.1, 0.2]] }]);
            expect(await fns.getREmbeddings('some text', { url: 'http://srv', api_key: 'k', model: 'm' })).toEqual([0.1, 0.2]);
            expect(hf.ctor).toEqual(['k']);
            expect(hf.endpoints).toEqual(['http://srv/v1/embeddings']);
            expect(hf.client.request).toHaveBeenCalledWith({ model: 'm', content: 'some text' });
        });

        it('remote: without options it asks localhost', async () => {
            hf.client.request.mockResolvedValue([{ index: 0, embedding: [[1]] }]);
            await fns.getREmbeddings('some text');
            expect(hf.endpoints).toEqual(['http://localhost:8080/v1/embeddings']);
        });

        // todo: response[0].embedding[index] reads the shape of the native /embedding of llama.cpp; the OpenAI shape of
        // /v1/embeddings is { data: [{ embedding: [...], index }] } and would throw
        it.todo('remote: reads the OpenAI shape of /v1/embeddings (to check against the servers)');
    });
});
