# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# GenieACS dev image
#
# Multi-stage build producing a single image (`genieacs:dev`) that ships all
# 9 binaries. The actual binary executed at runtime is selected by the
# `command:` field of the corresponding compose service.
#
# Stages:
#   1. builder  -- compiles TypeScript (node:22 + dev deps).
#                  USP .proto schemas are embedded as text via esbuild's
#                  text loader; no protoc needed.
#   2. runtime  -- slim node image carrying only `dist/` plus runtime
#                  dependencies.
# ---------------------------------------------------------------------------

# ----------------------------- builder stage -------------------------------
FROM node:22-bookworm AS builder

WORKDIR /app

# Copy the full repo (the .dockerignore -- if any -- in the repo root keeps
# node_modules / dist out of the build context).
COPY . .

# Install deterministically from the shrinkwrap, then build.
RUN npm ci && npm run build

# ----------------------------- runtime stage -------------------------------
FROM node:22-bookworm-slim AS runtime

LABEL org.opencontainers.image.source="https://github.com/genieacs/genieacs" \
      org.opencontainers.image.title="GenieACS" \
      org.opencontainers.image.description="GenieACS TR-069/TR-369 ACS (dev image)" \
      org.opencontainers.image.licenses="AGPL-3.0" \
      org.opencontainers.image.vendor="GenieACS Inc."

WORKDIR /app

# Copy the compiled output (bin/, public/, package.json, npm-shrinkwrap.json)
# produced by build/build.ts.
COPY --from=builder /app/dist ./dist

# Install runtime-only dependencies inside dist/ (esbuild bundles with
# --packages=external so the binaries `require()` real npm packages at run time).
RUN cd /app/dist && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Put all 9 binaries on PATH so `command: [genieacs-foo]` works directly.
ENV PATH="/app/dist/bin:${PATH}"

# Clear the base node image's ENTRYPOINT (which wraps args as `node <arg>`).
# Our binaries already carry a `#!/usr/bin/env node` shebang and live on PATH,
# so they should be invoked directly by the OCI runtime.
ENTRYPOINT []

# Default binary -- compose `command:` overrides this per-service.
CMD ["genieacs-cwmp"]
