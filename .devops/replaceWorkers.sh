#!/bin/bash

## workaround for big workers bug.
set -e

CHATBOT_URL=$1
KOKORO_URL=$2

ORIG_CHATBOT=$(ls dist/lib/assets/chatbot.*.js)
ORIG_KOKORO=$(ls dist/lib/assets/kokoro.*.js)

curl -o "$ORIG_CHATBOT" "$CHATBOT_URL"
curl -o "$ORIG_KOKORO" "$KOKORO_URL"

echo "replaced chatbot and kokoro workers"
