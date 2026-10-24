import mitt from 'mitt';
import { defineStore } from 'pinia';
import WorkerManager from '../WorkerManager';
import { toRaw } from 'vue';
import { useErrorStore } from '../ErrorStore';
import { RawAudio } from '@huggingface/transformers';

let channel = new mitt();
const wm = new WorkerManager(channel);
// An error ends the audio that was being made: the widget waits for it (it is busy until the audio or the end of the
// stream comes), and the chunks of a stream that will never be done must not end up in the next audio.
const audioFailed = (error) => {
    useErrorStore().push(error);
    useKokoroStore().pendingChunks = [];
    channel.emit('ChatBotWidget#AudioChunkDone');
};
wm.onError('kokoro', audioFailed);
wm.onResponse('kokoro', (data) => {
    const KokoroStore = useKokoroStore();
    const jobType = data.jobType;
    switch(jobType){
        case "updateBtnTitle":{
            KokoroStore.isModelLoaded = true;
            channel.emit('ChatBotWidget#ToEmitter', data);
        }
            break;
        case "error":{
            audioFailed(data.error);
        }
            break;
        case "updateProgressBar":{
            channel.emit('ChatBotWidget#ToEmitter', data);
        }
            break;
        case "audioResp":{
            KokoroStore.addAudio(data.text, data.audio);
            channel.emit('ChatBotWidget#audioResp', {
                audio: data.audio,
                text: data.text
            });
        }
            break;
        case "streamingAudioChunk":{
            KokoroStore.pendingChunks.push({text: data.text, audio: data.audio});
            channel.emit('ChatBotWidget#AudioChunk', {
                audio: data.audio,
                text: data.text
            });
        }
            break;
        case "streamingAudioChunk#done":{
            KokoroStore._mergePendingChunks(data.text)
                .catch((e) => useErrorStore().push(e))
                .finally(() => channel.emit('ChatBotWidget#AudioChunkDone'));
        }
            break;
    }
});
export const hashText = async (text) => {
    // crypto.subtle only exists in secure contexts (https, localhost) and the hash is only the key of an
    // in-memory cache, the text itself does the same job on a plain http page.
    if(!globalThis.crypto?.subtle){
        return text;
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

export const STORAGE_KEY_KOKORO_MODEL_OPTIONS = "FlowerEvolverKokoroModelOptions";
export const STORAGE_KEY_KOKORO_REMOTE_OPTIONS = "FlowerEvolverKokoroRemoteOptions";
export const STORAGE_KEY_KOKORO_IS_LOCAL = "FlowerEvolverKokoroIsLocal";

export const useKokoroStore = defineStore('KokoroStore', {
    state: () => ({
        wm,
        channel,
        isModelLoaded: false,
        isLocal: JSON.parse(localStorage.getItem(STORAGE_KEY_KOKORO_IS_LOCAL) || JSON.stringify(true)),
        modelOptions: JSON.parse(localStorage.getItem(STORAGE_KEY_KOKORO_MODEL_OPTIONS) || JSON.stringify({
            host: "huggingface",
            model: "onnx-community/Kokoro-82M-v1.0-ONNX",
            device: "CPU",
            dtype: "q8",
            voice: "af_bella"
        })),
        oldModelOptions: null,
        remoteOptions: JSON.parse(localStorage.getItem(STORAGE_KEY_KOKORO_REMOTE_OPTIONS) || JSON.stringify({
            url: "http://localhost:8880",
            api_key: "sk-no-key-required",
            model: "kokoro",
            voice: "af_bella"
        })),
        audios: new Map(),
        pendingChunks: []
    }),
    getters: {
        getAudios: (state) => {
            return state.audios;
        },
        hasModelLoaded: (state) => {
            return state.isModelLoaded;
        },
        hasModelOptionsChanged: (state) => {
            if(state.oldModelOptions === null) return true;
            return ((state.oldModelOptions.host !== state.modelOptions.host) ||
                    (state.oldModelOptions.model !== state.modelOptions.model) ||
                    (state.oldModelOptions.device !== state.modelOptions.device) ||
                    (state.oldModelOptions.dtype !== state.modelOptions.dtype) ||
                    (state.oldModelOptions.voice !== state.modelOptions.voice));
        }
    },
    actions: {
        /**
         * @brief Tells the store how to build its worker (it is created on the first request).
         * @param factory {Function} () => new Worker, ie: () => new KokoroWorker()
         */
        registerWorker(factory){
            this.wm.registerFactory('kokoro', factory);
        },
        async addAudio(text, audio){
            let hash = await hashText(text);
            this.audios.set(hash, audio);
        },
        async getAudio(text){
            let hash = await hashText(text);
            return this.audios.get(hash);
        },
        async clearAudios(){
            this.audios = new Map();
        },
        async requestAudioGen(text){
            if(this.isLocal){
                if(this.isModelLoaded){
                    this.wm.sendRequest('kokoro', {
                        jobType: "audioGen",
                        text: text
                    });
                }
            }else{
                this.wm.sendRequest('kokoro', {
                    jobType: "rAudioGen",
                    text: text,
                    remoteOptions: structuredClone(toRaw(this.remoteOptions))
                });
            }
        },
        async requestStreamingAudioGen(text){
            if(this.isLocal){
                if(this.isModelLoaded){
                    this.wm.sendRequest('kokoro', {
                        jobType: "streamingAudio",
                        text: text
                    });
                }
            }else{
                this.wm.sendRequest('kokoro', {
                    jobType: "rStreamingAudio",
                    text: text,
                    remoteOptions: structuredClone(toRaw(this.remoteOptions))
                });
            }
        },
        /**
         * @brief Asks the worker to load the model (or checks the remote server).
         * @param force {Boolean} Reload the model even if it is already loaded with the same options, ie: its cache was deleted.
         */
        async requestModelLoad(force = false){
            if(this.isLocal){
                this.oldModelOptions = structuredClone(toRaw(this.modelOptions));
                this.wm.sendRequest('kokoro', {
                    jobType: "loadModel",
                    modelOptions: structuredClone(toRaw(this.modelOptions)),
                    force: force
                });
            }else{
                fetch(this.remoteOptions.url + "/health")
                .then(response => {
                    if(!response.ok){
                        throw Error("health endpoint not available.");
                    }
                    return response.json();
                })
                .then((server) => {
                    this.isModelLoaded = server.status === "ok";
                }) // it doesn't support /health, assume is ok (openAI, hf, etc)
                .catch((_) => this.isModelLoaded = true)
            }
        },
        async requestReset(){
            if(!this.isLocal){
                return;
            }
            this.isModelLoaded = false;
            this.wm.sendRequest('kokoro', {
                jobType: "reset",
            });
        },
        async _mergePendingChunks(text){
            if(!this.pendingChunks || this.pendingChunks.length === 0){
              return;
            }
            // these chunks are this audio's whatever happens next: a failure must not leave them for the next one,
            // and the chunks of a stream that starts meanwhile are not part of this one.
            const chunks = this.pendingChunks;
            this.pendingChunks = [];
            let mergedAudioSamples = [];
            let sampleRate = 44100;
            const chunkSize = 10000;
            // browsers only allow a few open AudioContext
            const audioContext = new AudioContext();
            try{
                for(let chunk of chunks){
                    const response = await fetch(chunk.audio);
                    const arrayBuffer = await response.arrayBuffer();
                    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                    const channelData = audioBuffer.getChannelData(0);
                    for(let i = 0;i < channelData.length;i += chunkSize){
                        mergedAudioSamples.push(...channelData.slice(i, i + chunkSize));
                    }
                    sampleRate = audioBuffer.sampleRate;
                }
            }finally{
                await audioContext.close();
            }
            const rawAudio = new RawAudio(new Float32Array(mergedAudioSamples), sampleRate);
            const wavBlob = rawAudio.toBlob();
            const audioURL = URL.createObjectURL(wavBlob);
            await this.addAudio(text, audioURL);
        },
        async saveModelOptions(){
            localStorage.setItem(STORAGE_KEY_KOKORO_MODEL_OPTIONS, JSON.stringify(this.modelOptions));
        },
        async saveRemoteOptions(){
            localStorage.setItem(STORAGE_KEY_KOKORO_REMOTE_OPTIONS, JSON.stringify(this.remoteOptions));
        },
        async saveIsLocal(){
            localStorage.setItem(STORAGE_KEY_KOKORO_IS_LOCAL, this.isLocal);
        }
    }
});
