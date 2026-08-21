# Fonts

Both faces are vendored here as a single variable `woff2` each, with no CDN and
no build step. This directory is the shipped source for the app and design pages.

| File | Face | Licence |
| --- | --- | --- |
| `outfit-variable.woff2` | Outfit, weight 100–900 | SIL OFL 1.1; full text in `OFL-Outfit.txt` |
| `fraunces-variable.woff2` | Fraunces, weight 100–900, axes `SOFT` · `WONK` · `opsz` | SIL OFL 1.1; full text in `OFL-Fraunces.txt` |

Both binaries were extracted from the design artifacts, not fetched from
upstream; the two licence files came from the projects themselves
([Outfit](https://github.com/Outfitio/Outfit-Fonts),
[Fraunces](https://github.com/undercasetype/Fraunces)).

The app serves both binaries directly from this directory through `/design/`.
