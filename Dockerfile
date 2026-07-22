# Lean, deterministic image for fast Railway/Cloud Run/container builds.
FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

# Copy only the manifests first so the dependency layer is cached and only
# reinstalls when package.json / lock file actually change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Then the application code.
COPY . .

# Railway/Cloud Run inject PORT; the server already respects it.
EXPOSE 3000

CMD ["node", "server.js"]
