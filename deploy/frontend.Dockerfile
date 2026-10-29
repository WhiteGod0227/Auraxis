FROM node:24-slim AS build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_API_BASE_URL=same-origin
RUN node scripts/build-deployment.mjs

FROM nginx:stable-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /frontend/dist-deploy/ /usr/share/nginx/html/
EXPOSE 80
