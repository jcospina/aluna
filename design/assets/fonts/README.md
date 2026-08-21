# Fonts

Both faces are vendored as a single variable `woff2` each, with no CDN and no
build step, matching how Outfit is vendored for the app in `public/fonts/`.

| File | Face | Licence |
| --- | --- | --- |
| `outfit-variable.woff2` | Outfit, weight 100–900 | SIL OFL 1.1; full text in `OFL-Outfit.txt` |
| `fraunces-variable.woff2` | Fraunces, weight 100–900, axes `SOFT` · `WONK` · `opsz` | SIL OFL 1.1; full text in `OFL-Fraunces.txt` |

`outfit-variable.woff2` is byte-identical to the copy already vendored at
`public/fonts/outfit-variable.woff2`.

Both binaries were extracted from the design artifacts, not fetched from
upstream; the two licence files came from the projects themselves
([Outfit](https://github.com/Outfitio/Outfit-Fonts),
[Fraunces](https://github.com/undercasetype/Fraunces)).

Fraunces is new to the repo. Outfit was already vendored for the app, Fraunces
was not. If the desktop surface ships, `public/fonts/` needs it too.
