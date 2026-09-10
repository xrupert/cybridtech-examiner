FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY lib ./lib
COPY scripts ./scripts
COPY tsconfig.json ./
USER node
CMD ["node", "--import", "tsx", "scripts/worker.ts"]
