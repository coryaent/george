FROM node:20-alpine

ENV GARAGE_CONSTRAINT_LABEL=yachts.swarm.garage
ENV GARAGE_ZONE_LABEL=yachts.swarm.garage.zone
ENV GARAGE_CAPACITY_LABEL=yachts.swarm.garage.capacity
ENV GARAGE_TAGS_LABEL=yachts.swarm.garage.tags
ENV GARAGE_RPC_PORT=3901
ENV GARAGE_ADMIN_PORT=3903

WORKDIR /usr/local/src/

COPY ./package*.json ./

RUN npm install

COPY ./index.js ./

ENTRYPOINT ["node"]

CMD ["index.js"]
