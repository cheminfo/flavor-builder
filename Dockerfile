FROM node:20-slim

RUN apt-get update && apt-get install -y cron git

# Get flavor-builder
WORKDIR /git/flavor-builder
COPY package.json package-lock.json ./
RUN npm ci

COPY crontab /etc/cron.d/flavorbuilder
RUN chmod 744 /etc/cron.d/flavorbuilder
RUN touch /var/log/cron.log

COPY start.sh /start.sh
RUN chmod 744 /start.sh

COPY on-tabs-config.json /on-tabs-config.json

COPY ./ ./

CMD /start.sh
