import ChatBotWidget from './components/ChatBotWidget.vue';
import AudioPlayer from './components/AudioPlayer.vue';
import CacheManager from './components/CacheManager.vue';
import ChatBotModelOptions from './components/ChatBotModelOptions.vue';
import ConfirmModal from './components/ConfirmModal.vue';
import ErrorModal from './components/ErrorModal.vue';
import KokoroModelOptions from './components/KokoroModelOptions.vue';
import LLMRemoteOptions from './components/LLMRemoteOptions.vue';
import TTSRemoteOptions from './components/TTSRemoteOptions.vue';
import MultiProgressModal from './components/MultiProgressModal.vue';
import SwitchPanel from './components/SwitchPanel.vue';
import ToolTip from './components/ToolTip.vue';

import { useChatBotStore } from './stores/ChatBotStore';
import { useErrorStore } from './stores/ErrorStore';
import { useKokoroStore } from './stores/KokoroStore';
import { useVectorStore } from './stores/vectorStore';

import ChatBotWorker from '@cristianglezm/vue-chatbot-widget/workers/chatbot.worker?worker';
import KokoroWorker from '@cristianglezm/vue-chatbot-widget/workers/kokoro.worker?worker';

export {
  ChatBotWidget,
  AudioPlayer,
  CacheManager,
  ChatBotModelOptions,
  ConfirmModal,
  ErrorModal,
  KokoroModelOptions,
  LLMRemoteOptions,
  TTSRemoteOptions,
  MultiProgressModal,
  SwitchPanel,
  ToolTip,
  useChatBotStore,
  useErrorStore,
  useKokoroStore,
  useVectorStore,
  ChatBotWorker,
  KokoroWorker,
};

import { createPinia } from 'pinia';

interface ChatBotPluginOptions{
    pinia: ReturnType<typeof createPinia>;
};
export const initStores = (options: ChatBotPluginOptions ) => {
        if(!options.pinia){
            options.pinia = createPinia();
        }
        // @ts-ignore
        const ErrorStore = useErrorStore(options.pinia);
        // @ts-ignore
        const ChatBotStore = useChatBotStore(options.pinia);
        // @ts-ignore
        const VectorStore = useVectorStore(options.pinia);
        // @ts-ignore
        const KokoroStore = useKokoroStore(options.pinia);
};
const ChatBotPlugin = {
    install(app: any, options: ChatBotPluginOptions ){
        if(!options.pinia){
            options.pinia = createPinia();
        }
        app.use(options.pinia);
        initStores({ pinia: options.pinia });

        app.component('ChatBotWidget', ChatBotWidget);
        app.component('AudioPlayer', AudioPlayer);
        app.component('CacheManager', CacheManager);
        app.component('ChatBotModelOptions', ChatBotModelOptions);
        app.component('KokoroModelOptions', KokoroModelOptions);
        app.component('ConfirmModal', ConfirmModal);
        app.component('ErrorModal', ErrorModal);
        app.component('LLMRemoteOptions', LLMRemoteOptions);
        app.component('TTSRemoteOptions', TTSRemoteOptions);
        app.component('MultiProgressModal', MultiProgressModal);
        app.component('SwitchPanel', SwitchPanel);
        app.component('ToolTip', ToolTip);
    },
};
export default ChatBotPlugin;

export const chat_template = "{% for message in messages %}{% if loop.first and messages[0]['role'] != 'system' %}{{ '<|im_start|>system\nYou are an expert in composing functions. Based on the given question and tools, make functions/tools call to achieve the purpose, if applicable. If no suitable tool exists or the question lacks required parameters, state this clearly.\n<tools>' }}{{ tools|tojson }}{{ '</tools>\n<docs_titles>' }}{% for doc in documents %}{{ doc }}{% if not loop.last %}, {% endif %}{% endfor %}{{ '</docs_titles>\nresponse format:\n<tool_call>[{\"name\": \"fn_name\", \"parameters\": {\"param\": \"value\"}}, ...]</tool_call>\n<|im_end|>\n' }}{% endif %}{{ '<|im_start|>' + message['role'] + '\n' + message['content'] + '<|im_end|>\n' }}{% endfor %}{% if add_generation_prompt %}{{ '<|im_start|>assistant\n' }}{% endif %}";
