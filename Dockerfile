FROM node:24-bookworm-slim AS build
WORKDIR /app
ARG APP_BASE_PATH=/
ENV APP_BASE_PATH=${APP_BASE_PATH}
COPY package*.json ./
RUN npm ci
COPY tsconfig.json vite.config.js index.html ./
COPY app ./app
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 DB_PATH=/app/data/part-viewer.sqlite
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts ./scripts
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server/index.js"]
