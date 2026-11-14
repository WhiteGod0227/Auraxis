FROM node:24-slim AS build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_API_BASE_URL=same-origin
RUN node scripts/build-deployment.mjs

FROM nginx:stable-alpine
ENV NGINX_ENVSUBST_FILTER=BACKEND_UPSTREAM
COPY deploy/railway.nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /frontend/dist-deploy/ /usr/share/nginx/html/
EXPOSE 80
