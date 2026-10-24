const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class ScriptedWorker {
  onmessage = null;
  onerror = null;
  terminated = false;
  postMessage(data) {
    if (this.terminated) return;
    window.__fakeWorkerLog?.push({ worker: this.name, ...structuredClone(data) });
    const job = this.jobs[data.jobType];
    if (!job) return;
    setTimeout(async () => {
      try {
        await job.call(this, data);
      } catch (error) {
        this.reply({ jobType: "error", error });
      }
    }, 0);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data) {
    if (!this.terminated) this.onmessage?.({ data });
  }
  async loadModel(data) {
    const model = data.modelOptions?.model ?? "";
    const slow = model === "fake/slow";
    const step = slow ? 400 : 15;
    const file = "model.onnx";
    const progress = (event) => this.reply({
      jobType: "updateProgressBar",
      eventName: "ChatBotWidget#requestMultiProgressBar",
      event
    });
    try {
      progress({ status: "init", name: file, progress: 0, total: 100 });
      for (const p of [25, 50, 75, 100]) {
        await sleep(step);
        progress({ status: "update", name: file, progress: p });
      }
      if (model === "fake/fail") {
        throw new Error(`could not load ${model}`);
      }
      this.reply({ jobType: "updateBtnTitle", eventName: "ChatBotModelOptions#updateBtnTitle", event: "" });
    } finally {
      progress({ status: "finish" });
    }
  }
}
const replyTo = (messages) => {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const content = last?.content ?? "";
  if (content.startsWith("/fail")) {
    throw new Error("scripted failure");
  }
  if (content.startsWith("/raw ")) {
    return content.slice("/raw ".length);
  }
  return `Fake reply to: ${content}`;
};
class FakeChatBotWorker extends ScriptedWorker {
  name = "chatbot";
  jobs = {
    loadModel: (data) => this.loadModel(data),
    reset: () => {
    },
    chat: (data) => this.answer(data, false, false),
    rChat: (data) => this.answer(data, true, false),
    streaming: (data) => this.answer(data, false, true),
    rStreaming: (data) => this.answer(data, true, true),
    embeddings: (data) => this.embeddings(data),
    rEmbeddings: (data) => this.embeddings(data)
  };
  async answer(data, remote, streaming) {
    const messages = data.messages;
    const text = replyTo(messages);
    if (streaming) {
      for (const word of text.split(new RegExp("(?<= )"))) {
        await sleep(10);
        this.reply({ jobType: "streaming", response: word });
      }
    }
    this.reply({
      jobType: "response",
      // local replies are shaped like transformers.js', remote ones are the text
      response: remote ? text : [{ generated_text: [...messages, { role: "assistant", content: text }] }]
    });
    this.reply({ jobType: "done" });
  }
  embeddings(data) {
    for (const text of data.texts) {
      const vector = new Array(8).fill(0);
      for (let i = 0; i < text.length; i++) vector[i % 8] += text.charCodeAt(i);
      const norm = Math.hypot(...vector) || 1;
      this.reply({ jobType: "embeddings", type: data.type, text, embeddings: vector.map((v) => v / norm) });
    }
  }
}
const silentWav = () => {
  const sampleRate = 8e3, samples = 800;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const str = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
};
class FakeKokoroWorker extends ScriptedWorker {
  name = "kokoro";
  jobs = {
    loadModel: (data) => this.loadModel(data),
    reset: () => {
    },
    audioGen: (data) => this.reply({ jobType: "audioResp", audio: silentWav(), text: data.text }),
    rAudioGen: (data) => this.reply({ jobType: "audioResp", audio: silentWav(), text: data.text }),
    streamingAudio: (data) => this.chunks(data),
    rStreamingAudio: (data) => this.chunks(data)
  };
  async chunks(data) {
    const sentences = data.text.match(/[^.!?]+[.!?]*/g) ?? [data.text];
    for (const text of sentences) {
      await sleep(10);
      this.reply({ jobType: "streamingAudioChunk", audio: silentWav(), text: text.trim() });
    }
    this.reply({ jobType: "streamingAudioChunk#done", text: data.text });
  }
}
const fakeWorkers = {
  chatbot: () => new FakeChatBotWorker(),
  kokoro: () => new FakeKokoroWorker()
};
export {
  FakeChatBotWorker,
  FakeKokoroWorker,
  fakeWorkers,
  replyTo
};
