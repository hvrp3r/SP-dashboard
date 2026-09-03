FROM node:20-alpine

WORKDIR /app

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY server/package.json ./server/package.json
RUN pnpm install --frozen-lockfile --filter sp-server

COPY server ./server
COPY tsconfig.base.json ./tsconfig.base.json

WORKDIR /app/server

EXPOSE 3001

CMD ["pnpm", "dev"]
