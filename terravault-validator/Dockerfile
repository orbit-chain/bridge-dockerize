FROM node:dubnium
ENV PROFILE=docker
COPY nodes/validator/package.json /validator/package.json
RUN cd /validator && yarn
COPY nodes/validator /validator
COPY terravault-validator/settings.js /validator/config/docker/
CMD cd validator && node validator_docker.js