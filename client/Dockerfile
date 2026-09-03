FROM node:20-alpine

WORKDIR /app

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY client/package.json ./client/package.json
RUN pnpm install --frozen-lockfile --filter sp-client

COPY client ./client
COPY tsconfig.base.json ./tsconfig.base.json

WORKDIR /app/client

EXPOSE 5173

CMD ["pnpm", "dev"]
