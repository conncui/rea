FROM node:24-alpine

WORKDIR /app
COPY apps/upstream-sync /app

USER node
EXPOSE 3000
CMD ["node", "index.mjs"]
