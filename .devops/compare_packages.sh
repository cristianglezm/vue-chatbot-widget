#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <path_to_first_package.json> <path_to_second_package.json>" >&2
    exit 1
fi

FILE1="$1"
FILE2="$2"

# Verify files exist
if [ ! -f "$FILE1" ] || [ ! -f "$FILE2" ]; then
    echo "Error: One or both files do not exist." >&2
    exit 1
fi

# Extract versions using jq
VERSION1=$(jq -r '.version // empty' "$FILE1")
VERSION2=$(jq -r '.version // empty' "$FILE2")

# Check if version fields are present
if [ -z "$VERSION1" ]; then
    echo "Error: 'version' field missing or null in $FILE1" >&2
    exit 1
fi

if [ -z "$VERSION2" ]; then
    echo "Error: 'version' field missing or null in $FILE2" >&2
    exit 1
fi

echo "Package 1 Version: $VERSION1"
echo "Package 2 Version: $VERSION2"

# Perform string comparison
if [ "$VERSION1" = "$VERSION2" ]; then
    echo "Success: Versions match."
    exit 0
else
    echo "Failure: Version mismatch!" >&2
    exit 1
fi
