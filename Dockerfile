# Multi-stage build for Node.js
FROM node:20 AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Production stage
FROM node:20-slim

WORKDIR /app

# Copy dependencies from build stage
COPY --from=build /app/node_modules ./node_modules

# Copy application code
COPY . .

# Create uploads directory
RUN mkdir -p uploads

# Environment variables
ENV PORT=8084
ENV NODE_ENV=production

EXPOSE 8084

CMD ["node", "index.js"]