# One environment for the render service and its CI browser/media checks.
FROM ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac AS environment
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
    ca-certificates curl xz-utils unzip fontconfig ffmpeg=7:6.1.1-3ubuntu5 libatomic1 util-linux python3-fonttools python3-brotli \
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
# Fixed browser/GSAP downloads do not depend on application or documentation edits.
# Keep them ahead of the source layer so a small runtime repair reuses the Actions build cache.
RUN curl -fsSL --retry 5 --max-time 180 https://storage.googleapis.com/chrome-for-testing-public/151.0.7922.34/linux64/chrome-headless-shell-linux64.zip -o /tmp/chrome.zip \
    && echo '3cfc2bd00d1bafcf8a68dc74c9c92bb7150ddc8d26ade948a776316e1cec4f14  /tmp/chrome.zip' | sha256sum -c - \
    && unzip -q /tmp/chrome.zip -d /opt && rm /tmp/chrome.zip \
    && curl -fsSL --retry 5 --max-time 180 https://registry.npmjs.org/gsap/-/gsap-3.14.2.tgz -o /tmp/gsap.tgz \
    && tar -xzf /tmp/gsap.tgz -C /tmp package/dist/gsap.min.js \
    && echo 'c174bfce53a729418d57a8ad8625e7247c793a22fef8e2851e3cfa3de9cd8280  /tmp/package/dist/gsap.min.js' | sha256sum -c - \
    && mkdir -p /opt/gsap && cp /tmp/package/dist/gsap.min.js /opt/gsap/gsap.js \
    && curl -fsSL --retry 5 --max-time 60 https://gsap.com/community/standard-license/ -o /opt/GSAP-LICENSE.html \
    && head -n 9 /tmp/package/dist/gsap.min.js > /opt/GSAP-LICENSE.txt \
    && rm -rf /tmp/package /tmp/gsap.tgz
COPY . .
RUN node scripts/build-film-runtime.mjs \
    && cp /opt/gsap/gsap.js packages/film-runtime/dist/browser/gsap.js \
    && node scripts/build-render-fonts.mjs /opt/fonts \
    && dpkg-query -W > /opt/environment-packages.txt \
    && useradd --uid 10001 --create-home controller && useradd --uid 10002 --create-home chromium && useradd --uid 10003 --no-create-home supervisor \
    && mkdir /work /chrome && chown 10001:10001 /work && chown 10002:10002 /chrome
ENV HOME=/work FONTCONFIG_FILE=/app/apps/render-container/tests/fontconfig.conf

FROM environment AS browser-test
USER 10001:10001
CMD ["node", "apps/render-container/tests/browser.render.test.mjs"]

FROM environment AS runtime
# PID 1 creates uid-separated children and immediately drops itself to uid 10003 (no capabilities).
USER 0:0
EXPOSE 8080
ENTRYPOINT ["node", "apps/render-container/src/init.mjs"]
