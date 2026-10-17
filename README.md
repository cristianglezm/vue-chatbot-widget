# vue ChatBot Widget

[![CI](https://github.com/cristianglezm/vue-chatbot-widget/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/cristianglezm/vue-chatbot-widget/actions/workflows/ci.yml)
[![cd](https://github.com/cristianglezm/vue-chatbot-widget/actions/workflows/cd.yml/badge.svg?branch=master)](https://github.com/cristianglezm/vue-chatbot-widget/actions/workflows/cd.yml)
[![pkg](https://github.com/cristianglezm/vue-chatbot-widget/actions/workflows/pkg.yml/badge.svg?branch=master)](https://github.com/cristianglezm/vue-chatbot-widget/actions/workflows/pkg.yml)
[![NPM Version](https://img.shields.io/npm/v/%40cristianglezm%2Fvue-chatbot-widget?logo=npm)](https://www.npmjs.com/package/@cristianglezm/vue-chatbot-widget)

A Vue chatbot widget with agent tools, a simple RAG system, remote/local models and text-to-speech.

**Live demo:** https://cristianglezm.github.io/vue-chatbot-widget/

The library, its documentation and its API are in
[`packages/@cristianglezm/vue-chatbot-widget`](packages/@cristianglezm/vue-chatbot-widget/README.md).

## Repository layout

```
.                                        demo app (private) + npm workspace root
├── src/                                 demo sources
├── packages/@cristianglezm/
│   └── vue-chatbot-widget/              the published library
└── .devops/                             build / publish / deploy scripts used by the workflows
```

Everything is installed once, from the root, so `vue`, `pinia` and `mitt` are a single copy shared by the
demo and the widget.

## Development

```bash
npm install

npm run dev           # demo with the widget served from its sources (HMR)
npm run dev:widget    # (optional, other terminal) rebuild the widget on change

npm run build:widget  # build only the library
npm run build         # library + type-check + demo
npm run lint          # demo
npm run lint:widget   # library
```

`npm run dev` resolves `@cristianglezm/vue-chatbot-widget` to the package sources; `npm run build` uses the
built package (`dist/lib`) through the workspace link, so the demo is built with what gets published.
Building the library bundles two large workers and needs about 4 GB of RAM.
