# VoiceCraft-TTS + AutoEditor now has a backend!
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN apt-get update && apt-get install -y awscli ffmpeg && rm -rf /var/lib/apt/lists/*
RUN npm ci --omit=dev

COPY . .

# Railway/Cloud Run inject PORT; the server respects it.
EXPOSE 3000

CMD ["node", "server.js"]
