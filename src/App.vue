<template>
  <div style="margin: 0px 100px 0px 100px; text-align: center;">
    <h1>ChatBot-Widget Demo</h1>
    <div v-for="item, index in settings" :key="index">
      <h2>{{ item.title }}</h2>
      <p>{{ item.desc }}</p>
      <button class="safe-button" @click="openChatBot(index)">
        {{ isOpen(index) ? 'Close':'Open' }} ChatBot - {{ item.title }}
      </button>
      <div v-if="isOpen(index)">
        <h3>code snippet</h3>
        <pre>
            <code class="language-javascript">
                {{ makeCodeSnippet(item.chatbotProps) }}
            </code>
        </pre>
        <ChatBotWidget 
          :emitter="item.chatbotProps.emitter"
          :system="item.chatbotProps.systemPrompt"
          :greetings="item.chatbotProps.greetings"
          :chat-template="item.chatbotProps.chat_template" 
          :tools="item.chatbotProps.tools"
          :documents="item.chatbotProps.documents"
          :executor="item.chatbotProps.executor" 
          :editable="item.chatbotProps.editable" 
          :config="item.chatbotProps.config"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, nextTick } from 'vue'
import mitt from 'mitt';
import { ChatBotWidget } from '@cristianglezm/vue-chatbot-widget';
import 'prismjs/themes/prism-tomorrow.css';
import * as Prism from "prismjs";

import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markup-templating';

