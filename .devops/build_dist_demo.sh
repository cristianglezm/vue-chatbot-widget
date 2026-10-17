#!/bin/bash

set -euo pipefail

# needs the widget built first (build_dist_lib.sh), the demo uses the built package.
npm run buildGH
