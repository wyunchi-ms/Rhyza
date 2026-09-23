import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
const project = await readJson("src/data/storyboard.json");
const media = await readJson("src/data/media.json");
const captions = await readJson("src/data/captions.json");
const clock = (seconds) =>
	`${Math.floor(seconds / 60)
		.toString()
		.padStart(2, "0")}:${Math.floor(seconds % 60)
		.toString()
		.padStart(2, "0")}`;
const srtClock = (ms) => {
	const rounded = Math.round(ms);
	return `${Math.floor(rounded / 3600000)
		.toString()
		.padStart(2, "0")}:${Math.floor((rounded / 60000) % 60)
		.toString()
		.padStart(2, "0")}:${Math.floor((rounded / 1000) % 60)
		.toString()
		.padStart(2, "0")},${(rounded % 1000).toString().padStart(3, "0")}`;
};

const total = project.chapters.reduce((sum, chapter) => sum + chapter.seconds, 0);
const recorded = project.chapters
	.filter((chapter) => chapter.kind === "recording")
	.reduce((sum, chapter) => sum + chapter.seconds, 0);
const lines = [
	`# ${project.title}`,
	"",
	`时长 ${clock(total)} · ${project.width}×${project.height} · ${project.fps} fps · 规划实机录屏 ${recorded} 秒（${((recorded / total) * 100).toFixed(1)}%）`,
	"",
	"> 这是录制前脚本。工程中的产品截图只用于分镜预览，不能当作已经完成的实机录屏。中文女声配音已合成，字幕已按逐句音频实测时长对齐；正式录屏后仍需检查动作与旁白的配合。",
	"",
	"核心叙事：线性聊天难以承接发散思考。Rhyza 的出发点是让多个方向自由展开、保留探索路径，并随时回到主线。全程使用公开的 Rhyza 演示副本，通过 Explain / Ask、两种视图、标记筛选和 Markdown 目录展示具体体验；Knowledge 收束结论，再通过正文里的知识链接展示复用。代码修改和 Provider 设置只简要带过。",
	"",
	"录制前准备：连接一个可用 Provider；准备同一 Session 连续四轮问答 A、B、C、D，其中 C 为带分级标题的长回答。从历史 C 新建 Explain 支线 E、Ask 支线 F，原后续 D 保留。提前准备一个已保存的 Entity 和 Mermaid Diagram，并确认回答正文中的名称已经匹配为知识链接。",
	"",
	"交互口径：按钮名为 Explain 和 Ask about this；List View 合并同一会话内没有分叉的连续路径，不删除或改写聊天内容。筛选选择要显示的叶节点状态，并保留命中节点的祖先路径。知识链接悬停显示摘要，点击打开详情或完整图表。",
	"",
	"录屏建议：1920×1080、30fps、隐藏系统通知，应用字体放大到成片可读。每个动作前后留 2 秒余量；将等待剪短，但保留真实点击和 2—3 秒流式输出。配音独立录制，录屏原声默认静音。",
	"",
	"## 章节时间线",
	"",
	"| 时间 | 内容 | 画面 |",
	"| --- | --- | --- |",
];
let cursor = 0;
for (const chapter of project.chapters) {
	lines.push(
		`| ${clock(cursor)}—${clock(cursor + chapter.seconds)} | ${chapter.title} | ${chapter.kind === "recording" ? "实机录屏" : "标题动画"} |`,
	);
	cursor += chapter.seconds;
}

const voice = [];
cursor = 0;
for (const chapter of project.chapters) {
	lines.push("", `## ${clock(cursor)}—${clock(cursor + chapter.seconds)} · ${chapter.title}`, "");
	const items = chapter.kind === "recording" ? chapter.shots : [chapter];
	for (const item of items) {
		const span = `${clock(cursor)}—${clock(cursor + item.seconds)}`;
		lines.push(`### ${span} · ${item.title}`, "");
		if (chapter.kind === "recording") {
			lines.push(
				`录屏文件：\`public/${media[item.id].file}\`（成片段落 ${item.seconds} 秒）`,
				"",
				`操作：${item.action}`,
				"",
				`拍摄提示：${item.note}`,
				"",
			);
			if (item.prompt) lines.push("现场输入：", "", "```text", item.prompt, "```", "");
		} else {
			lines.push(
				`画面：${chapter.id === "intro" ? "先展示线性的一问一答，约第 7 秒展开成多个探索方向；主标题为“思考会发散，对话也应该”。这是概念示意，不冒充实机操作。" : "呼应“为发散思考，保留每一条探索路径”，展示产品主张、项目地址和当前体验方式。"}`,
				"",
			);
		}
		lines.push("旁白：", "", ...item.narration.map((text) => `> ${text}`), "");
		voice.push(`[${span}] ${item.title}`, ...item.narration, "");
		cursor += item.seconds;
	}
}
lines.push(
	"## 调整与交付",
	"",
	"录完后把视频放入 public/recordings/，文件名与上表一致。src/data/media.json 的 trimBefore 使用 30fps 合成帧数；playbackRate 默认 1。源素材需覆盖片段时长，不自动循环或拉长。",
	"",
	"全文旁白在 NARRATION.txt。已生成 28 段中文女声 MP3，清单见 AUDIO.md；完整配音为 public/audio/narration.wav 和 narration.mp3，已对齐时间线。字幕按逐句音频实测时长生成；修改旁白后重新合成并执行 npm run script 更新 SRT。",
	"",
	"章节时长可调整：同步修改 storyboard.json、相应场景里的 Sequence、Walkthrough.tsx 和 Root.tsx，以及全局字幕时间；npm run check 会检查时间轴是否一致。",
	"",
	"不要把本地存储说成离线推理，也不要把 Worktree 尝试描述为一定成功。Pi 插件以 Copilot 工作流为演示范围。当前通过源码体验，不宣称已提供安装包。",
	"",
);

await mkdir(path.join(root, "deliverables"), { recursive: true });
await writeFile(path.join(root, "deliverables/SCRIPT.md"), lines.join("\n"), "utf8");
await writeFile(path.join(root, "deliverables/NARRATION.txt"), voice.join("\n"), "utf8");
await writeFile(
	path.join(root, "deliverables/CAPTIONS.srt"),
	captions
		.map(
			(cue, index) =>
				`${index + 1}\n${srtClock(cue.startMs)} --> ${srtClock(cue.endMs)}\n${cue.text}\n`,
		)
		.join("\n"),
	"utf8",
);
console.log(
	`Exported script, narration and ${captions.length} subtitle cues. ${clock(total)}, ${recorded}s screen recording planned.`,
);
