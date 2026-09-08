import { NOTES_INCARNATION_ID } from "../../runtime/router/dispatch/router.test-support.ts";
import { CAPABILITY_LOGO_FILENAME } from "./artifact-names.ts";
import type { LogoGenerationProvider } from "./generation/provider.ts";

// The two paid logo routes, as the suites that drive them address them. Both inject their
// provider through `createApp`: nothing here reaches the network, which is the point of the seam.

export const ARTWORK = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

export const ATTEMPT_PATH = `/capability/notes/${NOTES_INCARNATION_ID}/logo-attempt`;
export const LOGO_PATH = `/capability/notes/${NOTES_INCARNATION_ID}/${CAPABILITY_LOGO_FILENAME}`;

export const GZIP: RequestInit = { headers: { "accept-encoding": "gzip, deflate, br" } };

// What the tile sends. htmx puts `HX-Request` on every request it makes, and the route requires
// it, so a cross-origin form cannot reach the paid operation.
export const ATTEMPT: RequestInit = { method: "POST", headers: { "HX-Request": "true" } };

/** A service that always answers with artwork. */
export const drawing: LogoGenerationProvider = { generate: async () => ARTWORK };
