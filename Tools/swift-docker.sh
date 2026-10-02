#!/usr/bin/env bash
# Runs a SwiftPM command for ContrailKit inside the official Swift 6.2 Linux image.
# The whole repo is mounted so the real-data test can read App/Resources/Data.
# Usage: Tools/swift-docker.sh test   |   Tools/swift-docker.sh build
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec docker run --rm -v "$ROOT":/repo -v contrail-swiftpm-cache:/root/.cache -w /repo/ContrailKit \
  -e CONTRAIL_DATA_DIR=/repo/App/Resources/Data swift:6.2 \
  swift "$@" --scratch-path /repo/ContrailKit/.build-linux
