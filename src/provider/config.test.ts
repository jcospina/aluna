// Tests for provider configuration (Epic 1.5). The BYO-key and single-global-model
// rules are the headline guarantees: the key comes from the environment and fails
// loudly when absent (ARCH §4, ADR-0003), and exactly one model is configured —
// overridable in one place, never selected per call. Each case passes its own env
// object, so nothing mutates the real process environment.

import { describe, expect, test } from "bun:test";

import {
  API_KEY_ENV_VAR,
  BASE_URL_ENV_VAR,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  MODEL_ENV_VAR,
  requireApiKey,
  resolveBaseURL,
  resolveModel,
  resolveProviderConfig,
} from "./config.ts";

describe("requireApiKey (BYO key from the environment)", () => {
  test("returns the key when the env var is set", () => {
    expect(requireApiKey({ [API_KEY_ENV_VAR]: "sk-test-123" })).toBe("sk-test-123");
  });

  test("trims surrounding whitespace", () => {
    expect(requireApiKey({ [API_KEY_ENV_VAR]: "  sk-test-123  " })).toBe("sk-test-123");
  });

  test("throws a clear, actionable error when the key is missing", () => {
    expect(() => requireApiKey({})).toThrow(API_KEY_ENV_VAR);
    // The message names the variable and explains the BYO-key contract.
    expect(() => requireApiKey({})).toThrow(/bring-your-own-key/i);
  });

  test("treats an empty or whitespace-only value as missing", () => {
    expect(() => requireApiKey({ [API_KEY_ENV_VAR]: "" })).toThrow(API_KEY_ENV_VAR);
    expect(() => requireApiKey({ [API_KEY_ENV_VAR]: "   " })).toThrow(API_KEY_ENV_VAR);
  });
});

describe("resolveModel (a single global model)", () => {
  test("falls back to the one configured default when no override is set", () => {
    expect(resolveModel({})).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL.length).toBeGreaterThan(0);
  });

  test("a single env var overrides the global model (compare = run twice)", () => {
    expect(resolveModel({ [MODEL_ENV_VAR]: "gpt-5-fast" })).toBe("gpt-5-fast");
  });

  test("ignores an empty or whitespace-only override", () => {
    expect(resolveModel({ [MODEL_ENV_VAR]: "" })).toBe(DEFAULT_MODEL);
    expect(resolveModel({ [MODEL_ENV_VAR]: "   " })).toBe(DEFAULT_MODEL);
  });
});

describe("resolveBaseURL (the endpoint, third leg of the swap)", () => {
  test("falls back to the one configured default when no override is set", () => {
    expect(resolveBaseURL({})).toBe(DEFAULT_BASE_URL);
    expect(DEFAULT_BASE_URL.length).toBeGreaterThan(0);
  });

  test("a single env var overrides the endpoint (swap = point elsewhere)", () => {
    expect(resolveBaseURL({ [BASE_URL_ENV_VAR]: "https://api.anthropic.com/v1" })).toBe(
      "https://api.anthropic.com/v1",
    );
  });

  test("ignores an empty or whitespace-only override", () => {
    expect(resolveBaseURL({ [BASE_URL_ENV_VAR]: "" })).toBe(DEFAULT_BASE_URL);
    expect(resolveBaseURL({ [BASE_URL_ENV_VAR]: "   " })).toBe(DEFAULT_BASE_URL);
  });
});

describe("resolveProviderConfig (key + model + endpoint together)", () => {
  test("resolves the whole swap trio", () => {
    const config = resolveProviderConfig({
      [API_KEY_ENV_VAR]: "sk-test-123",
      [MODEL_ENV_VAR]: "claude-custom",
      [BASE_URL_ENV_VAR]: "https://api.anthropic.com/v1",
    });
    expect(config).toEqual({
      apiKey: "sk-test-123",
      model: "claude-custom",
      baseURL: "https://api.anthropic.com/v1",
    });
  });

  test("uses the default model and endpoint when only the key is set", () => {
    expect(resolveProviderConfig({ [API_KEY_ENV_VAR]: "sk-test-123" })).toEqual({
      apiKey: "sk-test-123",
      model: DEFAULT_MODEL,
      baseURL: DEFAULT_BASE_URL,
    });
  });

  test("propagates the missing-key error", () => {
    expect(() => resolveProviderConfig({})).toThrow(API_KEY_ENV_VAR);
  });
});
