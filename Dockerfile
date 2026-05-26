FROM node:24.12.0

RUN apk add --no-cache vips-dev

WORKDIR /app

COPY package*.json ./

COPY . .

EXPOSE 3000

CMD ["node", "src/server.js"]
