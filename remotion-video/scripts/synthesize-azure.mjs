import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const project = JSON.parse(await readFile(path.join(root, "src/data/storyboard.json"), "utf8"));
const voice = "zh-CN-XiaoxiaoNeural";
const style = "chat";
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex < 0 ? null : process.argv[onlyIndex + 1];
const cacheDir = path.join(root, ".cache/azure-tts");
const audioDir = path.join(root, "public/audio");
const clipDir = path.join(audioDir, "clips");
const binaries = path.join(root, "node_modules/@remotion/compositor-win32-x64-msvc");
const ffmpeg = path.join(binaries, "ffmpeg.exe");
const ffprobe = path.join(binaries, "ffprobe.exe");
const sampleRate = 48000;
const leadMs = 350;
const maxTempo = 1.25;

for (const dir of [cacheDir, clipDir]) {
	await mkdir(dir, { recursive: true });
}

function runFfmpeg(args) {
	execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function duration(file) {
	return Number(
		execFileSync(
			ffprobe,
			["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
			{
				windowsHide: true,
				encoding: "utf8",
			},
		).trim(),
	);
}

function escapeXml(text) {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function spokenMarkup(text) {
	// Read UI terminology as written. Make symbols and the README filename pronounceable.
	return escapeXml(text)
		.replaceAll("@", '<sub alias="艾特">@</sub>')
		.replaceAll("README", '<sub alias="read me">README</sub>');
}

function ssmlFor(text) {
	return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="zh-CN"><voice name="${voice}"><mstts:express-as style="${style}"><prosody rate="0%"><s>${spokenMarkup(text)}</s></prosody></mstts:express-as></voice></speak>`;
}

async function concatenate(files, target, listName) {
	const list = path.join(cacheDir, listName);
	await writeFile(
		list,
		files
			.map((file) => `file '${file.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`)
			.join("\n") + "\n",
	);
	runFfmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c:a", "pcm_s16le", target]);
}

const items = [];
let position = 0;
for (const chapter of project.chapters) {
	for (const item of chapter.kind === "recording" ? chapter.shots : [chapter]) {
		const id = item.id === "intro" ? "00-intro" : item.id === "outro" ? "27-outro" : item.id;
		items.push({ ...item, id, chapterId: chapter.id, startMs: position * 1000 });
		position += item.seconds;
	}
}
assert(!only || items.some((item) => item.id === only), "Unknown --only clip ID");
const selected = items
	.filter((entry) => !only || entry.id === only)
	.map((item) => ({
		...item,
		requests: item.narration.map((text, index) => {
			const ssml = ssmlFor(text);
			const hash = createHash("sha256").update(`${sampleRate}:${ssml}`).digest("hex").slice(0, 16);
			return {
				id: `${item.id}-${index + 1}`,
				ssml,
				hash,
				file: path.join(cacheDir, `sentence-${hash}.wav`),
			};
		}),
	}));
if (process.argv.includes("--prepare")) {
	await writeFile(
		path.join(cacheDir, "requests.json"),
		JSON.stringify(
			selected.flatMap((item) => item.requests),
			null,
			2,
		) + "\n",
	);
	console.log(
		`Prepared ${selected.length} clips, ${selected.reduce((sum, item) => sum + item.requests.length, 0)} sentence requests.`,
	);
	process.exit(0);
}
const records = [];
const captions = [];
const alignedFiles = [];

for (const item of selected) {
	const hash = createHash("sha256")
		.update(item.requests.map((request) => request.hash).join(":"))
		.digest("hex")
		.slice(0, 16);
	const source = path.join(cacheDir, `${item.id}-${hash}.wav`);
	const sentenceOffsets = {};
	let offsetMs = 0;
	for (const [index, request] of item.requests.entries()) {
		assert(
			(await stat(request.file)).size > 44,
			`${request.id}: missing audio; run the PowerShell wrapper`,
		);
		sentenceOffsets[`start-${index}`] = offsetMs;
		offsetMs += duration(request.file) * 1000;
		sentenceOffsets[`end-${index}`] = offsetMs;
	}
	await concatenate(
		item.requests.map((request) => request.file),
		source,
		`${item.id}-sentences.txt`,
	);
	const sourceSeconds = duration(source);
	const availableSeconds = item.seconds - leadMs / 1000 - 0.3;
	const tempo = Math.max(1, sourceSeconds / availableSeconds);
	assert(
		tempo <= maxTempo,
		`${item.id}: ${sourceSeconds.toFixed(2)}s narration will not fit ${item.seconds}s naturally; extend the shot or revise narration.`,
	);
	const normalized = path.join(cacheDir, `${item.id}-normalized.wav`);
	runFfmpeg([
		"-i",
		source,
		"-af",
		`atempo=${tempo.toFixed(8)},loudnorm=I=-16:TP=-1.5:LRA=9`,
		"-ar",
		String(sampleRate),
		"-ac",
		"1",
		"-c:a",
		"pcm_s16le",
		normalized,
	]);
	const spokenSeconds = duration(normalized);
	assert(spokenSeconds + leadMs / 1000 < item.seconds, `${item.id}: audio exceeds shot`);
	const clipFile = path.join(clipDir, `${item.id}.mp3`);
	runFfmpeg(["-i", normalized, "-c:a", "libmp3lame", "-b:a", "192k", clipFile]);
	const alignedFile = path.join(cacheDir, `${item.id}-aligned.wav`);
	runFfmpeg([
		"-i",
		normalized,
		"-af",
		`adelay=${leadMs}:all=1,apad`,
		"-t",
		String(item.seconds),
		"-ar",
		String(sampleRate),
		"-ac",
		"1",
		"-c:a",
		"pcm_s16le",
		alignedFile,
	]);
	assert(
		Math.abs(duration(alignedFile) - item.seconds) < 0.002,
		`${item.id}: aligned duration mismatch`,
	);
	alignedFiles.push(alignedFile);
	const localCaptions = item.narration.map((text, index) => {
		const start = sentenceOffsets[`start-${index}`];
		const end = sentenceOffsets[`end-${index}`];
		assert(
			Number.isFinite(start) && Number.isFinite(end) && end > start,
			`${item.id}: missing sentence timing ${index}`,
		);
		return {
			text,
			startMs: Math.round(start / tempo),
			endMs: Math.round(Math.min(end / tempo, spokenSeconds * 1000)),
			timestampMs: null,
			confidence: null,
		};
	});
	for (const cue of localCaptions) {
		captions.push({
			...cue,
			startMs: item.startMs + leadMs + cue.startMs,
			endMs: item.startMs + leadMs + cue.endMs,
		});
	}
	await writeFile(
		path.join(clipDir, `${item.id}.captions.json`),
		JSON.stringify(localCaptions, null, 2) + "\n",
	);
	const record = {
		id: item.id,
		title: item.title,
		chapterId: item.chapterId,
		file: `audio/clips/${item.id}.mp3`,
		startMs: item.startMs,
		slotSeconds: item.seconds,
		narrationStartsAtMs: item.startMs + leadMs,
		sourceSeconds,
		spokenSeconds,
		mp3Seconds: duration(clipFile),
		tempo,
		hash,
		captions: localCaptions,
	};
	records.push(record);
	console.log(
		`Ready: ${item.id}, voice ${spokenSeconds.toFixed(2)}s / slot ${item.seconds}s, tempo ${tempo.toFixed(3)}x`,
	);
}

if (!only) {
	const concatList = path.join(cacheDir, "concat.txt");
	await writeFile(
		concatList,
		alignedFiles
			.map((file) => `file '${file.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`)
			.join("\n") + "\n",
	);
	const fullWav = path.join(audioDir, "narration.wav");
	const fullMp3 = path.join(audioDir, "narration.mp3");
	runFfmpeg(["-f", "concat", "-safe", "0", "-i", concatList, "-c:a", "pcm_s16le", fullWav]);
	assert(Math.abs(duration(fullWav) - position) < 0.002, "Full narration timeline mismatch");
	runFfmpeg(["-i", fullWav, "-c:a", "libmp3lame", "-b:a", "192k", fullMp3]);
	const manifest = {
		provider: "Azure AI Speech",
		voice,
		style,
		language: "zh-CN",
		sampleRate,
		mp3Bitrate: 192000,
		totalSeconds: position,
		alignment:
			"Measured durations of independently synthesized Azure sentences, adjusted for tempo and shot placement",
		clips: records,
	};
	await writeFile(path.join(audioDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
	await writeFile(
		path.join(root, "src/data/captions.json"),
		JSON.stringify(captions, null, "\t") + "\n",
	);
	await writeFile(
		path.join(root, "src/data/voiceover.json"),
		JSON.stringify(
			{
				generated: true,
				voice,
				style,
				clips: records.length,
				alignment: "measured-sentence-audio",
			},
			null,
			"\t",
		) + "\n",
	);
	const lines = [
		"# 中文女声配音",
		"",
		`Azure AI Speech · ${voice}（晓晓）· ${style} · 48 kHz / 单声道 / MP3 192 kbps。`,
		"",
		"28 段 MP3 为独立旁白，不含镜头尾部的操作留白；将每段放到下表时间即可。整轨已保留操作留白并对齐 06:20 时间轴，Remotion 默认播放 narration.wav。",
		"",
		"- [完整 MP3](../public/audio/narration.mp3)",
		"- [完整 WAV](../public/audio/narration.wav)",
		"- [全部分段](../public/audio/clips/)",
		"- [时间信息与合成记录](../public/audio/manifest.json)",
		"",
		"字幕按 Azure 逐句合成音频的实测时长对齐，再同步语速与镜头偏移；为整句字幕，并非逐词识别。部分紧凑镜头做了保持音高的轻微加速，具体倍速见表。未添加背景音乐。",
		"",
		"| 片段 | 放入整轨的位置（秒） | 旁白长度（秒） | 镜头长度（秒） | 倍速 |",
		"| --- | ---: | ---: | ---: | ---: |",
		...records.map(
			(entry) =>
				`| [${entry.id} · ${entry.title}](../public/${entry.file}) | ${(entry.narrationStartsAtMs / 1000).toFixed(2)} | ${entry.spokenSeconds.toFixed(2)} | ${entry.slotSeconds} | ${entry.tempo.toFixed(3)} |`,
		),
		"",
		"合成脚本：scripts/synthesize-azure.ps1。密钥仅在 PowerShell 进程内用于请求鉴权，不写入工程或生成的文档。相同 SSML 命中本地缓存，不重复调用 Azure。",
		"",
		"参考：[Azure Speech REST 合成接口](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech)。",
		"",
	];
	await writeFile(path.join(root, "deliverables/AUDIO.md"), lines.join("\n"));
	console.log(
		`Complete: ${records.length} clips, ${captions.length} aligned captions, ${position}s full narration.`,
	);
}
