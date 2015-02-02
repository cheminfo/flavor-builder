# flavor-builder
Visualize website generator

## Config
```json
{
  "couchurl": "http://visualizer.epfl.ch/",
  "couchUsername": "myusername",
  "couchPassword": "mypassword",
  "couchDatabase": "cheminfo",
  "flavor": "default",
  "dir": "./build",
  "layoutFile": "bootstrap/bootstrap.html",
  "configUrl": "http://example.com/path/to/my/config.json",
  "home": "Home"
}
```

All config options can be overwritten on the commandline:
``` node index.js --layoutFile="simple/page.html" ```
