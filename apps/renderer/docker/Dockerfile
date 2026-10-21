FROM ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install -y --no-install-recommends ca-certificates curl xz-utils unzip fontconfig \
    ffmpeg=7:6.1.1-3ubuntu5 && rm -rf /var/lib/apt/lists/*
# Node 26's official Linux binary requires libatomic even before pnpm can run.
RUN apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install -y --no-install-recommends libatomic1 \
    && rm -rf /var/lib/apt/lists/*
RUN curl --fail --location --silent --show-error --retry 3 --max-time 180 --proto '=https' \
      https://nodejs.org/dist/v26.12.0/node-v26.12.0-linux-x64.tar.xz -o /tmp/node.tar.xz \
    && echo 'fd47865ecd6391ebb431fc815e01b9135bf83ded5cf373247e9331e196b7aded  /tmp/node.tar.xz' | sha256sum -c - \
    && tar -xJf /tmp/node.tar.xz --strip-components=1 -C /usr/local && rm /tmp/node.tar.xz \
    && npm install --global --ignore-scripts pnpm@12.14.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/composition-runtime/package.json ./packages/composition-runtime/package.json
COPY apps/renderer/package.json ./apps/renderer/package.json
RUN sed -i 's|http://|https://|g' /etc/apt/sources.list.d/ubuntu.sources \
    && printf 'Acquire::Retries "3";\nAcquire::http::Timeout "60";\nAcquire::https::Timeout "60";\n' > /etc/apt/apt.conf.d/80-promobento-network \
    && pnpm install --frozen-lockfile --ignore-scripts \
    && pnpm --filter @promobento/renderer exec playwright-core install-deps chromium
COPY . .
# Downloaded only during image preparation. Tasks have no network and no package installation.
ENV PROMOBENTO_BROWSER_DIR=/browser
RUN node apps/renderer/scripts/install-browser.mjs \
    && chown -R 65532:65532 /browser && chmod 0700 /browser
ARG SOURCE_TREE_HASH
LABEL com.promobento.admission.source-tree=$SOURCE_TREE_HASH
USER 65532:65532
ENV HOME=/tmp
ENTRYPOINT ["node", "apps/renderer/scripts/admission-worker.mjs"]
