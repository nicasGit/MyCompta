FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
ENV NODE_ENV=production DATA_DIR=/data PORT=3001 LISTEN_HOST=0.0.0.0 MULTI_USER=true
EXPOSE 3001
CMD ["node", "addon.js"]
