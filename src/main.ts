import { createApp } from 'vue'
import './style.css'
import App from './App.vue';
import { createPinia } from 'pinia';
//import ChatBotPlugin from '@cristianglezm/vue-chatbot-widget';
import { initStores } from '@cristianglezm/vue-chatbot-widget';
import type { ChatBotWorkers } from '@cristianglezm/vue-chatbot-widget';
// the library does not bundle its workers, your bundler builds them (`?worker`).
import ChatBotWorker from '@cristianglezm/vue-chatbot-widget/workers/chatbot.worker?worker';
import KokoroWorker from '@cristianglezm/vue-chatbot-widget/workers/kokoro.worker?worker';

const realWorkers: ChatBotWorkers = {
    chatbot: () => new ChatBotWorker(),
    kokoro: () => new KokoroWorker(),
};
const start = async () => {
    let workers = realWorkers;
    // `?fakeWorkers`: scripted workers, no model download. This is how the e2e tests (e2e/) run the real UI.
    if(new URLSearchParams(window.location.search).has('fakeWorkers')){
        (window as any).__fakeWorkerLog = [];
        workers = (await import('./e2e/fakeWorkers')).fakeWorkers;
    }
    const pinia = createPinia();
    const app = createApp(App);
    app.use(pinia);
    initStores({ pinia, workers });
    //app.use(ChatBotPlugin, { pinia, workers });
    app.mount('#app');
};
start();
