/** The same-origin address a file is served from, `/files/<key>` (7.1/07). Imports nothing. */
export const FILE_URL_PREFIX = "/files/";

export function fileUrl(key: string): string {
  return `${FILE_URL_PREFIX}${key}`;
}
