// The platform's two file addresses (ADR-0009): the upload a form sends ahead of its save, and
// `/files/:key`, which serves what the upload admitted. Registered before the capability router,
// whose fixed `/capability/:id/:action` convention knows neither.

import type { Hono } from "hono";
import { registerFileServeRoute } from "./serve-route.ts";
import { type FileRouteDeps, registerFileUploadRoute } from "./upload-route.ts";

export { FILE_NAME_HEADER } from "#shell/shell-dom.js";
export { fileUploadPath } from "../../platform/files/upload-path.ts";
export type { FileRouteDeps } from "./upload-route.ts";

export function registerFileRoutes(app: Hono, deps: FileRouteDeps): void {
  registerFileUploadRoute(app, deps);
  registerFileServeRoute(app, deps);
}
