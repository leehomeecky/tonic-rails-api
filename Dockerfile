# =============================================================================
# Tonic Rails API: multi-stage build
# =============================================================================

# ---------- Stage 1: install all deps and build ----------
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN yarn build

# ---------- Stage 2: production dependencies only ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production --network-timeout 600000 \
  && yarn cache clean

# ---------- Stage 3: runtime ----------
FROM node:22-alpine AS production
ENV NODE_ENV=prod \
    PORT=9000
WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001 -G nodejs

COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --chown=nodejs:nodejs package.json ./

USER nodejs
EXPOSE 9000

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:9000/health/ready > /dev/null || exit 1

# Migrations (schema + reference data) run on boot via TypeORM migrationsRun.
CMD ["node", "dist/main"]
