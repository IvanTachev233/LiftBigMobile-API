# Stage 1: Build dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: Dev (hot-reload)
FROM deps AS dev
WORKDIR /app
COPY . .
CMD ["npm", "run", "start:dev"]

# Stage 3: Build for production
FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

# Stage 4: Production
FROM node:20-alpine AS production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
EXPOSE 3000
CMD ["node", "dist/main"]
