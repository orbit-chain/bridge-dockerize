FROM node:latest
RUN npm install -g pm2
COPY nodes/validator/package.json /validator/package.json
RUN cd /validator && yarn
COPY nodes/validator /validator
ARG SETTINGS_FILEPATH
COPY $SETTINGS_FILEPATH /validator/config/docker/settings.js
COPY pm2.yaml /pm2.yaml
CMD ["pm2-runtime", "pm2.yaml"]
