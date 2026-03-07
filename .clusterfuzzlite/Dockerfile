FROM gcr.io/oss-fuzz-base/base-builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .

RUN npm ci
