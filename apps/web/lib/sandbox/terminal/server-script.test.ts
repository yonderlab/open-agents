import { describe, expect, test } from "bun:test";
import { TERMINAL_GATEWAY_SCRIPT } from "./server-script";

describe("TERMINAL_GATEWAY_SCRIPT", () => {
  test("serves any file under /dist so Ghostty support chunks can load", () => {
    expect(TERMINAL_GATEWAY_SCRIPT).toContain(
      'url.pathname.startsWith("/dist/")',
    );
    expect(TERMINAL_GATEWAY_SCRIPT).toContain("resolvedDistPath");
    expect(TERMINAL_GATEWAY_SCRIPT).toContain("fileURLToPath(import.meta.url)");
    expect(TERMINAL_GATEWAY_SCRIPT).not.toContain(
      'url.pathname === "/dist/ghostty-web.js"',
    );
  });

  test("includes a versioned health response for gateway lifecycle management", () => {
    expect(TERMINAL_GATEWAY_SCRIPT).toContain("GATEWAY_VERSION");
    expect(TERMINAL_GATEWAY_SCRIPT).toContain("attachedClients");
    expect(TERMINAL_GATEWAY_SCRIPT).toContain("ptyRunning");
    expect(TERMINAL_GATEWAY_SCRIPT).toContain("hasSnapshot");
  });

  test("uses structured input messages and explicit session authorization", () => {
    expect(TERMINAL_GATEWAY_SCRIPT).toContain('parsed.type === "input"');
    expect(TERMINAL_GATEWAY_SCRIPT).toContain('parsed.type === "resize"');
    expect(TERMINAL_GATEWAY_SCRIPT).toContain(
      "sessionId === expectedSessionId",
    );
  });

  test("supports persistent snapshots and multi-attach replay", () => {
    expect(TERMINAL_GATEWAY_SCRIPT).toContain("screenSnapshot");
    expect(TERMINAL_GATEWAY_SCRIPT).toContain('type: "snapshot"');
    expect(TERMINAL_GATEWAY_SCRIPT).toContain("broadcastSnapshot(ws)");
    expect(TERMINAL_GATEWAY_SCRIPT).toContain("clients.add(ws)");
  });
});
