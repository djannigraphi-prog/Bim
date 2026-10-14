# Image de production de l'API BIM (construite par la CI, publiée dans ECR).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && cp -r src/database/migrations dist/database/migrations && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S bim && adduser -S bim -G bim
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER bim
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/health || exit 1
# Migrations : lancées par une tâche séparée avant déploiement : node dist/database/migrate.js
CMD ["node", "dist/main.js"]
