FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
COPY shared/package.json shared/
COPY routing/package.json routing/
RUN npm install --workspaces --if-present --include-workspace-root
COPY tsconfig.base.json ./
COPY shared shared
COPY routing routing
RUN npm run build --workspace=@minicdn/shared
RUN npm run build --workspace=routing

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/routing ./routing
WORKDIR /app/routing
EXPOSE 5000
CMD ["node", "dist/server.js"]
