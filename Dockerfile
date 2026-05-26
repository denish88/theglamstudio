FROM node:24.12.0

WORKDIR /app

COPY package*.json ./

COPY . .

EXPOSE 3000

CMD ["sh", "-c", "sleep infinity"]
#CMD ["node", "src/server.js"]