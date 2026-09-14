import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Pi 0.82.1 drops applied Responses cache options. Remove when Pi exposes them upstream.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = path.join(root, "node_modules/@earendil-works/pi-ai");
const manifest = JSON.parse(await readFile(path.join(sdkRoot, "package.json"), "utf8"));
if (manifest.version !== "0.82.1") {
	throw new Error("Review the Pi cache metadata patch before changing pi-ai from 0.82.1.");
}
const target = path.join(sdkRoot, "dist/api/openai-responses-shared.js");
const source = await readFile(target, "utf8");
const anchor =
	"    const finalizeResponse = (response) => {\n        sawTerminalResponseEvent = true;";
const marker = "        // Rhyza: preserve applied cache options from the terminal response.";
const addition = `${anchor}
${marker}
        if (response?.prompt_cache_options) {
            output.rhyzaPromptCache = {
                ttl: response.prompt_cache_options.ttl,
                mode: response.prompt_cache_options.mode,
                createdAt: response.created_at,
            };
        }`;
if (source.includes(marker)) {
	if (!source.includes(addition))
		throw new Error("The installed Pi cache metadata patch has changed.");
} else {
	if (source.split(anchor).length !== 2)
		throw new Error("Pi response parser no longer matches the cache metadata patch.");
	await writeFile(target, source.replace(anchor, addition), "utf8");
	console.log("Applied Pi response cache metadata patch.");
}
