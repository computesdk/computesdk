#!/usr/bin/env node
// platform-sdk.mjs — end-to-end run of the @computesdk/platform provider
// against the live platform's compute market (default
// https://platform.computesdk.com). Spends real (granted) market credits.
// NOT for CI — a manual check the same way market-sandboxes.sh is.
//
// Required env:
//   E2E_BUYER_KEY     platform API key for a buyer org (sandbox lane, credits).
//                     No providerOrder is set, so the org defaults to the
//                     market — this exercises the market fill path.
//
// Optional env:
//   BASE_URL          default https://platform.computesdk.com
//   E2E_RUN_ID        run id used in the sandbox label
//
// Exercises: create (with the SDK's minted idempotencyKey), runCommand,
// runCommand with streaming callbacks (the commands route's SSE), getInfo,
// filesystem write/read, getById, and destroy.
//
//   node e2e/platform-sdk.mjs

import { platform } from "@computesdk/platform";

const BASE_URL = process.env.BASE_URL ?? "https://platform.computesdk.com";
const RUN_ID = process.env.E2E_RUN_ID ?? String(Date.now());
const KEY = process.env.E2E_BUYER_KEY;

if (!KEY) {
  console.error("set E2E_BUYER_KEY to a buyer-org platform API key");
  process.exit(1);
}

const results = [];
const pass = (name) => { results.push(`PASS ${name}`); console.log(`PASS ${name}`); };
const fail = (name, detail) => {
  results.push(`FAIL ${name}`);
  console.log(`FAIL ${name}`);
  console.log(`  ${String(detail).slice(0, 500)}`);
};

const label = `e2e-sdk-${RUN_ID}`;
let sandbox;

try {
  const provider = platform({ apiKey: KEY, baseUrl: BASE_URL });

  // ── create (market fill; minted sdk-create: idempotency key) ─────────────
  try {
    sandbox = await provider.sandbox.create({
      size: "small",
      label,
      timeout: 600_000,
      envs: { E2E_MARK: RUN_ID },
    });
    pass("S1-create");
  } catch (e) {
    fail("S1-create", e instanceof Error ? e.message : e);
    throw e;
  }

  try {
    // ── runCommand ─────────────────────────────────────────────────────────
    try {
      const r = await sandbox.runCommand("echo market-ok && echo $E2E_MARK");
      r.stdout.includes("market-ok") && r.stdout.includes(RUN_ID)
        ? pass("S2-runCommand")
        : fail("S2-runCommand", JSON.stringify(r));
    } catch (e) {
      fail("S2-runCommand", e);
    }

    // ── streamCommand via SSE callbacks ────────────────────────────────────
    try {
      const chunks = [];
      const r = await sandbox.runCommand("echo streamed-ok", {
        onStdout: (c) => chunks.push(c),
      });
      r.stdout.includes("streamed-ok") && chunks.join("").includes("streamed-ok")
        ? pass("S3-streamCommand")
        : fail("S3-streamCommand", JSON.stringify({ r, chunks }));
    } catch (e) {
      fail("S3-streamCommand", e);
    }

    // ── getInfo ────────────────────────────────────────────────────────────
    try {
      const info = await sandbox.getInfo();
      info.provider === "platform" && info.status === "running" && info.metadata?.platformStatus === "running"
        ? pass("S4-getInfo")
        : fail("S4-getInfo", JSON.stringify(info));
    } catch (e) {
      fail("S4-getInfo", e);
    }

    // ── filesystem round-trip ──────────────────────────────────────────────
    try {
      await sandbox.filesystem.writeFile("/tmp/e2e-sdk.txt", `run ${RUN_ID}`);
      const content = await sandbox.filesystem.readFile("/tmp/e2e-sdk.txt");
      content === `run ${RUN_ID}` ? pass("S5-filesystem") : fail("S5-filesystem", content);
    } catch (e) {
      fail("S5-filesystem", e);
    }

    // ── getById ────────────────────────────────────────────────────────────
    try {
      const fetched = await provider.sandbox.getById(sandbox.sandboxId);
      fetched?.sandboxId === sandbox.sandboxId
        ? pass("S6-getById")
        : fail("S6-getById", JSON.stringify(fetched));
    } catch (e) {
      fail("S6-getById", e);
    }
  } finally {
    // ── destroy (always, even on failure) ──────────────────────────────────
    if (sandbox) {
      try {
        await sandbox.destroy();
        pass("S7-destroy");
      } catch (e) {
        fail("S7-destroy", e);
      }
    }
  }
} catch {
  // S1 already recorded the failure
}

const fails = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\nplatform SDK E2E: ${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
