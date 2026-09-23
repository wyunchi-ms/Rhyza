import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const json = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
const project = await json("src/data/storyboard.json");
const media = await json("src/data/media.json");
const captions = await json("src/data/captions.json");
const frames = project.chapters.reduce((sum, chapter) => sum + chapter.seconds * project.fps, 0);
const missing = [];
const seen = new Set();

async function elements(file, tag) {
	const text = await readFile(path.join(root, file), "utf8");
	const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const nodes = [];
	const visit = (node) => {
		if (
			(ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
			node.tagName.getText(ast) === tag
		) {
			const attrs = {};
			for (const attr of node.attributes.properties) {
				if (!ts.isJsxAttribute(attr) || !attr.initializer) continue;
				const value = ts.isJsxExpression(attr.initializer)
					? attr.initializer.expression
					: attr.initializer;
				if (value && ts.isNumericLiteral(value)) attrs[attr.name.getText(ast)] = Number(value.text);
				if (value && ts.isStringLiteral(value)) attrs[attr.name.getText(ast)] = value.text;
			}
			nodes.push(attrs);
		}
		ts.forEachChild(node, visit);
	};
	visit(ast);
	return nodes;
}

const sceneNames = {
	sources: "Sources",
	branching: "Branching",
	views: "Views",
	filtering: "Filtering",
	reading: "Reading",
	knowledge: "Knowledge",
	reuse: "Reuse",
	changes: "Changes",
	settings: "Settings",
};
for (const chapter of project.chapters) {
	assert(
		Number.isInteger(chapter.seconds) && chapter.seconds > 0,
		`${chapter.id}: invalid duration`,
	);
	if (chapter.kind !== "recording") continue;
	assert.equal(
		chapter.shots.reduce((sum, shot) => sum + shot.seconds, 0),
		chapter.seconds,
		`${chapter.id}: shot lengths`,
	);
	const sceneFile = `src/scenes/${sceneNames[chapter.id]}.tsx`;
	const allSequences = await elements(sceneFile, "Sequence");
	const sequences = allSequences.filter((sequence) => /^\d{2}-/.test(sequence.name ?? ""));
	for (const sequence of allSequences) {
		assert(sequence.from >= 0 && sequence.durationInFrames > 0, `${chapter.id}: invalid sequence`);
		assert(
			sequence.from + sequence.durationInFrames <= chapter.seconds * project.fps,
			`${chapter.id}: sequence exceeds chapter`,
		);
	}
	const shots = await elements(sceneFile, "Shot");
	assert.equal(sequences.length, chapter.shots.length, `${chapter.id}: Sequence count`);
	assert.deepEqual(
		shots.map((shot) => shot.id),
		chapter.shots.map((shot) => shot.id),
		`${chapter.id}: shot order`,
	);
	let from = 0;
	for (const [index, shot] of chapter.shots.entries()) {
		assert(!seen.has(shot.id), `Duplicate shot: ${shot.id}`);
		seen.add(shot.id);
		assert.equal(sequences[index].from, from, `${shot.id}: start frame`);
		assert.equal(
			sequences[index].durationInFrames,
			shot.seconds * project.fps,
			`${shot.id}: duration`,
		);
		from += shot.seconds * project.fps;
		const clip = media[shot.id];
		assert(clip, `Missing media mapping: ${shot.id}`);
		assert(Number.isInteger(clip.trimBefore) && clip.trimBefore >= 0, `${shot.id}: trimBefore`);
		assert(Number.isFinite(clip.playbackRate) && clip.playbackRate > 0, `${shot.id}: playbackRate`);
		assert(
			/^recordings\/[\w.-]+\.(mp4|webm|mov)$/i.test(clip.file),
			`${shot.id}: use a recording in public/recordings`,
		);
		try {
			assert(
				(await stat(path.join(root, "public", clip.file))).size > 0,
				`${shot.id}: empty recording`,
			);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			missing.push(clip.file);
		}
		assert(
			(await stat(path.join(root, "public/reference", `${shot.fallback}.png`))).size > 0,
			`${shot.id}: missing reference`,
		);
	}
}
assert.deepEqual(
	Object.keys(media).sort(),
	[...seen].sort(),
	"Unexpected or missing media entries",
);
const timeline = await elements("src/Walkthrough.tsx", "TransitionSeries.Sequence");
assert.deepEqual(
	timeline.map((sequence) => sequence.durationInFrames),
	project.chapters.map((chapter) => chapter.seconds * project.fps),
	"Main timeline differs from storyboard",
);
const compositions = await elements("src/Root.tsx", "Composition");
assert.equal(compositions.length, project.chapters.length + 2, "Composition count");
for (const [index, composition] of compositions.entries()) {
	assert.equal(composition.width, project.width, `${composition.id}: width`);
	assert.equal(composition.height, project.height, `${composition.id}: height`);
	assert.equal(composition.fps, project.fps, `${composition.id}: fps`);
	assert.equal(
		composition.durationInFrames,
		index < 2 ? frames : project.chapters[index - 2].seconds * project.fps,
		`${composition.id}: duration`,
	);
}
let end = 0;
assert.deepEqual(
	captions.map((caption) => caption.text),
	project.chapters.flatMap((chapter) =>
		chapter.kind === "recording"
			? chapter.shots.flatMap((shot) => shot.narration)
			: chapter.narration,
	),
	"Narration and subtitles differ; update both before exporting",
);
for (const caption of captions) {
	assert(caption.text.trim().length > 0, "Empty caption");
	assert(caption.startMs >= end && caption.endMs > caption.startMs, "Captions overlap or reverse");
	assert(caption.endMs <= (frames / project.fps) * 1000, "Caption exceeds composition");
	assert(
		caption.timestampMs === null && caption.confidence === null,
		"Scripted or synthesized cues must not claim transcription confidence",
	);
	end = caption.endMs;
}
console.log(
	`OK: ${compositions.length} compositions, ${seen.size} shots, ${captions.length} captions, ${frames} frames (${frames / project.fps}s).`,
);
console.log(
	`Media: ${seen.size - missing.length}/${seen.size} recordings present. Reference screenshots are storyboard placeholders.`,
);
if (process.argv.includes("--require-media")) {
	assert.equal(missing.length, 0, `Recordings still needed:\n${missing.join("\n")}`);
	assert(
		(await stat(path.join(root, "public/audio/narration.wav"))).size > 0,
		"Full timeline narration.wav is required",
	);
	console.log(
		"All expected files exist. Check footage duration, sync and readability in Studio before rendering.",
	);
}
