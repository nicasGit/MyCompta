FROM node:24-bookworm-slim AS source
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# Refresh the source cache when main changes, then fetch that exact commit.
ADD https://api.github.com/repos/nicasGit/MyCompta/commits/main /tmp/mycompta-version.json
RUN git init . && git remote add origin https://github.com/nicasGit/MyCompta.git \
    && git fetch --depth 1 origin "$(node -p "require('/tmp/mycompta-version.json').sha")" \
    && git checkout --detach FETCH_HEAD \
    && npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=source /src/package.json /src/package-lock.json /src/app.js /src/server.js ./
COPY --from=source /src/node_modules ./node_modules
COPY --from=source /src/google ./google
COPY --from=source /src/services ./services
COPY --from=source /src/parsers ./parsers
COPY --from=source /src/public ./public
COPY addon.js ./
ENV NODE_ENV=production DATA_DIR=/data PORT=3001 LISTEN_HOST=0.0.0.0 MULTI_USER=true
EXPOSE 3001
CMD ["node", "addon.js"]
