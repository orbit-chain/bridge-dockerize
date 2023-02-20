FROM node:18 as builder

WORKDIR /workspace

#Build
COPY package.json package.json
COPY yarn.lock yarn.lock
RUN yarn install --immutable --immutable-cache --check-cache

COPY src src

FROM node:18-alpine

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

COPY --from=builder workspace/node_modules node_modules

ENTRYPOINT ["node", "app.js", "--max_old_space_size=1536", "--expose-gc"]
