FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public

RUN mkdir -p /app/data

ENV PORT=8080 \
    MQTT_PORT=1883 \
    NODE_ENV=production

EXPOSE 8080 1883

CMD ["node", "server/index.js"]
