#!/bin/bash

## workaround for big workers bug.
set -euo pipefail

CHATBOT_URL=$1
KOKORO_URL=$2

ASSETS=packages/@cristianglezm/vue-chatbot-widget/dist/lib/assets

ORIG_CHATBOT=$(ls $ASSETS/chatbot.*.js)
ORIG_KOKORO=$(ls $ASSETS/kokoro.*.js)

curl -o "$ORIG_CHATBOT" "$CHATBOT_URL"
curl -o "$ORIG_KOKORO" "$KOKORO_URL"

echo "replaced chatbot and kokoro workers"
