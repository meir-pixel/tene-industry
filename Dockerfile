# Use the official Node.js 20 base image (includes build tools for native packages like better-sqlite3)
FROM node:20-slim AS builder

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy dependency specifications
COPY package*.json ./

# Install all dependencies (including devDependencies if needed for build steps)
RUN npm ci

# Copy application source
COPY . .

# Production runner stage
FROM node:20-slim

WORKDIR /usr/src/app

# Copy built node_modules and code from the builder stage
COPY --from=builder /usr/src/app /usr/src/app

# Set default production environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/ironbend.db
ENV BACKUP_DIR=/data/backups

# Create volume mount point for persistent storage
RUN mkdir -p /data

# Expose the application port
EXPOSE 3000

# Start the application server
CMD ["node", "server.js"]
