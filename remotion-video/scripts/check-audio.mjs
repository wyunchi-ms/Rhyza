import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const json = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
const manifest = await json("public/audio/manifest.json");
const project = await json("src/data/storyboard.json");
const captions = await json("src/data/captions.json");
const binaries = path.join(root, "node_modules/@remotion/compositor-win32-x64-msvc");
const items = project.chapters.flatMap((chapter) =>
	chapter.kind === "recording" ? chapter.shots : [chapter],
);

function inspect(file) {
	return JSON.parse(
		execFileSync(
			path.join(binaries, "ffprobe.exe"),
			["-v", "error", "-show_format", "-show_streams", "-of", "json", file],
			{
				windowsHide: true,
				encoding: "utf8",
			},
		),
	);
}

assert.equal(manifest.clips.length, items.length, "Missing narration clips");
assert.equal(manifest.voice, "zh-CN-XiaoxiaoNeural");
assert.equal(
	manifest.totalSeconds,
	project.chapters.reduce((sum, chapter) => sum + chapter.seconds, 0),
);
const mp3Names = (await readdir(path.join(root, "public/audio/clips"))).filter((name) =>
	name.endsWith(".mp3"),
);
assert.deepEqual(mp3Names.sort(), manifest.clips.map((clip) => path.basename(clip.file)).sort());
const expectedCaptions = [];
let positionMs = 0;
let highestPeak = 0;

for (const [index, clip] of manifest.clips.entries()) {
	const file = path.join(root, "public", clip.file);
	const info = inspect(file);
	const stream = info.streams.find((entry) => entry.codec_type === "audio");
	assert(stream, `${clip.id}: no audio stream`);
	assert.equal(stream.codec_name, "mp3");
	assert.equal(Number(stream.sample_rate), 48000);
	assert.equal(stream.channels, 1);
	assert.equal(Number(stream.bit_rate), 192000);
	assert.equal(clip.startMs, positionMs);
	assert.equal(clip.slotSeconds, items[index].seconds);
	assert.deepEqual(
		clip.captions.map((cue) => cue.text),
		items[index].narration,
	);
	assert(clip.spokenSeconds + 0.35 < clip.slotSeconds, `${clip.id}: narration overlaps next shot`);
	assert(Math.abs(Number(info.format.duration) - clip.mp3Seconds) < 0.005);
	assert(clip.tempo >= 1 && clip.tempo <= 1.25, `${clip.id}: excessive time stretching`);
	const decoded = execFileSync(
		path.join(binaries, "ffmpeg.exe"),
		["-v", "error", "-i", file, "-f", "wav", "-acodec", "pcm_s16le", "pipe:1"],
		{
			windowsHide: true,
			maxBuffer: 16 * 1024 * 1024,
		},
	);
	assert.equal(decoded.toString("ascii", 8, 12), "WAVE");
	let pcm;
	for (let offset = 12; offset + 8 <= decoded.length;) {
		const chunkName = decoded.toString("ascii", offset, offset + 4);
		const size = decoded.readUInt32LE(offset + 4);
		const start = offset + 8;
		if (chunkName === "data") {
			pcm = decoded.subarray(start, Math.min(start + size, decoded.length));
			break;
		}
		offset = start + size + (size % 2);
	}
	assert(pcm?.length > 0, `${clip.id}: no decoded samples`);
	let power = 0;
	let peak = 0;
	for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
		const value = pcm.readInt16LE(offset) / 32768;
		power += value * value;
		peak = Math.max(peak, Math.abs(value));
	}
	const rms = Math.sqrt(power / (pcm.length / 2));
	assert(rms > 0.005, `${clip.id}: silent or unexpectedly quiet audio`);
	assert(peak < 0.999, `${clip.id}: clipping detected`);
	highestPeak = Math.max(highestPeak, peak);
	for (const cue of clip.captions) {
		assert(cue.startMs >= 0 && cue.endMs <= clip.spokenSeconds * 1000 + 1);
		expectedCaptions.push({
			...cue,
			startMs: clip.narrationStartsAtMs + cue.startMs,
			endMs: clip.narrationStartsAtMs + cue.endMs,
		});
	}
	positionMs += clip.slotSeconds * 1000;
}

assert.deepEqual(captions, expectedCaptions, "Subtitles do not match the audio placement");
for (const extension of ["wav", "mp3"]) {
	const full = inspect(path.join(root, `public/audio/narration.${extension}`));
	assert(
		Math.abs(Number(full.format.duration) - manifest.totalSeconds) <
			(extension === "wav" ? 0.002 : 0.05),
	);
}
console.log(
	`OK: ${manifest.clips.length} MP3 clips decode, contain audio, fit their shots and match ${captions.length} captions.`,
);
console.log(
	`Full narration: ${manifest.totalSeconds}s. Highest decoded sample peak: ${(20 * Math.log10(highestPeak)).toFixed(2)} dBFS.`,
);
