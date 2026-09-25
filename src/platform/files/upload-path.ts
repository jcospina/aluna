// Where a form sends a file ahead of its save (7.1/07). Imports nothing, so the form that draws
// the address and the route that answers it share one spelling without the form loading the route.

export const FILE_UPLOAD_ROUTE = "/capability/:id/:incarnation_id/upload/:field";

export function fileUploadPath(capabilityId: string, incarnationId: string, field: string): string {
  const segments = [capabilityId, incarnationId, "upload", field].map(encodeURIComponent);
  return `/capability/${segments.join("/")}`;
}
