# Étape 1 — construction de la console
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
RUN npx vite build

# Étape 2 — runtime avec Chromium et toutes ses bibliothèques système
FROM mcr.microsoft.com/playwright:v1.65.1-noble
WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    WEBIA_ENGINE=chromium \
    HOST=0.0.0.0 \
    PORT=8787
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY bin ./bin
COPY --from=build /app/dist ./dist
# Les profils (cookies, sessions) vivent dans /data : à monter en volume.
ENV WEBIA_DATA_DIR=/data
RUN mkdir -p /data && chown -R pwuser:pwuser /data
USER pwuser
EXPOSE 8787
CMD ["node", "server/cli.js"]
