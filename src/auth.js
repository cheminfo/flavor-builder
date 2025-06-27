export function getAuthorizationHeader(username, password) {
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString(
      'base64',
    )}`,
  };
}
