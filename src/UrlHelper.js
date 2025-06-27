export class UrlHelper {
  constructor(config) {
    this.config = config;
  }

  getViewUrl(el, type) {
    return el.__view
      ? `${getCouchUrlByType(this.config, type)}/${this.config.couchDatabase}/${
          el.__id
        }/view.json?rev=${el.__rev}`
      : undefined;
  }

  getDataUrl(el, type) {
    return el.__data
      ? `${getCouchUrlByType(this.config, type)}/${this.config.couchDatabase}/${
          el.__id
        }/data.json?rev=${el.__rev}`
      : undefined;
  }

  buildQueryString(el, flavorName) {
    let result = '?';
    let config = getFlavorConfig(this.config, flavorName);

    if (config.lockView) {
      if (result !== '?') result += '&';
      result += 'lockView=1';
    }

    if (result === '?') return '';
    return result;
  }
}

function getCouchUrlByType(config, type) {
  if (type === 'local') {
    return config.couchLocalUrl;
  } else if (type === 'public') {
    return config.couchurl;
  }
  throw new Error('getCouchUrlByType: type must be "local" or "public"');
}

function getFlavorConfig(config, flavorName) {
  flavorName = flavorName || config.flavor;
  if (config.flavorConfig && config.flavorConfig[flavorName]) {
    return config.flavorConfig[flavorName];
  }
  return {};
}
