# Frontend image for the VPS: builds the Next.js app and serves it with `next start` on port 3000.
# Caddy (in /docker/n8n) puts it on https://app.187-124-96-140.sslip.io.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# NEXT_PUBLIC_* values are built into the pages, so they are set here, not at run time
ARG NEXT_PUBLIC_API_URL=https://api.187-124-96-140.sslip.io/api/v1
ARG NEXT_PUBLIC_BRAND_NAME=Arvistry
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_BRAND_NAME=$NEXT_PUBLIC_BRAND_NAME \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]
