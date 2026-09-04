# VoiceCraft-TTS + AutoEditor now has a backend!
FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Railway/Cloud Run inject PORT; the server respects it.
EXPOSE 3000

CMD ["node", "server.js"]
