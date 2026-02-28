FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# Run — defaults to `serve` (friday chat requires a running server)
ENV NODE_ENV=production
ENTRYPOINT ["bun", "run", "src/main.ts"]
CMD ["serve"]
