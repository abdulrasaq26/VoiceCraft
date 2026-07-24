# Blvck-TTS is a zero-dependency static site served by a tiny Node http
# server (server.js). No npm install needed — there are no dependencies.
FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

COPY . .

# Railway/Cloud Run inject PORT; the server respects it.
EXPOSE 3000

CMD ["node", "server.js"]
