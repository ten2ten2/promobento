# CI browser regression image; not the deployable render service.
FROM ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
    ca-certificates curl xz-utils unzip fontconfig ffmpeg libatomic1 util-linux python3-fonttools python3-brotli \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 libxshmfence1 libdbus-1-3 libexpat1 \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL --retry 5 --max-time 180 https://nodejs.org/dist/v26.12.0/node-v26.12.0-linux-x64.tar.xz -o /tmp/node.tar.xz \
    && echo 'fd47865ecd6391ebb431fc815e01b9135bf83ded5cf373247e9331e196b7aded  /tmp/node.tar.xz' | sha256sum -c - \
    && tar -xJf /tmp/node.tar.xz --strip-components=1 -C /usr/local && rm /tmp/node.tar.xz \
    && npm install --global --ignore-scripts pnpm@12.14.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/film-runtime/package.json packages/film-runtime/package.json
COPY packages/blocks/package.json packages/blocks/package.json
COPY apps/cloud/package.json apps/cloud/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN node scripts/build-film-runtime.mjs \
    && curl -fsSL --retry 5 --max-time 180 https://storage.googleapis.com/chrome-for-testing-public/151.0.7922.34/linux64/chrome-headless-shell-linux64.zip -o /tmp/chrome.zip \
    && echo '3cfc2bd00d1bafcf8a68dc74c9c92bb7150ddc8d26ade948a776316e1cec4f14  /tmp/chrome.zip' | sha256sum -c - \
    && unzip -q /tmp/chrome.zip -d /opt && rm /tmp/chrome.zip \
    && mkdir -p /opt/fonts \
    && base64 -d packages/fonts/geist/geist-sans-latin-600-normal.woff.base64 > /tmp/geist.woff \
    && python3 -c "from fontTools.ttLib import TTFont; f=TTFont('/tmp/geist.woff', recalcTimestamp=False); f.flavor='woff2'; f.save('/opt/fonts/geist-sans-600.woff2')" \
    && cp packages/fonts/geist/geist-sans-OFL.txt /opt/fonts/ \
    && dpkg-query -W > /opt/environment-packages.txt \
    && useradd --uid 10001 --create-home controller && useradd --uid 10002 --create-home chromium \
    && mkdir /work /chrome && chown 10001:10001 /work && chown 10002:10002 /chrome
USER 10001:10001
ENV HOME=/work FONTCONFIG_FILE=/app/apps/render-container/tests/fontconfig.conf
CMD ["node", "apps/render-container/tests/browser.render.test.mjs"]
