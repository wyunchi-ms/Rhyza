import assert from "node:assert/strict";
import test from "node:test";
import { validatePiPluginSource } from "../src/shared/ipc.ts";

test("accepts supported Pi package sources", () => {
	for (const source of [
		"npm:@scope/package@1.2.3",
		"git:github.com/user/repo@v1",
		"https://github.com/user/repo",
		"ssh://git@github.com/user/repo",
		"C:\\plugins\\my-package",
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
