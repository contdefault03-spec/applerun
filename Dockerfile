# Game server + built client in one container (Fly.io, Railway, any Docker host).
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=optional
COPY . .
RUN npm run build
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server/index.js"]
