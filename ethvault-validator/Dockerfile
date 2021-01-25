FROM node:fermium
COPY nodes/validator/package.json /validator/package.json
RUN cd /validator && yarn
COPY nodes/validator /validator
ARG SETTINGS_FILEPATH
COPY $SETTINGS_FILEPATH /validator/config/docker/settings.js
CMD cd validator && node validator_docker.js
