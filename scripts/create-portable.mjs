import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portableRoot = join(root, "dist-portable", "Rhyza");
const resources = join(portableRoot, "resources");
const executable = join(root, "src-tauri", "target", "release", "rhyza.exe");
const sidecar = join(root, "dist-sidecar", "sidecar");
const shared = join(root, "dist-sidecar", "src");
const modules = join(root, "node_modules");
const nodeRuntime = process.env.RHYZA_PORTABLE_NODE_BINARY || process.execPath;

for (const path of [executable, sidecar, shared, modules, nodeRuntime]) {
	if (!existsSync(path)) throw new Error(`Portable build input is missing: ${path}`);
}
if (nodeRuntime.toLowerCase().includes("\\volta\\")) {
	throw new Error("RHYZA_PORTABLE_NODE_BINARY must point to a real Node executable, not the Volta shim.");
}

rmSync(portableRoot, { recursive: true, force: true });
mkdirSync(resources, { recursive: true });
cpSync(executable, join(portableRoot, "Rhyza.exe"));
cpSync(sidecar, join(resources, "sidecar"), { recursive: true });
cpSync(shared, join(resources, "src"), { recursive: true });
cpSync(modules, join(resources, "node_modules"), {
	recursive: true,
	filter: (source) => !source.includes("\\.cache\\") && !source.includes("\\.bin\\"),
});
cpSync(nodeRuntime, join(resources, "node.exe"));
writeFileSync(
	join(portableRoot, "README.txt"),
	"Rhyza portable edition\r\n\r\nOpen Rhyza.exe directly. Keep the resources folder beside it. Windows 10/11 needs Microsoft Edge WebView2 Runtime, which is normally already installed.\r\n",
);
console.log(`Portable app created at ${portableRoot}`);
