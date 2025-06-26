# flavor-builder

Visualizer website generator

## Test the build

To test the build, run:

```bash
DEBUG=flavor-builder:info node bin/build.js  --config=./configs/cheminfo.json
```

There are other build configurations available in the `configs` directory to test.

As configured by `configs/cheminfo.json`, this will write to the `build` directory:

- `cheminfo-revisions.json` and `cheminfo-md5.json` which keep track of what has been updated.
- `cheminfo-flavor-builder.pid` which is used as a lock to know if a build is already in progress.
- `out` directory which contains the result of the build

Build the admin page by running:

```bash
mkdir build/out/on-tabs
node node_modules/visualizer-on-tabs/bin/build.js --outDir=$(realpath ./build/cheminfo/out/on-tabs/) --config=$(realpath ./configs/on-tabs.json)
```

To test the built website using apache, run:

```bash
docker compose up -d
```

Home page: `http://localhost:6060`
Example of on-tabs page: `http://localhost:6060/flavor/eln/reaction/index.html`

If you built the admin page, you can access it at: `http://localhost:6060/on-tabs/`

## Test an alternative build

Use your own configuration or build from one of the existing ones in the `configs` directory.

```bash
DEBUG=flavor-builder:info node bin/build.js  --config=./configs/flavor-1024.json
# Will serve build/flavor-1024/out/ on port 6060
SERVE_DIR=flavor-1024 docker compose up -d
open http://localhost:6060/
```

> **Warning**
> The `on-tabs` page is not fully functional in this setup.

> [!WARNING]  
> Critical content demanding immediate user attention due to potential risks.

TODO: example with couch authentication.

## CLI usage

To force the rebuild you should add the option `--forceUpdate`.

## Docker image

This repository publishes a docker image on github.

It is responsible for building static assets but not for running a web server like apache or nginx.

- The outputs of the builds are written to `/var/www/html/` base directory on the container.
- Runs a command when the container starts that builds the visualizer admin page to the `on-tabs` directory, based on the `/on-tabs-config.json` configuration file.
- Runs a command every minute which builds pages to the base directory based on the `/flavor-config.json` configuration file.
