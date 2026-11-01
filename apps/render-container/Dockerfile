# One pinned Linux environment for native huashu-motion and real browser/media CI.
FROM ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac AS environment
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
    ca-certificates curl xz-utils unzip fontconfig ffmpeg=7:6.1.1-3ubuntu5 libatomic1 util-linux \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 libxshmfence1 libdbus-1-3 libexpat1 \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL --retry 5 --max-time 180 https://nodejs.org/dist/v26.12.0/node-v26.12.0-linux-x64.tar.xz -o /tmp/node.tar.xz \
    && echo 'fd47865ecd6391ebb431fc815e01b9135bf83ded5cf373247e9331e196b7aded  /tmp/node.tar.xz' | sha256sum -c - \
    && tar -xJf /tmp/node.tar.xz --strip-components=1 -C /usr/local && rm /tmp/node.tar.xz
RUN curl -fsSL --retry 5 --max-time 180 https://storage.googleapis.com/chrome-for-testing-public/151.0.7922.34/linux64/chrome-headless-shell-linux64.zip -o /tmp/chrome.zip \
    && echo '3cfc2bd00d1bafcf8a68dc74c9c92bb7150ddc8d26ade948a776316e1cec4f14  /tmp/chrome.zip' | sha256sum -c - \
    && unzip -q /tmp/chrome.zip -d /opt && rm /tmp/chrome.zip
WORKDIR /app
COPY packages/contracts/src/canonical.mjs packages/contracts/src/canonical.mjs
COPY packages/native-motion/upstream.lock.json packages/native-motion/upstream.lock.json
COPY packages/native-motion/scripts/verify-upstream.mjs packages/native-motion/scripts/verify-upstream.mjs
COPY packages/native-motion/scripts/apply-cloud-patch.mjs packages/native-motion/scripts/apply-cloud-patch.mjs
COPY packages/native-motion/src/policy.mjs packages/native-motion/src/policy.mjs
# Keep the entire upstream checkout: CLI, studio, runtime, templates, fonts, examples and skill references.
# Verify every extracted byte against the fixed Git tree, including files outside npm's published subset.
RUN curl -fsSL --retry 5 --max-time 180 https://codeload.github.com/alchaincyf/huashu-motion/tar.gz/52467f99c602b76ba86d511d37acdfe93fa1e16e -o /tmp/huashu.tar.gz \
    && mkdir /opt/huashu-motion && tar -xzf /tmp/huashu.tar.gz --strip-components=1 -C /opt/huashu-motion \
    && node packages/native-motion/scripts/verify-upstream.mjs /opt/huashu-motion \
    && node packages/native-motion/scripts/apply-cloud-patch.mjs /opt/huashu-motion && rm /tmp/huashu.tar.gz \
    && ln -s /opt/huashu-motion/cli/om.js /usr/local/bin/om
COPY packages/contracts/src packages/contracts/src
COPY packages/native-motion packages/native-motion
COPY apps/render-container apps/render-container
RUN useradd --uid 10001 --create-home controller && useradd --uid 10002 --create-home chromium && useradd --uid 10003 --no-create-home supervisor \
    && install -d -o 10001 -g 10001 -m 0700 /work \
    && install -d -o 10002 -g 10002 -m 0700 /chrome /chrome/tmp \
    && install -d -o 10001 -g 10001 -m 2770 /jobs \
    && install -d -o 10002 -g 10001 -m 2770 /run/promobento \
    && install -d -o 10002 -g 10002 -m 0770 /artifacts \
    && dpkg-query -W > /opt/environment-packages.txt
ENV OM_CHROME=/opt/chrome-headless-shell-linux64/chrome-headless-shell \
    HUASHU_MOTION_ROOT=/opt/huashu-motion HOME=/chrome TMPDIR=/chrome/tmp \
    FONTCONFIG_FILE=/app/apps/render-container/tests/fontconfig.conf

FROM environment AS browser-test
USER 10002:10002
CMD ["node", "apps/render-container/tests/native.render.test.mjs"]

FROM environment AS runtime
USER 0:0
EXPOSE 8080
ENTRYPOINT ["node", "apps/render-container/src/init.mjs"]
