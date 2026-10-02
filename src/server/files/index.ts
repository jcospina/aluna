// The platform's file addresses (ADR-0009): the upload a form sends ahead of its save, the
// pending-only route a form hands back an unsaved upload through, and `/files/:key`, which serves
// what the upload admitted. Registered before the capability router, whose fixed
// `/capability/:id/:action` convention knows none of them.

import type { Hono } from "hono";
import { registerFileDiscardRoute } from "./discard/discard-route.ts";
import { registerFileServeRoute } from "./serve/serve-route.ts";
import { type FileUploadDeps, registerFileUploadRoute } from "./upload/upload-route.ts";

export function registerFileRoutes(app: Hono, deps: FileUploadDeps): void {
  registerFileUploadRoute(app, deps);
  registerFileDiscardRoute(app, deps);
  registerFileServeRoute(app, deps);
}
