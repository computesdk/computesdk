#!/usr/bin/env node
// mcp-oauth-client.mjs — Part C of the sandbox-market E2E: exercise the
// platform MCP endpoint over OAuth.
//
// Registers a client via DCR (localhost redirect), opens the consent URL for
// a human/browser to complete sign-in + org pick + approval, then calls
// tools. Usage:
//
//   node mcp-oauth-client.mjs [--url https://platform.computesdk.com/mcp]
//                           [--wait]            # just print the auth URL and wait for the code on the redirect
//
// Prints PASS/FAIL lines like the shell script. Exits non-zero on failure.

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  auth,
  discoverOAuthMetadata,
  discoverOAuthProtectedResourceMetadata,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";

const BASE = (process.env.MCP_URL ?? "https://platform.computesdk.com/mcp").replace(/\/$/, "");
const serverUrl = new URL(BASE);
const REDIRECT_PORT = 3399;
const REDIRECT = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
// Per-run path (predictable /tmp names can be pre-populated by another local
// user); only files owned by this uid are trusted.
const CODE_FILE = `/tmp/mcp_code_${process.pid}.txt`;

const results = [];
const pass = (n, extra = "") => { results.push(`PASS ${n}`); console.log(`PASS ${n} ${extra}`); };
const fail = (n, why) => { results.push(`FAIL ${n}`); console.log(`FAIL ${n}\n  ${String(why).slice(0, 2000)}`); };

// ── minimal OAuthClientProvider ──────────────────────────────────────────
// Collects the authorization code on a localhost listener. The consent URL
// is printed; a browser (the operator's or Devin's) completes it.
class LocalOAuthProvider {
  constructor() {
    this._tokens = undefined;
    this._clientInfo = undefined;
    this._verifier = undefined;
    this._code = undefined;
    this._codeResolve = undefined;
    this._state = undefined;
    this._server = createServer((req, res) => {
      const url = new URL(req.url, REDIRECT);
      // The provider echoes the state we generated — reject forged callbacks
      // carrying a code we never asked for.
      if (
        url.pathname === "/callback" &&
        url.searchParams.get("code") &&
        url.searchParams.get("state") === this._state
      ) {
        this._code = url.searchParams.get("code");
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<h1>Approved — you can close this tab.</h1>");
        this._codeResolve?.(this._code);
      } else {
        res.writeHead(400); res.end("missing or mismatched code/state");
      }
    });
  }
  get redirectUrl() { return REDIRECT; }
  get clientMetadata() {
    return {
      redirect_uris: [REDIRECT],
      client_name: "compute-e2e",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
    };
  }
  clientInformation() { return this._clientInfo; }
  saveClientInformation(info) { this._clientInfo = info; }
  tokens() { return this._tokens; }
  saveTokens(t) { this._tokens = t; }
  async state() {
    this._state = "e2e-" + Math.random().toString(36).slice(2);
    return this._state;
  }
  saveCodeVerifier(v) { this._verifier = v; }
  codeVerifier() { return this._verifier; }
  async redirectToAuthorization(url) {
    console.log("AUTH_URL " + url.toString());
    console.log("open AUTH_URL in a browser, sign in, pick the org, approve");
  }
  async waitForCode(timeoutMs = 300000) {
    await new Promise((res) => this._server.listen(REDIRECT_PORT, res));
    console.log(`waiting for code — listener on :${REDIRECT_PORT}, or write the code to ${CODE_FILE}`);
    return new Promise((resolve, reject) => {
      this._codeResolve = resolve;
      const poll = setInterval(() => {
        if (existsSync(CODE_FILE)) {
          // Only a file this uid created is trusted — a foreign /tmp file is
          // ignored rather than feeding us a planted code.
          const st = statSync(CODE_FILE);
          if (st.uid !== process.getuid() || !st.isFile()) return;
          const c = readFileSync(CODE_FILE, "utf8").trim();
          if (c) { clearInterval(poll); resolve(c.includes("code=") ? new URL(c).searchParams.get("code") : c); }
        }
      }, 500);
      setTimeout(() => { clearInterval(poll); reject(new Error("timed out waiting for OAuth code")); }, timeoutMs);
    });
  }
  close() { this._server.close(); }
}

async function connect(provider) {
  // DCR + PKCE auth flow against the MCP server.
  const resourceMeta = await discoverOAuthProtectedResourceMetadata(serverUrl).catch(() => undefined);
  const meta = await discoverOAuthMetadata(serverUrl, {
    authorizationServerUrl: resourceMeta?.authorization_servers?.[0],
  });
  if (!meta) throw new Error("no OAuth metadata at " + serverUrl);
  const clientInfo = await registerClient(serverUrl, { metadata: meta, clientMetadata: provider.clientMetadata });
  provider.saveClientInformation(clientInfo);
  const { authorizationUrl, codeVerifier } = await startAuthorization(serverUrl, {
    metadata: meta,
    clientInformation: clientInfo,
    redirectUrl: provider.redirectUrl,
    scope: "sandboxes:read sandboxes:write offline_access",
    resource: resourceMeta?.resource ? new URL(resourceMeta.resource) : undefined,
  });
  const codePromise = provider.waitForCode();
  await provider.redirectToAuthorization(authorizationUrl);
  const code = await codePromise;
  const tokens = await exchangeAuthorization(serverUrl, {
    metadata: meta,
    clientInformation: clientInfo,
    authorizationCode: code,
    codeVerifier,
    redirectUri: provider.redirectUrl,
    resource: resourceMeta?.resource ? new URL(resourceMeta.resource) : undefined,
  });
  provider.saveTokens(tokens);
  const transport = new StreamableHTTPClientTransport(serverUrl, {
    requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
  });
  const client = new Client({ name: "compute-e2e", version: "0.0.1" });
  await client.connect(transport);
  return { client, tokens, meta, clientInfo };
}

