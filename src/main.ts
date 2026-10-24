import { createApp } from 'vue'
import './style.css'
import App from './App.vue';
import { createPinia } from 'pinia';
//import ChatBotPlugin from '@cristianglezm/vue-chatbot-widget';
import { initStores } from '@cristianglezm/vue-chatbot-widget';
// the library does not bundle its workers, your bundler builds them (`?worker`).
import ChatBotWorker from '@cristianglezm/vue-chatbot-widget/workers/chatbot.worker?worker';
import KokoroWorker from '@cristianglezm/vue-chatbot-widget/workers/kokoro.worker?worker';

const workers = {
    chatbot: () => new ChatBotWorker(),
    kokoro: () => new KokoroWorker(),
};
const pinia = createPinia();
const app = createApp(App);
app.use(pinia);
initStores({ pinia, workers });
//app.use(ChatBotPlugin, { pinia, workers });
app.mount('#app');
