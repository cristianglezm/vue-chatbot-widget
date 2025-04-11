#/bin/bash

set -e
cd demo
npm i
npm run build -- --base=/vue-chatbot-widget/
cd ..
