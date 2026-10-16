import type { Context } from "hono";
import { NO_STORE } from "../../../server/http/cache-headers.ts";
import { pressFrom, staleIfDropped } from "../front-half.ts";
import type { CapabilityLinkHttpDeps } from "../http.ts";
import {
  answerLinkNotice,
  LINK_STALE_CODE,
  LINK_UNREADABLE_CODE,
  notLinkedNotice,
} from "../presentation.ts";
import { unlinkCapabilityField } from "./unlink.ts";

/**
 * The broken chain's press: nothing to say once it is written, since the field turning plain text
 * again is the answer; a refusal is a notice the prompt bar speaks, as the Link control's are.
 */
export async function answerUnlink(c: Context, deps: CapabilityLinkHttpDeps): Promise<Response> {
  const form = await c.req.raw.formData().catch(() => null);
  const press = form && pressFrom(c.req.param("id") ?? "", c.req.param("field") ?? "", form);
  if (!press) return answerLinkNotice(c, { code: LINK_UNREADABLE_CODE, disconnecting: true });
  const outcome = await staleIfDropped(() =>
    unlinkCapabilityField(press, {
      database: deps.registryReadwrite,
      readonlyDatabase: deps.registryReadonly,
      mutationCoordinator: deps.mutationCoordinator,
      signal: c.req.raw.signal,
    }),
  );
  switch (outcome.status) {
    case "unlinked":
      return c.body(null, 204, NO_STORE);
    case "not_linked":
      return answerLinkNotice(c, notLinkedNotice(outcome.source));
    case "stale": {
      const notice = { code: LINK_STALE_CODE, moved: outcome.moved, disconnecting: true } as const;
      return answerLinkNotice(c, notice);
    }
  }
}
