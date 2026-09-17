import assert from "node:assert/strict";
import test from "node:test";
import { validatePiPluginRemoveRequest, validatePiPluginSource } from "../src/shared/ipc.ts";

test("accepts supported Pi package sources", () => {
	for (const source of [
		"npm:@scope/package@1.2.3",
		"git:github.com/user/repo@v1",
		"https://github.com/user/repo",
		"ssh://git@github.com/user/repo",
		"C:\\plugins\\my-package",
		"C:\\plugins with spaces\\my-package",
		"\\\\server\\share\\my-package",
		"/opt/pi/my-package",
	]) {
		assert.equal(validatePiPluginSource({ source }).source, source);
	}
});

test("rejects ambiguous or malformed Pi package sources", () => {
	for (const source of ["", "plain-package-name", "./relative-package", "npm:bad\nsource"]) {
		assert.throws(() => validatePiPluginSource({ source }));
	}
});

test("removal accepts configured identifiers, including Pi-normalized relative paths", () => {
	for (const source of [
		"..\\..\\personal-projects\\Rhyza\\extensions\\pi-archify",
		"../../extensions/pi-archify",
		"./extensions/pi-archify",
		"extensions/pi-archify",
		".",
		"npm:pi-mcp-adapter",
		"C:\\extensions\\pi-archify",
	]) {
		assert.equal(validatePiPluginRemoveRequest({ source }).source, source);
	}
});

test("removal still rejects malformed requests", () => {
	for (const value of [
		undefined,
		null,
		{},
		{ source: 12 },
		{ source: "" },
		{ source: " \t " },
		{ source: "bad\u0000path" },
		{ source: "bad\npath" },
		{ source: "x".repeat(2049) },
	]) {
		assert.throws(() => validatePiPluginRemoveRequest(value));
	}
});
