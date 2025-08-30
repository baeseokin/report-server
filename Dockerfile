# Step 1: Node.js 환경
FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3001

CMD ["node", "server.js"]

