import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { McpService } from "../electron/main/mcp-service.js";
import { isRecord } from "../src/shared/value.js";

test(
	"MCP OAuth uses browser PKCE, persists and refreshes credentials, signs out and cancels",
	{ timeout: 60_000 },
	async (t) => {
		const root = await mkdtemp(path.join(tmpdir(), "rhyza-mcp-oauth-"));
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = root;
		let origin = "";
		let openCount = 0;
		let refreshCount = 0;
		let cancelFlow = false;
		const browserRequests: Promise<Response>[] = [];
		const server = createServer(async (request, response) => {
			const url = new URL(request.url ?? "/", origin);
			const json = (value: unknown) =>
				response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(value));
			if (url.pathname === "/.well-known/oauth-protected-resource") {
				json({
					resource: `${origin}/mcp`,
					authorization_servers: [origin],
					scopes_supported: ["read"],
				});
				return;
			}
			if (url.pathname === "/.well-known/oauth-authorization-server") {
				json({
					issuer: origin,
					authorization_endpoint: `${origin}/authorize`,
					token_endpoint: `${origin}/token`,
					registration_endpoint: `${origin}/register`,
					response_types_supported: ["code"],
					grant_types_supported: ["authorization_code", "refresh_token"],
					code_challenge_methods_supported: ["S256"],
					token_endpoint_auth_methods_supported: ["none"],
				});
				return;
			}
			let body = "";
			for await (const chunk of request) body += chunk;
			if (url.pathname === "/register") {
				json({ ...JSON.parse(body), client_id: "fixture-client" });
				return;
			}
			if (url.pathname === "/token") {
				const params = new URLSearchParams(body);
				if (params.get("grant_type") === "refresh_token") refreshCount++;
				else
					assert(
						params.get("code_verifier"),
						"Authorization code exchange must include a PKCE verifier.",
					);
				json({
					access_token: "oauth-fixture-access",
					token_type: "Bearer",
					refresh_token: "oauth-fixture-refresh",
					expires_in: 3600,
					scope: "read",
				});
				return;
			}
			if (url.pathname === "/mcp") {
				if (request.headers.authorization !== "Bearer oauth-fixture-access") {
					response
						.writeHead(401, {
							"WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="read"`,
						})
						.end();
					return;
				}
				if (request.method !== "POST") {
					response.writeHead(405).end();
					return;
				}
				const message = JSON.parse(body);
				if (message.id === undefined) {
					response.writeHead(202).end();
					return;
				}
				json({
					jsonrpc: "2.0",
					id: message.id,
					result:
						message.method === "initialize"
							? {
									protocolVersion: "2025-11-25",
									capabilities: { tools: {} },
									serverInfo: { name: "oauth-fixture", version: "1" },
								}
							: { tools: [] },
				});
				return;
			}
			response.writeHead(404).end();
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		assert(address && typeof address === "object");
		origin = `http://127.0.0.1:${address.port}`;
		const service = new McpService(
			root,
			path.join(root, "data"),
			() => {},
			(authorizationUrl) => {
				openCount++;
				const url = new URL(authorizationUrl);
				assert.equal(url.searchParams.get("code_challenge_method"), "S256");
				if (cancelFlow) return;
				const callback = new URL(url.searchParams.get("redirect_uri")!);
				callback.searchParams.set("state", url.searchParams.get("state")!);
				callback.searchParams.set("code", "fixture-code");
				callback.searchParams.set("iss", origin);
				browserRequests.push(fetch(callback));
			},
		);
		t.after(async () => {
			await service.dispose();
			await Promise.all(browserRequests);
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
			await rm(root, { recursive: true, force: true, maxRetries: 5 });
		});
		const target = { name: "oauth", scope: "user" as const };
		await service.save(root, {
			...target,
			config: { url: `${origin}/mcp`, exposure: "deferred", timeout: 2 },
			policy: { tools: {} },
		});
		await service.overview(root);
		const waitFor = async (predicate: () => boolean | Promise<boolean>) => {
			for (let index = 0; index < 200; index++) {
				if (await predicate()) return;
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			throw new Error("OAuth fixture state did not settle.");
		};
		await waitFor(async () => (await service.overview(root)).servers[0].state === "needs-auth");
		assert.equal((await service.overview(root)).servers[0].authenticated, false);
		await service.action(root, { ...target, action: "login" });
		assert.equal(openCount, 1);
		assert.equal((await service.overview(root)).servers[0].state, "connected");
		assert.equal((await service.overview(root)).servers[0].authenticated, true);
		const credentialsPath = path.join(root, "mcp-auth.json");
		const credentials: unknown = JSON.parse(await readFile(credentialsPath, "utf8"));
		const expire = (value: unknown) => {
			if (!isRecord(value)) return;
			if (value.tokensExpireAt !== undefined) value.tokensExpireAt = 0;
			for (const nested of Object.values(value)) expire(nested);
		};
		expire(credentials);
		await writeFile(credentialsPath, JSON.stringify(credentials));
		await service.action(root, { ...target, action: "reconnect" });
		assert(refreshCount > 0, "Reconnection refreshes expired OAuth credentials.");
		assert.equal((await service.overview(root)).servers[0].authenticated, true);
		assert(!JSON.stringify(await service.overview(root)).includes("oauth-fixture-access"));
		await service.action(root, { ...target, action: "logout" });
		assert.equal((await service.overview(root)).servers[0].state, "needs-auth");
		assert.equal((await service.overview(root)).servers[0].authenticated, false);
		const signedOutCredentials = await readFile(credentialsPath, "utf8");
		assert(!signedOutCredentials.includes("oauth-fixture-access"));
		assert(
			!signedOutCredentials.includes("oauth-fixture-refresh"),
			"Signing out removes persisted tokens, not just the displayed connection status.",
		);
		cancelFlow = true;
		const pending = service.action(root, { ...target, action: "login" });
		await waitFor(() => openCount === 2);
		await service.action(root, { ...target, action: "cancel-login" });
		await assert.rejects(pending, /cancelled/);
		assert.equal((await service.overview(root)).servers[0].state, "needs-auth");
	},
);
