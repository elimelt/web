FROM ubuntu:24.04

ARG RUNNER_VERSION=2.328.0
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive
ENV RUNNER_ALLOW_RUNASROOT=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    jq \
    libicu74 \
    tar \
    unzip \
    docker.io \
    docker-compose-v2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/actions-runner

RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) runner_arch=x64 ;; \
      arm64) runner_arch=arm64 ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${runner_arch}-${RUNNER_VERSION}.tar.gz" \
      | tar -xz

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
