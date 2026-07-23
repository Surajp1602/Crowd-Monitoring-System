FROM node:22-slim AS base
WORKDIR /srv/apps/frontend
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY apps/frontend/package.json apps/frontend/package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /srv/apps/frontend/node_modules ./node_modules
COPY apps/frontend ./

ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /srv/apps/frontend/public ./public
COPY --from=builder --chown=nextjs:nodejs /srv/apps/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /srv/apps/frontend/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
    CMD node -e "fetch('http://localhost:3000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
