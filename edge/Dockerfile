FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
COPY shared/package.json shared/
COPY edge/package.json edge/
RUN npm install --workspaces --if-present --include-workspace-root
COPY tsconfig.base.json ./
COPY shared shared
COPY edge edge
RUN npm run build --workspace=@minicdn/shared
RUN npm run build --workspace=edge

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/edge ./edge
WORKDIR /app/edge
EXPOSE 4001
CMD ["node", "dist/server.js"]
