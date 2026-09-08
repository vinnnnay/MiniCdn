FROM node:20-alpine AS build
WORKDIR /app/dashboard
COPY dashboard/package.json ./
RUN npm install
COPY dashboard .

# These become part of the built JS bundle (Vite bakes VITE_* vars in at
# build time) — pass them via `docker build --build-arg` or Fly's
# [build.args] section (see dashboard/fly.toml). Safe to leave unset for a
# local build; config.ts falls back to localhost in that case.
ARG VITE_ORIGIN_URL
ARG VITE_ROUTING_URL
ARG VITE_EDGE_US_URL
ARG VITE_EDGE_EU_URL
ARG VITE_EDGE_ASIA_URL
ENV VITE_ORIGIN_URL=$VITE_ORIGIN_URL
ENV VITE_ROUTING_URL=$VITE_ROUTING_URL
ENV VITE_EDGE_US_URL=$VITE_EDGE_US_URL
ENV VITE_EDGE_EU_URL=$VITE_EDGE_EU_URL
ENV VITE_EDGE_ASIA_URL=$VITE_EDGE_ASIA_URL

RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dashboard/dist ./dist
EXPOSE 5173
CMD ["serve", "-s", "dist", "-l", "5173"]
