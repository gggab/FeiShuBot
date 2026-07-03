# See docs/deployment.md for the full rationale (volumes, credentials, etc).

# ---- builder ------------------------------------------------------------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# better-sqlite3 needs a toolchain to build its native addon.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ git \
    && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN yarn build

# Prune devDependencies out of node_modules for the runtime stage.
RUN yarn install --frozen-lockfile --production

# ---- runtime -------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# git/openssh-client: BugFixHandler fetches/pushes against real repos.
# ca-certificates: HTTPS calls to the LLM/GitLab/Feishu APIs.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code @openai/codex \
    && useradd -m -u 1000 appuser

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
# Assistant identity (name/description). Baked-in default so the bot boots even
# without a mount; deploy can override by bind-mounting IDENTITY.md (config-ui edits it).
COPY IDENTITY.md ./

RUN mkdir -p /app/data /app/worktrees && chown -R appuser:appuser /app

USER appuser
ENV NODE_ENV=production
ENV HOME=/home/appuser

EXPOSE 3000
CMD ["node", "dist/app.js"]
