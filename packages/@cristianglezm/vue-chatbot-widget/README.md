
# vue ChatBot Widget

[![cd](https://github.com/cristianglezm/vue-chatbot-widget/actions/workflows/cd.yml/badge.svg?branch=master)](https://github.com/cristianglezm/vue-chatbot-widget/actions/workflows/cd.yml)
[![pkg](https://github.com/cristianglezm/vue-chatbot-widget/actions/workflows/pkg.yml/badge.svg?branch=master)](https://github.com/cristianglezm/vue-chatbot-widget/actions/workflows/pkg.yml)
[![NPM Version](https://img.shields.io/npm/v/%40cristianglezm%2Fvue-chatbot-widget?logo=npm)](https://www.npmjs.com/package/@cristianglezm/vue-chatbot-widget)
[![GitHub package.json version (branch)](https://img.shields.io/github/package-json/v/cristianglezm/vue-chatbot-widget/master?logo=github)](https://github.com/cristianglezm/vue-chatbot-widget/pkgs/npm/vue-chatbot-widget)

The ChatBotWidget is designed to enhance your web application. It empowers users to specify actions, retrieve information from documents using a basic Retrieval-Augmented Generation (RAG) system, and access text-to-audio features for an improved and inclusive user experience. 

> ⚠️ **Important**
>
> **Warning**: The default chatbot model has not yet been trained for production use.
> Some features may be limited or not function as expected.
> For best results, consider using a custom model or adapting the configuration to meet your needs.

## Features

1. **Agent Capabilities** Leverages agent functionality to interpret and perform user-specified actions effectively.
2. **Simple RAG (Retrieval-Augmented Generation) System** Integrates a basic RAG system, allowing the chatbot to consult external documents to enhance responses.
3. **Local / Remote** it lets you use a local or remote server compatible with OpenAI API.
4. **Text-to-Audio Conversion** Generates audio for text responses, providing an accessible and interactive user experience. Includes options for manual playback or automatic audio generation after responses.

## Installation

You can install the package from npm.

```bash
npm i @cristianglezm/vue-chatbot-widget
```
If you plan to use all the components you will need to initizalize the pinia store and add ChatBotPlugin into the app.

```javascript
// app main.ts
import { createApp } from 'vue'
import { createPinia } from 'pinia';
// import the plugin
import ChatBotPlugin from '@cristianglezm/vue-chatbot-widget';
import './style.css'

import App from './App.vue'

const app = createApp(App);
const pinia = createPinia();
// registers the pinia store
app.use(pinia);
// and the ChatBot components
app.use(ChatBotPlugin, { pinia });
app.mount('#app')
```

If you plan to only use a component you can just call ``initStores({ pinia })`` instead.

```javascript
// app main.ts
import { createApp } from 'vue'
import { createPinia } from 'pinia';
import { initStores } from '@cristianglezm/vue-chatbot-widget';
import './style.css'

import App from './App.vue'

const app = createApp(App);
const pinia = createPinia();
// registers the pinia store
app.use(pinia);
// init stores for the chatbot components.
initStores({ pinia });
app.mount('#app')
```

## Usage

1. Using System Only

This method configures the chatbot with a system message.

```vue
<script setup>
import { onMounted } from 'vue';
import { ChatBotWidget } from '@cristianglezm/vue-chatbot-widget';
import mitt from 'mitt';
// emitter to be able to load models from outside the chatbot.
const emitter = mitt();
// onMounted(() => {
//    emitter.emit('ChatBotWidget#loadChatBotModel'); // load the llm
//    emitter.emit('ChatBotWidget#loadKokoroModel'); // load the tts
// });
// no need to pass emitter if not needed.
</script>
<template>
  <ChatBotWidget
    :emitter="emitter"
    :system="'You are a helpful assistant to assist the user.'"
    :greetings="'Hello! How can I assist you today?'"
  />
</template>
```

2. Using Chat Template Only

If you want to use a custom chat template (from @huggingface/jinja), specify it using the :chat-template prop.

When tools and documents are provided, they will be injected into the chat template, to be able to use tools you will need to provide your own executor function.
the chat template should have a ``tools|tojson`` and a ``for doc in documents``, review the chat_template in [main.ts](https://github.com/cristianglezm/vue-chatbot-widget/blob/master/src/main.ts)

```vue
<script setup>
import { ChatBotWidget, chat_template } from '@cristianglezm/vue-chatbot-widget';

const tools = [
    {
        "name": "makeFlower",
        "description": "Makes a flower",
        "parameters": {}
    },
    {
        "name": "mutate",
        "description": "Mutates a flower given the ID",
        "parameters": {
            "id": {
                "description": "Flower ID",
                "type": "int",
                "required": true
            }
        }
    }
];
const documents = [
    {
        "title":"title to use as embeddings and key to get the content with a tool",
        "content":"information for the user"
    },
];
</script>
<template>
  <ChatBotWidget
    :greetings="'Hello! How can I assist you today?'"
    :chat-template="chat_template"
    :tools="tools"
    :documents="documents"
    :executor="parseAndExecCommand"
  />
</template>
```
## Props

| Prop           | Type       | Description                                                         |
|----------------|------------|---------------------------------------------------------------------|
| `emitter`      | Object     | Mitt event bus to be able to load the model from outside the ChatBotWidget. |
| `system`       | String     | Predefined system message for chatbot behavior.                     |
| `greetings`    | String     | Initial message displayed to the user.                              |
| `chat-template`| String     | Custom `@huggingface/jinja` template for chatbot interaction.       |
| `tools`        | Array      | Array of tools available for chatbot execution.                     |
| `documents`    | Array      | Array of documents injected into the chat template.                 |
| `executor`     | Function   | Function responsible for parsing and executing commands.            |
| `editable`     | Boolean    | Enables or disables the editable mode.                              |
| `config`       | Object     | Custom configuration object for additional settings.                |



```javascript
emitter.emit('ChatBotWidget#loadChatBotModel'); // load the llm
emitter.emit('ChatBotWidget#loadKokoroModel'); // load the tts
```

refer to [src/component/chatbotwidget.vue](https://github.com/cristianglezm/vue-chatbot-widget/blob/master/src/components/ChatBotWidget.vue)


## Constributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

## License

This library is distributed under the ``Apache 2.0``. See [License](https://github.com/cristianglezm/vue-chatbot-widget/blob/master/LICENSE.md) for more information.

The Monaspace font is distributed under the STL Open Font License. See [License](https://github.com/cristianglezm/vue-chatbot-widget/blob/master/LICENSE-monaspace-font.md) for more information.

