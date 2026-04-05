FROM node:20-slim AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src/ src/
RUN npx tsc

FROM node:20-slim
WORKDIR /app
COPY --from=build /app/dist dist/
COPY --from=build /app/node_modules node_modules/
COPY package.json ./
ENV NODE_ENV=production
EXPOSE 3100
CMD ["node", "dist/index.js"]
