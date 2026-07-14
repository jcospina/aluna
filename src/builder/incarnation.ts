// One opaque, platform-owned identity for a capability lifetime. The generator
// lives outside spec generation so model output can neither author nor preserve it.
export function createCapabilityIncarnationId(): string {
  return crypto.randomUUID();
}
