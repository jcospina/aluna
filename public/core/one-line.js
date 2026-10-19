// @ts-check

/**
 * A character that ends a line, reverses the text after it, or is any other control character,
 * written once for the capability name the rename editor checks and the registry phrases the Intent
 * Resolver prints on one catalog line. `\p{Cc}` alone lets U+2028 through, and most tokenizers break
 * a line on it. Joiners and soft hyphens stay: Persian plurals need U+200C. A leaf, so the server
 * can import it without the page around it.
 */
export const LINE_OR_DIRECTION_BREAK = /[\p{Cc}\p{Zl}\p{Zp}‪-‮⁦-⁩]/u;
