FROM ghcr.io/puppeteer/puppeteer:24.4.0

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false

WORKDIR /app

COPY --chown=pptruser:pptruser package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --chown=pptruser:pptruser . .

RUN mkdir -p .output

EXPOSE 3847
CMD ["node", "server.mjs"]
