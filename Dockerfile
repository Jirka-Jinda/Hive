# ── Stage 1: Build frontend ───────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app

# Install dependencies (workspaces need all package.json files first)
COPY package.json package-lock.json* ./
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/backend/package.json  ./packages/backend/
RUN npm ci --workspace=packages/frontend

# Build
COPY tsconfig.json ./
COPY packages/frontend ./packages/frontend
RUN npm run build --workspace=packages/frontend


# ── Stage 2: Build backend ────────────────────────────────────────────────
FROM node:20-alpine AS backend-builder
RUN apk add --no-cache python3 make g++ git

WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/backend/package.json  ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
RUN npm ci --workspace=packages/backend --omit=dev

COPY tsconfig.json ./
COPY packages/backend ./packages/backend
RUN npm run build --workspace=packages/backend


# ── Stage 3: Production image ─────────────────────────────────────────────
FROM node:20-alpine
RUN apk add --no-cache git

WORKDIR /app

# Copy compiled backend and its node_modules
COPY --from=backend-builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=backend-builder /app/node_modules           ./node_modules
COPY --from=backend-builder /app/packages/backend/node_modules ./packages/backend/node_modules

# Serve frontend static files from ./public (relative to CWD /app)
COPY --from=frontend-builder /app/packages/frontend/dist ./public

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3000

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "packages/backend/dist/index.js"]
