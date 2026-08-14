# Playwright's own image already carries Chromium and its system libraries, which is
# the entire reason a DropWatch container is worth having.
FROM mcr.microsoft.com/playwright:v1.49.1-noble AS build

WORKDIR /app
COPY package.json package-lock.json* ./
# Browsers are already in the base image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev


FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3070 \
    HOST=0.0.0.0 \
    DROPWATCH_DATA_DIR=/data

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/bin ./bin
COPY --from=build /app/package.json ./package.json

# The database lives on a volume so watches and history survive a container rebuild.
VOLUME ["/data"]
EXPOSE 3070

RUN mkdir -p /data && chown -R pwuser:pwuser /data /app
USER pwuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3070/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/index.js"]