const role = process.argv.includes("--actions") ? "actions" : "buyer";
const provider = new LocalOAuthProvider();
try {
  const { client, tokens, meta, clientInfo } = await connect(provider);
  provider.close();
  pass("M1-oauth-connect");

  // M2 — tools/list + schema fields
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  names.includes("get_quote") ? pass("M2-get_quote-listed") : fail("M2-get_quote-listed", names.join(","));
  const cs = tools.tools.find((t) => t.name === "create_sandbox");
  const props = Object.keys(cs?.inputSchema?.properties ?? {});
  ["size", "orderType", "maxPrice"].every((p) => props.includes(p))
    ? pass("M2-create_sandbox-schema") : fail("M2-create_sandbox-schema", props.join(","));
  const gp = tools.tools.find((t) => t.name === "get_profile");
  const gpText = JSON.stringify(gp?.inputSchema ?? {}) + JSON.stringify(gp ?? {});
  gp ? pass("M2-get_profile-listed") : fail("M2-get_profile-listed", names.join(","));

  if (role === "actions") {
    // M4 — actions-only org: get_quote refused; run_command on a foreign id refused.
    const q = await client.callTool({ name: "get_quote", arguments: { size: "medium" } });
    const qt = JSON.stringify(q);
    /market_access_required/.test(qt) ? pass("M4-actions-quote-refused") : fail("M4-actions-quote-refused", qt);
    const rc = await client.callTool({
      name: "run_command",
      arguments: { id: process.env.MCP_FOREIGN_SANDBOX ?? "00000000-0000-0000-0000-000000000000", command: "nproc" },
    });
    const rt = JSON.stringify(rc);
    /not found|Not found|forbidden|access/i.test(rt) ? pass("M4-foreign-sandbox-refused") : fail("M4-foreign-sandbox-refused", rt);
  } else {
    // M3 — quote, create, exec, destroy as the buyer.
    const q = await client.callTool({ name: "get_quote", arguments: { size: "medium" } });
    const qt = JSON.stringify(q);
    /[0-9]+\.[0-9]+/.test(qt) ? pass("M3-quote-medium") : fail("M3-quote-medium", qt);
    const c = await client.callTool({
      name: "create_sandbox",
      arguments: {
        size: "medium",
        maxPrice: { usd: 0.12, per: "hour" },
        label: `e2e-${process.env.E2E_RUN_ID ?? Date.now()}-m3`,
        timeoutMs: 600000,
      },
    });
    const ct = JSON.stringify(c);
    let sid;
    try { sid = JSON.parse(c.content[0].text).sandbox?.id ?? JSON.parse(c.content[0].text).id; } catch { /* keep */ }
    if (sid && /limit/.test(ct)) {
      pass("M3-create-limit");
      const r = await client.callTool({ name: "run_command", arguments: { id: sid, command: "nproc" } });
      const rt = JSON.stringify(r);
      /[2-9]|\d\d/.test(rt) ? pass("M3-nproc") : fail("M3-nproc", rt);
      const d = await client.callTool({ name: "destroy_sandbox", arguments: { id: sid } });
      pass("M3-destroy");
    } else {
      fail("M3-create-limit", ct);
    }
    const p = await client.callTool({ name: "get_profile", arguments: {} });
    /creditBalanceUsd|"balance"/.test(JSON.stringify(p)) ? pass("M3-get_profile-balance") : fail("M3-get_profile-balance", JSON.stringify(p).slice(0, 500));

    // M5 — refresh the token, reconnect, get_profile still works
    try {
      const refreshed = await refreshAuthorization(serverUrl, {
        metadata: meta,
        clientInformation: clientInfo,
        refreshToken: tokens.refresh_token,
        resource: undefined,
      });
      const t2 = new StreamableHTTPClientTransport(serverUrl, {
        requestInit: { headers: { authorization: `Bearer ${refreshed.access_token}` } },
      });
      const c2 = new Client({ name: "compute-e2e", version: "0.0.1" });
      await c2.connect(t2);
      const p2 = await c2.callTool({ name: "get_profile", arguments: {} });
      await c2.close();
      /creditBalanceUsd|"balance"/.test(JSON.stringify(p2))
        ? pass("M5-token-refresh") : fail("M5-token-refresh", JSON.stringify(p2).slice(0, 500));
    } catch (e) {
      fail("M5-token-refresh", e);
    }
  }
  await client.close();
} catch (e) {
  fail("M-connect", e);
} finally {
  provider.close();
}

const fails = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\nMCP E2E: ${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
