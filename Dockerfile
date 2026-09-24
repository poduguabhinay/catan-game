# Single-container build: client bundle + game server on one port.
# Works on Koyeb, Render (Docker runtime), Railway, or any Docker host.
FROM node:22-slim
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

# Manifests first so dependency install is cached across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN corepack pnpm install --frozen-lockfile

COPY . .
RUN corepack pnpm build

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
CMD ["corepack", "pnpm", "start"]
