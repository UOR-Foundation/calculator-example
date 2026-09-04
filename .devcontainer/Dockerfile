FROM docker.io/library/debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    ELAN_HOME=/usr/local/elan \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PATH=/usr/local/cargo/bin:/usr/local/elan/bin:$PATH

RUN apt-get update \
    && apt-get install --no-install-recommends --yes \
        build-essential ca-certificates coreutils=9.1-1 curl git jq libgmp10 \
        libssl-dev pkg-config ripgrep xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSfL \
        https://static.rust-lang.org/rustup/archive/1.28.2/x86_64-unknown-linux-gnu/rustup-init \
        -o /tmp/rustup-init \
    && echo "20a06e644b0d9bd2fbdbfd52d42540bdde820ea7df86e92e533c073da0cdd43c  /tmp/rustup-init" | sha256sum -c - \
    && chmod +x /tmp/rustup-init \
    && /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain 1.97.1 \
    && rm /tmp/rustup-init \
    && rustup component add rustfmt clippy rust-analyzer \
    && rustup target add wasm32-unknown-unknown

RUN curl --proto '=https' --tlsv1.2 -sSfL \
        https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-x64.tar.xz \
        -o /tmp/node.tar.xz \
    && echo "d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307  /tmp/node.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/node.tar.xz --strip-components=1 -C /usr/local \
    && rm /tmp/node.tar.xz \
    && node --version \
    && npm --version

RUN cargo install --locked wasm-bindgen-cli --version 0.2.122 \
    && cargo install --locked wasm-tools --version 1.258.0 \
    && cargo install --locked wasmtime-cli --version 48.0.1 \
    && cargo install --locked cargo-local-registry --version 0.2.12

RUN curl -sSfL https://github.com/leanprover/elan/releases/download/v4.2.3/elan-x86_64-unknown-linux-gnu.tar.gz -o elan.tar.gz \
    && echo "df0b2b3a439961ffcbb3985214365ffe40f49bc871df04dff268c7d8e21ca8b2  elan.tar.gz" | sha256sum -c - \
    && mkdir -p /tmp/elan-bin \
    && tar -xzf elan.tar.gz -C /tmp/elan-bin \
    && /tmp/elan-bin/elan-init -y --no-modify-path --default-toolchain none \
    && rm -rf elan.tar.gz /tmp/elan-bin \
    && elan toolchain install leanprover/lean4:v4.32.1

RUN curl -sSfL https://github.com/casey/just/releases/download/1.57.0/just-1.57.0-x86_64-unknown-linux-musl.tar.gz -o just.tar.gz \
    && echo "45b548094283cb9739af8f13273b8cddeee869f5b4ef2bb631b1f311cb566155  just.tar.gz" | sha256sum -c - \
    && tar -xzf just.tar.gz -C /usr/local/bin just \
    && rm just.tar.gz \
    && chmod +x /usr/local/bin/just

COPY package.json package-lock.json /tmp/calculator-browser/
RUN cd /tmp/calculator-browser \
    && npm ci --ignore-scripts \
    && ./node_modules/.bin/playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright

RUN git config --system --add safe.directory /workspaces/calculator-example

RUN groupadd --gid 1000 vscode \
    && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash vscode \
    && mkdir -p /home/vscode/.cargo/bin /home/vscode/.elan/tmp \
    && for binary in /usr/local/cargo/bin/*; do ln -s "$binary" "/home/vscode/.cargo/bin/$(basename "$binary")"; done \
    && ln -s /usr/local/elan/bin /home/vscode/.elan/bin \
    && ln -s /usr/local/elan/toolchains /home/vscode/.elan/toolchains \
    && chown -R vscode:vscode /home/vscode

ENV CARGO_HOME=/home/vscode/.cargo \
    ELAN_HOME=/home/vscode/.elan

WORKDIR /work