const emitter = mitt();
const isOpen = (index: number) => {
    return currentSettings.value === index && showChatBot.value;
};
const defaultExecCommand = (content: string) => { return {infoForUser: [], textForUser: [content], commandsToConfirm: []}; };
const makeCodeSnippet = (props: { [key:string]: any }) => {
    return `<ChatBotWidget
            :emitter="emitter"
            :system="${props.systemPrompt}"
            :greetings="${props.greetings}"
            :chat-template="${props.chat_template}"
            :tools="${JSON.stringify(props.tools, null, 4)}"
            :documents="${JSON.stringify(props.documents, null, 4)}"
            :executor="${props.executor.toString()}"
            :editable="${props.editable}"
            :config="${JSON.stringify(props.config, null, 4)}"
            />`;
};
/**
 * /// example with default config
const defaultConfig: { [key:string]: any } = {
    options:{
        generateSpeech: true,
        useEmbeddings: true,
        threshold: 0.8
    },
    llm:{
        isLocal: true, 
        modelOptions: {
            host: "huggingface",
            model: "HuggingFaceTB/SmolLM2-135M-Instruct",
            device: "CPU",
            dtype: "q4"
        },
        remoteOptions:{
            url: "http://localhost:8080",
            api_key: "sk-no-key-required",
            model: "HuggingFaceTB/SmolLM2-135M-Instruct",
            max_tokens: 256,
            top_k: 40,
            top_p: 0.95,
            min_p: 0.05,
            temperature: 0.6
        }
    },
    tts:{
        isLocal: true,
        modelOptions:{
            host: "huggingface",
            model: "onnx-community/Kokoro-82M-v1.0-ONNX",
            device: "CPU",
            dtype: "q8",
            voice: "af_bella"
        },
        remoteOptions:{
            url: "http://localhost:8880",
            api_key: "sk-no-key-required",
            model: "kokoro",
            voice: "af_bella"
        }
    }
};
 */
 const remoteOnlyConfig: { [key:string]: any } = {
    llm:{
        isLocal: false, 
        remoteOptions:{
            url: "http://localhost:8080",
            api_key: "sk-no-key-required",
            model: "HuggingFaceTB/SmolLM2-135M-Instruct",
            max_tokens: 256,
            top_k: 40,
            top_p: 0.95,
            min_p: 0.05,
            temperature: 0.6
        }
    },
    tts:{
        isLocal: false,
        remoteOptions:{
            url: "http://localhost:8880",
            api_key: "sk-no-key-required",
            model: "kokoro",
            voice: "af_bella"
        }
    }
};
const localOnly: { [key:string]: any } = {
    options:{
        generateSpeech: true,
        useEmbeddings: true,
        threshold: 0.8
    },
    llm:{
        isLocal: true, 
        modelOptions: {
            host: "huggingface",
            model: "HuggingFaceTB/SmolLM2-135M-Instruct",
            device: "CPU",
            dtype: "q4"
        },
    },
    tts:{
        isLocal: true,
        modelOptions:{
            host: "huggingface",
            model: "onnx-community/Kokoro-82M-v1.0-ONNX",
            device: "CPU",
            dtype: "q8",
            voice: "af_bella"
        },
    }
};
const execCommand = (text: string) => {
    /** format for commandsToConfirm
     *      commandsToConfirm: [{
     *          "title":"title for ConfirmModal",
     *          "message":"message ...",
     *          "btnNo": "text for button no",
     *          "btnYes": "text for button yes",
     *          "onConfirm": () => { console.log("fn to execute when user clicks btnYes") }
     *      }]
     */ 
    const infoForUser: Array<string> = [];
    const textForUser: Array<string> = [];
    const commandsToConfirm: Array<{[Key:string]:any}> = [];
    const makeResult = (textForUser:Array<string> = [], 
                        commandsToConfirm:Array<{[key:string]:any}> = [], 
                        infoForUser:Array<string> = []) => {
        return {
            infoForUser: infoForUser,
            textForUser: textForUser,
            commandsToConfirm: commandsToConfirm
        };
    };
    if(text === undefined || text === null){
        infoForUser.push("response was not valid.");
        return makeResult(textForUser, commandsToConfirm, infoForUser);
    }
    const regex = /<tool_call>(.*?)<\/tool_call>/;
    const matches = text.match(regex);
    if(!matches){
        textForUser.push(text);
        return makeResult(textForUser, commandsToConfirm, infoForUser);
    }
    let command;
    try{
        command = JSON.parse(matches[1]);
        const cleanText = text.replace(regex, "").trim();
        if(cleanText){
            textForUser.push(cleanText);
        }
    }catch(_){
        infoForUser.push("I am sorry but I could not parse the command.");
        return makeResult(textForUser, commandsToConfirm, infoForUser);
    }
    for(let i=0;i<command.length;++i){
        switch(command[i].name){
            case "alert":{
                alert("executed tool alert with message: " + command[i].parameters?.message);
                infoForUser.push("alert command executed.");
            }
                break;
        }
    }
    return makeResult(textForUser, commandsToConfirm, infoForUser);
};
const tools = [
    {
        "name": "alert",
        "description": "shows an alert with a given message",
        "parameters": {
            "message": {
                "description": "message for the alert",
                "type": "string",
                "required": true
            }
        }
    },
    {
        "name": "getDocument",
        "description": "It requests info for the user",
        "parameters": {
            "title": {
                "description": "Title of the document (aka key)",
                "type": "string",
                "required": true
            }
        }
    }
];
const documents = [
    {
        "title":"what are alerts for?",
        "content":"Alerts are a simple way to test this model tool use."
    },
]
const chat_template = "{% for message in messages %}{% if loop.first and messages[0]['role'] != 'system' %}{{ '<|im_start|>system\nYou are an expert in composing functions. Based on the given question and tools, make functions/tools call to achieve the purpose, if applicable. If no suitable tool exists or the question lacks required parameters, state this clearly.\n<tools>' }}{{ tools|tojson }}{{ '</tools>\n<docs_titles>' }}{% for doc in documents %}{{ doc }}{% if not loop.last %}, {% endif %}{% endfor %}{{ '</docs_titles>\nresponse format:\n<tool_call>[{\"name\": \"fn_name\", \"parameters\": {\"param\": \"value\"}}, ...]</tool_call>\n<|im_end|>\n' }}{% endif %}{{ '<|im_start|>' + message['role'] + '\n' + message['content'] + '<|im_end|>\n' }}{% endfor %}{% if add_generation_prompt %}{{ '<|im_start|>assistant\n' }}{% endif %}"
const settings = new Array<{ [key: string]: any}>(
    reactive({
        title: "Basic System Prompt",
        desc: "This chatbot is configured with a basic system prompt for conversations.\nIt's suitable for general-purpose interactions.",
        chatbotProps: {
            emitter: emitter,
            systemPrompt: "You are a helpful assistant.",
            greetings: 'Hello, I have a simple system prompt, what can I do for you?',
            chat_template: null,
            tools: null,
            documents: null,
            executor: defaultExecCommand,
            editable: true,
            config: null,
        }
    }),
    reactive({
        title: "Remote Only",
        desc: "This chatbot is configured to be remote only",
        chatbotProps: {
            emitter: emitter,
            systemPrompt: "You are a helpful assistant.",
            greetings: 'Hello, I can only work with remote servers, how can I help you?',
            chat_template: null,
            tools: null,
            documents: null,
            executor: defaultExecCommand,
            editable: false,
            config: remoteOnlyConfig,
        }
    }),
    reactive({
        title: "Local Only",
        desc: "This chatbot is configured to be local only",
        chatbotProps: {
            emitter: emitter,
            systemPrompt: "You are a helpful assistant.",
            greetings: 'Hello, I can only work locally, how can I help you?',
            chat_template: null,
            tools: null,
            documents: null,
            executor: defaultExecCommand,
            editable: false,
            config: localOnly,
        }
    }),
    reactive({
        title: "tool-use",
        desc: "This chatbot is configured to be able to use tools and consult documents(with a provided tool) provided via :tools and :documents, you will need to use :chat_template so tools and documents are injected into it.\nuse the executor fn to parse the llm output and execute the tool.",
        chatbotProps: {
            emitter: emitter,
            systemPrompt: null,
            greetings: 'Hello, I can use tools, I can show alerts with a message.\nhow can I help you?',
            chat_template: chat_template,
            tools: tools,
            documents: documents,
            executor: execCommand,
            editable: true,
            config: null,
        }
    })
);
const currentSettings = ref(0);
const showChatBot = ref(false);
const openChatBot = (current: number) => {
    if(currentSettings.value === current){
        showChatBot.value = !showChatBot.value;
    }else{
        showChatBot.value = true;
    }
    currentSettings.value = current;
    nextTick(() => {
        Prism.highlightAll();
    });
};
  /*!
   * @license SIL Open Font License 1.1 - Copyright (c) 2023, GitHub
   * https://github.com/githubnext/monaspace
   * with Reserved Font Name "Monaspace", including subfamilies: "Argon", "Neon", "Xenon", "Radon", and "Krypton"
   */
</script>

<style>
    html{
        font-family: 'MonaspaceRadon-Regular', Arial, Helvetica, sans-serif;
        background-color: green !important;
        color: lightgreen;
        scrollbar-color: lightgreen rgb(47, 50, 52);
        width: 100%;
        height: 100%;
        overflow-x: hidden;
    }
    pre{
        background-color: rgb(47, 50, 52);
        padding: 16px;
        border-radius: 8px;
        border: 1px solid lightgreen;
        overflow-x: auto;
        font-size: 14px;
        line-height: 1.6;
        margin: 16px 0;
        white-space: pre-wrap;
        word-wrap: break-word;
    }
    code{
        background-color: rgb(47, 50, 52);
        padding: 2px 4px;
        border-radius: 4px;
        font-size: 14px;
        white-space: pre;
    }
</style>

<style scoped>
    .safe-button{
        background-color: green;
        color: lightgreen;
        border: solid 1px lightgreen;
        border-radius: 10px;
        box-shadow: 1px 2px 3px 4px rgb(0, 0, 0, 0.6);
    }
    .safe-button:hover{
        background-color: lightgreen;
        color: green;
        cursor: pointer;
    }
    .safe-button:disabled{
        cursor: not-allowed !important;
    }
</style>
