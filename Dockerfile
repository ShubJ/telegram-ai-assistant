# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json* ./

# Copy workspace package files
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

# Install all dependencies
RUN npm install

# Copy source code for all workspaces
COPY shared/ ./shared/
COPY server/ ./server/
COPY client/ ./client/

# Build all workspaces in dependency order
RUN npm run build -w shared
RUN npm run build -w server
RUN npm run build -w client

# Stage 2: Runtime
FROM node:20-alpine AS runtime

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json* ./

# Copy workspace package files (needed for workspace linking)
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

# Install production dependencies only
RUN npm install --omit=dev

# Copy built artifacts from builder stage
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 3000

CMD ["node", "server/dist/index.js"]
