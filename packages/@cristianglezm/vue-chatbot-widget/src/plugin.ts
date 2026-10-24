import { createPinia } from 'pinia';

import { useChatBotStore } from './stores/ChatBotStore';
import { useErrorStore } from './stores/ErrorStore';
import { useKokoroStore } from './stores/KokoroStore';
import { useVectorStore } from './stores/vectorStore';

/**
 * Builds a worker. The library does not bundle its workers (they pull in onnxruntime, ~20 MB of wasm),
 * your bundler builds them: import the worker with `?worker` and wrap it in a function.
 *
 * ```ts
 * import ChatBotWorker from '@cristianglezm/vue-chatbot-widget/workers/chatbot.worker?worker';
 * const workers = { chatbot: () => new ChatBotWorker() };
 * ```
 */
export type WorkerFactory = () => Worker;

export interface ChatBotWorkers {
    /** needed to chat, local or remote. */
    chatbot?: WorkerFactory;
    /** needed for text to speech, local or remote. */
    kokoro?: WorkerFactory;
}

export interface ChatBotPluginOptions {
    pinia?: ReturnType<typeof createPinia>;
    workers?: ChatBotWorkers;
}

export const initStores = (options: ChatBotPluginOptions = {}) => {
    if(!options.pinia){
        options.pinia = createPinia();
    }
    // @ts-ignore
    useErrorStore(options.pinia);
    // @ts-ignore
    const chatbot = useChatBotStore(options.pinia);
    // @ts-ignore
    useVectorStore(options.pinia);
    // @ts-ignore
    const kokoro = useKokoroStore(options.pinia);
    if(options.workers?.chatbot){
        chatbot.registerWorker(options.workers.chatbot);
    }
    if(options.workers?.kokoro){
        kokoro.registerWorker(options.workers.kokoro);
    }
    return options.pinia;
};
