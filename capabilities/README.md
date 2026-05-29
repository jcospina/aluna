# `capabilities/` — generated capability artifacts

Version-namespaced, AI-generated code for each capability, written here **at
runtime** by the Capability Builder (ARCH §5, §6.3).

```
capabilities/<id>/v<n>/   handler .ts files + compiled .html views
```

Everything under `<id>/v<n>/` is a **derived, version-keyed cache** — regenerated
only when a capability's spec version bumps, never otherwise (ARCH §9). The
registry row's `artifacts_path` points at the current version directory.

## Tracking

This directory is tracked (via this README) so it exists in a fresh checkout, but
its generated contents are **not** committed — see [`.gitignore`](../.gitignore).
Nothing here should be hand-edited or checked in.
