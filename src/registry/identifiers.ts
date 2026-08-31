// The opaque identifiers the registry hands out, kept apart from the spec shape so the
// modules the spec is built from can name one without importing it.

import { z } from "zod";

/** One complete capability lifetime, assigned by the platform and never authored. */
export const incarnationIdSchema = z.string().uuid();
