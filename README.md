# vue ChatBot Widget

[![CI](https://github.com/cristianglezm/vue-chatbot-widget/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/cristianglezm/vue-chatbot-widget/actions/workflows/ci.yml)
[![cd](https://github.com/cristianglezm/vue-chatbot-widget/actions/workflows/cd.yml/badge.svg?branch=master)](https://github.com/cristianglezm/vue-chatbot-widget/actions/workflows/cd.yml)
[![pkg](https://github.com/cristianglezm/vue-chatbot-widget/actions/workflows/pkg.yml/badge.svg?branch=master)](https://github.com/cristianglezm/vue-chatbot-widget/actions/workflows/pkg.yml)
[![NPM Version](https://img.shields.io/npm/v/%40cristianglezm%2Fvue-chatbot-widget?logo=npm)](https://www.npmjs.com/package/@cristianglezm/vue-chatbot-widget)

A Vue chatbot widget with agent tools, a simple RAG system, remote/local models, and text-to-speech.

**Live demo:** https://cristianglezm.github.io/vue-chatbot-widget/

The published package, installation instructions, API docs, and usage examples live in
[`packages/@cristianglezm/vue-chatbot-widget`](packages/@cristianglezm/vue-chatbot-widget/README.md).

## Repository layout

```text
.
├── src/                                 demo app
├── public/                              static assets
├── e2e/                                 end-to-end tests
├── packages/
│   └── @cristianglezm/
│       └── vue-chatbot-widget/          published library package
├── .devops/                             build / publish / deploy scripts
├── .github/                             CI and automation workflows
├── package.json                         workspace root and demo scripts
├── README.md                            this file
├── LICENSE.md                           project license
├── LICENSE-monaspace-font.md            font license
└── ...
```

Everything is installed once from the repository root, so shared dependencies like `vue`, `pinia`, and
`mitt` are kept in a single workspace copy for both the demo and the library.

## Development

```bash
npm install

npm run dev           # demo app with the widget served directly from source
npm run dev:widget    # rebuild the widget package on change (optional second terminal)
npm run test:widget   # unit tests for the library

npm run build:widget  # build only the library
npm run build         # library + type-check + demo build
npm run lint          # lint the demo app
npm run lint:widget   # lint the library
```

`npm run dev` resolves `@cristianglezm/vue-chatbot-widget` to the package sources, while the production
build uses the workspace package output so the demo is built with the same artifact that gets published.

The package itself does not bundle its workers; the app or bundler builds them and passes worker
instances when the chatbot or TTS features are enabled.

## Package highlights

- Agent-capable chat widget with tool execution
- Simple retrieval-augmented generation (RAG) support
- Local or remote model backends compatible with the OpenAI API shape
- Text-to-speech support with worker-based audio generation
- Vue 3 + Pinia integration for application setup

## Contributing

Contributions are welcome. If you want to improve the library, start from the package under
`packages/@cristianglezm/vue-chatbot-widget` and open a pull request against the repository.

## License

This project is distributed under the Apache 2.0 license. See [LICENSE.md](LICENSE.md) for details.

The Monaspace font is distributed under the STL Open Font License. See
[LICENSE-monaspace-font.md](LICENSE-monaspace-font.md) for details.
