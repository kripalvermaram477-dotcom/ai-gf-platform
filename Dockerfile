FROM node:20-slim

WORKDIR /app

# Copy package.json
COPY package.json ./

# Install production dependencies cleanly using built-in npm
RUN npm install --omit=dev

# Copy all application files
COPY . .

EXPOSE 3000
ENV PORT=3000

CMD ["node", "server.js"]
