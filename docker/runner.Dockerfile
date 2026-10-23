FROM oven/bun:1.3.14-debian AS bun-runtime

FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git make python3 python3-pip ripgrep tzdata \
    && rm -rf /var/lib/apt/lists/*

COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx \
    && corepack enable

ENV CI=1 \
    NO_COLOR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /workspace
CMD ["/bin/sh"]
