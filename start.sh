#!/bin/bash

printenv | sed 's/^\(.*\)$/export \1/g' > /env.sh

service cron start
echo "started services"

cd /git/flavor-builder/node_modules/visualizer-on-tabs
node bin/build.js --outDir=/var/www/html/on-tabs/ --config=/on-tabs-config.json

tail -f /var/log/cron.log
