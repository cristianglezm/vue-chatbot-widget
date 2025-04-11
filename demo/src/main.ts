import { createApp } from 'vue'
import './style.css'
import App from './App.vue';
import { createPinia } from 'pinia';
//import ChatBotPlugin from '@cristianglezm/vue-chatbot-widget';
import { initStores } from '@cristianglezm/vue-chatbot-widget';

const pinia = createPinia();
const app = createApp(App);
app.use(pinia);
initStores({ pinia });
//app.use(ChatBotPlugin, { pinia });
app.mount('#app');
