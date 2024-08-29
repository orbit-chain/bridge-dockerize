FROM node:18 as builder

WORKDIR /workspace

#Build
COPY package.json package.json
COPY yarn.lock yarn.lock
RUN yarn install --immutable --immutable-cache --check-cache

COPY src src

FROM node:18-alpine

RUN npm install -g pm2

COPY --from=builder workspace/node_modules node_modules
RUN apk --no-cache add curl

ARG ENV_FILE
COPY $ENV_FILE .env
COPY abi abi
COPY config config
COPY lib lib
COPY routes routes
COPY src src
COPY app.js app.js
COPY logger.js logger.js
COPY wallet.js wallet.js
COPY pm2.yaml pm2.yaml

ENTRYPOINT ["pm2-runtime", "pm2.yaml"]
