import type { ReactNode } from "react";
import { AbsoluteFill, Interactive, interpolate, useCurrentFrame } from "remotion";
import { chapterById, project } from "../model";

export function ChapterFrame({ chapterId, children }: { chapterId: string; children: ReactNode }) {
	const chapter = chapterById(chapterId);
	const frame = useCurrentFrame();
	const index = project.chapters.findIndex((item) => item.id === chapterId);

	return (
		<AbsoluteFill style={{ backgroundColor: "#f6f6f3" }}>
			<Interactive.Div
				name="章节标题"
				style={{
					position: "absolute",
					top: 35,
					left: 72,
					display: "flex",
					gap: 24,
					alignItems: "baseline",
					opacity: interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" }),
				}}
			>
				<span style={{ fontSize: 28, color: "#6058ca", fontFamily: "Consolas, monospace" }}>
					{index.toString().padStart(2, "0")}
				</span>
				<span style={{ fontSize: 43, fontWeight: 750, color: "#202738" }}>{chapter.title}</span>
			</Interactive.Div>
			<div
				style={{
					position: "absolute",
					right: 74,
					top: 42,
					fontSize: 32,
					fontWeight: 750,
					color: "#6058ca",
				}}
			>
				Rhyza
			</div>
			<div
				style={{
					position: "absolute",
					top: 111,
					left: 64,
					width: 1792,
					height: 820,
					backgroundColor: "#ffffff",
					border: "1px solid #d9dae4",
					borderRadius: 14,
					overflow: "hidden",
					boxShadow: "0 10px 40px #2027380a",
				}}
			>
				{children}
			</div>
		</AbsoluteFill>
	);
}
