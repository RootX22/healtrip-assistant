import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("runs on the rule-based engine when no key is set", () => {
    expect(loadConfig({}).engine).toBe("rule-based");
  });

  it("uses Claude when a key is present", () => {
    expect(loadConfig({ ANTHROPIC_API_KEY: "sk-test" }).engine).toBe("claude");
  });

  it("treats empty values as unset, the way docker compose passes them", () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: "", LLM_ENGINE: "", DATABASE_URL: "" });
    expect(config).toMatchObject({ engine: "rule-based", databaseUrl: null });
  });

  it("refuses to start on Claude without a key", () => {
    expect(() => loadConfig({ LLM_ENGINE: "claude" })).toThrow(/requires ANTHROPIC_API_KEY/);
  });

  it("names the variable that is wrong", () => {
    expect(() => loadConfig({ PORT: "not-a-port" })).toThrow(/PORT/);
  });
});
