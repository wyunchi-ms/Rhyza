import type { ReactNode } from "react";
import { Audio } from "@remotion/media";
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { totalFrames, type VideoProps } from "../model";
import { useHasAsset } from "./Assets";
import { Captions } from "./Captions";

function Soundtrack({ file, offsetFrames }: { file: string; offsetFrames: number }) {
	const available = useHasAsset(file);
	return available ? (
		<Audio name="旁白" src={staticFile(file)} trimBefore={offsetFrames} volume={1} />
	) : null;
}

export function VideoShell({
	children,
	directorMode,
	showCaptions,
	voiceoverFile,
	offsetFrames = 0,
}: VideoProps & { children: ReactNode; offsetFrames?: number }) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const hasVoiceover = useHasAsset(voiceoverFile);
	return (
		<AbsoluteFill
			style={{
				fontFamily:
					'"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
				backgroundColor: "#f6f6f3",
			}}
		>
			{children}
			<Soundtrack file={voiceoverFile} offsetFrames={offsetFrames} />
			{showCaptions && <Captions offsetFrames={offsetFrames} />}
			{directorMode && (
				<div style={{ position: "absolute", top: 13, right: 250, color: "#88733b", fontSize: 18 }}>
					分镜预览 · {hasVoiceover ? "已接入配音" : "配音文件未接入"} · {(frame / fps).toFixed(1)}s
				</div>
			)}
			<div
				style={{
					position: "absolute",
					bottom: 0,
					left: 0,
					height: 4,
					width: "100%",
					backgroundColor: "#e5e4ef",
				}}
			>
				<div
					style={{
						height: 4,
						backgroundColor: "#6058ca",
						width: `${interpolate(frame + offsetFrames, [0, totalFrames - 1], [0, 100], { extrapolateRight: "clamp" })}%`,
					}}
				/>
			</div>
		</AbsoluteFill>
	);
}
