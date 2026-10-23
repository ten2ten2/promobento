# G1 pre-probe image. Not the production render image: no digest pin on the base image,
# and the upstream site/ is assembled by prepare-site.mjs before the build.
FROM node:22-bookworm-slim

ARG APT_MIRROR=
RUN if [ -n "$APT_MIRROR" ]; then sed -i "s|http://deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources; fi \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip ffmpeg fontconfig \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libxshmfence1 libdbus-1-3 libexpat1 \
 && rm -rf /var/lib/apt/lists/*

# Same Chromium build as apps/render-container/environment.lock.json.
RUN curl -fsSL --retry 8 --retry-all-errors -o /tmp/chrome.zip https://storage.googleapis.com/chrome-for-testing-public/151.0.7922.34/linux64/chrome-headless-shell-linux64.zip \
 && echo "3cfc2bd00d1bafcf8a68dc74c9c92bb7150ddc8d26ade948a776316e1cec4f14  /tmp/chrome.zip" | sha256sum -c - \
 && unzip -q /tmp/chrome.zip -d /opt && rm /tmp/chrome.zip

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY init.mjs launcher.mjs controller.mjs spy.mjs ./
COPY site /site
EXPOSE 8080
CMD ["node", "/app/init.mjs"]
