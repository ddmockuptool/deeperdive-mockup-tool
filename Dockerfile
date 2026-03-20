FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    dumb-init \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libcups2 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    libgtk-3-0 \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY . .

RUN mkdir -p .output

EXPOSE 3847
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.mjs"]
