# Agent image for dstack / Phala Cloud (TDX). Build from the repository root:
#   docker build -f agent/Dockerfile -t obelisk-agent .
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY agent agent
COPY contracts/deployments contracts/deployments
RUN pnpm install --frozen-lockfile --filter @obelisk/agent...
WORKDIR /app/agent
ENV AGENT_PORT=8080
EXPOSE 8080
CMD ["npx", "tsx", "src/server.ts"]
