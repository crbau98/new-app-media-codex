FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
