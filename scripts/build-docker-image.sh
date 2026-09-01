#!/usr/bin/env bash
set -euo pipefail

export DOCKER_BUILDKIT=1
exec docker build "$@"
