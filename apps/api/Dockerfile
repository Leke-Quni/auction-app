# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:24-bookworm-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Only the manifests the API needs, so the install layer is cached until dependencies change.
FROM base AS manifests
COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/

FROM manifests AS build
RUN yarn workspaces focus @auction/api
COPY packages/config packages/config
COPY packages/db packages/db
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN yarn workspace @auction/shared build \
 && yarn workspace @auction/db build \
 && yarn workspace @auction/api build

FROM manifests AS prod-deps
RUN yarn workspaces focus @auction/api --production

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=manifests /app/package.json package.json
COPY --from=build /app/packages/shared/package.json /app/packages/shared/
COPY --from=build /app/packages/shared/dist /app/packages/shared/dist
COPY --from=build /app/packages/db/package.json /app/packages/db/
COPY --from=build /app/packages/db/dist /app/packages/db/dist
COPY --from=build /app/apps/api/package.json /app/apps/api/
COPY --from=build /app/apps/api/dist /app/apps/api/dist
USER node
EXPOSE 8080
CMD ["node", "apps/api/dist/main.js"]
