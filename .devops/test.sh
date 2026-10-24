#!/bin/bash

set -euo pipefail

# e2e tests of the built demo (it has to be built first: .devops/build.sh), with scripted workers, no model download.
# CI=true makes Playwright serve the build with `vite preview`.
CI=true npm run test:e2e
