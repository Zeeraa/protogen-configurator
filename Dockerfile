# Stage 1: build
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: serve with Apache
FROM httpd:2.4-alpine
COPY --from=builder /app/dist/protogen-configurator/browser/ /usr/local/apache2/htdocs/
COPY docker/httpd.conf /usr/local/apache2/conf/httpd.conf
