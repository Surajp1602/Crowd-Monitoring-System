# Edge image: builds the product site and serves it with the proxy config for the control center.
FROM node:22-slim AS site
WORKDIR /srv/apps/landing
COPY apps/landing/package.json apps/landing/package-lock.json ./
RUN npm ci
COPY apps/landing ./
ARG VITE_DASHBOARD_URL=https://app.localhost
ENV VITE_DASHBOARD_URL=$VITE_DASHBOARD_URL
RUN npm run build

FROM nginx:1.27-alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY infra/nginx/snippets /etc/nginx/snippets
COPY infra/nginx/templates /etc/nginx/templates
COPY --from=site /srv/apps/landing/dist /usr/share/nginx/site
ENV APP_HOST=app.localhost SITE_HOST=localhost
EXPOSE 80 443
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
