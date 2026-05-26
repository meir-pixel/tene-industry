# Builder stage — full Node image has all native build tools pre-installed
FROM node:20 AS builder

WORKDIR /usr/src/app

# Copy dependency specifications
COPY package*.json ./

# Install all dependencies (better-sqlite3 needs python3/make/g++ — all present in node:20)
RUN npm ci

# Copy application source
COPY . .

# ── Production runner stage ────────────────────────────────────────
FROM node:20-slim

# Runtime deps for better-sqlite3 (the compiled .node binary needs libstdc++)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy built node_modules and app code from builder
COPY --from=builder /usr/src/app /usr/src/app

# Set default production environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/ironbend.db
ENV BACKUP_DIR=/data/backups

# Create volume mount points for persistent storage
RUN mkdir -p /data/backups /data/logs

# Expose the application port
EXPOSE 3000

# Start the application server
CMD ["node", "server.js"]
