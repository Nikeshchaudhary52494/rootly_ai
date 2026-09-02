# Reproduction sandbox image.
#
# Built once, ahead of time, with network access (a normal `docker build`).
# At *runtime* the reproduction engine creates containers from this image
# with `--network none`, so nothing gets installed on the fly — jest is
# baked in here specifically so a run never needs the network.
#
# This intentionally does NOT try to `npm ci` the whole monorepo (or even
# demo-app's own package.json, which pulls in express/dotenv/the SDK that
# the reproduction target — a single pure function — doesn't need). See
# packages/reproduction/README.md ("Dependency installation tradeoff") for
# the full reasoning and what a repo with real test-time dependencies would
# need instead.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g jest@29 --no-audit --no-fund

WORKDIR /workspace
