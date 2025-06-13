# flavor-builder

Visualizer website generator

## Test the build

To test the build, run:

```bash
DEBUG=flavor-builder:info node bin/build.js  --config=./cheminfo-config.json
```

As configured by `cheminfo-config.json`, this will write to the `build` directory:

- `cheminfo-revisions.json` and `cheminfo-md5.json` which keep track of what has been updated.
- `cheminfo-flavor-builder.pid` which is used as a lock to know if a build is already in progress.
- `out` directory which contains the result of the build

Build the admin page by running:

```bash
mkdir build/out/on-tabs
node node_modules/visualizer-on-tabs/bin/build.js --outDir=$(realpath ./build/out/on-tabs/) --config=$(realpath ./on-tabs-config.json)
```

To test the built website using apache, run:

```bash
docker compose up -d
```

Home page: `http://localhost:6060`
`on-tabs` admin page: `http://localhost:6060/on-tabs/`
Example of on-tabs page: `http://localhost:6060/flavor/eln/reaction/index.html`

`on-tabs` pages are not expected to fully work with this setup.

## CLI usage

To force the rebuild you should add the option `--forceUpdate`.

## Docker image

This repository publishes a docker image on github.

It is responsible for building static assets but not for running a web server like apache or nginx.

- The outputs of the builds are written to `/var/www/html/` base directory on the container.
- Runs a command when the container starts that builds the visualizer admin page to the `on-tabs` directory, based on the `/on-tabs-config.json` configuration file.
- Runs a command every minute which builds pages to the base directory based on the `/flavor-config.json` configuration file.
