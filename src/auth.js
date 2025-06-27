export function getAuthorizationHeader(config) {
  if (config.couchUsername && config.couchPassword) {
    return {
      Authorization: `Basic ${Buffer.from(
        `${config.couchUsername}:${config.couchPassword}`,
      ).toString('base64')}`,
    };
  } else {
    return {};
  }
}
