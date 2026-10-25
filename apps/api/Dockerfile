# Built from the repository root: docker build -f apps/api/Dockerfile .
FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @healtrip/contracts --workspace @healtrip/api
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN npm run build --workspace @healtrip/contracts && npm run build --workspace @healtrip/api

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts --workspace @healtrip/contracts --workspace @healtrip/api \
  && npm cache clean --force
COPY --from=build /repo/packages/contracts/dist packages/contracts/dist
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY apps/api/db apps/api/db
USER node
WORKDIR /repo/apps/api
EXPOSE 4000
HEALTHCHECK --interval=5s --timeout=3s --retries=12 CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "dist/main.js"]
