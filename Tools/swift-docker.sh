#!/usr/bin/env bash
# Runs a SwiftPM command for ContrailKit inside the official Swift 6.2 Linux image.
# Usage: Tools/swift-docker.sh test   |   Tools/swift-docker.sh build
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="${PKG_DIR:-$ROOT/ContrailKit}"
exec docker run --rm -v "$PKG":/pkg -v contrail-swiftpm-cache:/root/.cache -w /pkg swift:6.2 \
  swift "$@" --scratch-path /pkg/.build-linux
