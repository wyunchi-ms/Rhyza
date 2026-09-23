import { Video } from "@remotion/media";
import {
	AbsoluteFill,
	CanvasImage,
	Interactive,
	interpolate,
	staticFile,
	useCurrentFrame,
} from "remotion";
import { mediaById, shotById } from "../model";
import { useHasAsset } from "./Assets";

export function Shot({ id, directorMode }: { id: string; directorMode: boolean }) {
	const shot = shotById(id);
	const media = mediaById(id);
	const available = useHasAsset(media.file);
	const frame = useCurrentFrame();

	return (
		<AbsoluteFill style={{ backgroundColor: "#fff" }}>
			{available ? (
				<Video
					name={shot.title}
					src={staticFile(media.file)}
					trimBefore={media.trimBefore}
					playbackRate={media.playbackRate}
					muted
					style={{ width: "100%", height: "100%", objectFit: "contain" }}
				/>
			) : (
				<>
					<CanvasImage
						src={staticFile(`reference/${shot.fallback}.png`)}
						style={{ width: "100%", height: "100%", objectFit: "contain", opacity: 0.25 }}
					/>
					<AbsoluteFill style={{ backgroundColor: "#f7f7fc75" }} />
					<div
						style={{
							position: "absolute",
							top: 48,
							left: 52,
							fontSize: 25,
							color: "#665b38",
							padding: "10px 16px",
							background: "#fff4cc",
							border: "1px solid #e1cc83",
							borderRadius: 6,
						}}
					>
						待录制 · 背景为仓库截图，仅作分镜参考
					</div>
					<Interactive.Div
						name="录屏镜头说明"
						style={{
							position: "absolute",
							top: 155,
							left: 112,
							right: 112,
							opacity: interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" }),
						}}
					>
						<div
							style={{
								fontFamily: "Consolas, monospace",
								color: "#6058ca",
								fontSize: 25,
								marginBottom: 17,
							}}
						>
							TAKE {id.toUpperCase()} · {shot.seconds}s
						</div>
						<div style={{ fontSize: 63, color: "#202738", fontWeight: 760, lineHeight: 1.2 }}>
							{shot.title}
						</div>
						<div
							style={{
								marginTop: 28,
								maxWidth: 1420,
								fontSize: 34,
								color: "#3c475b",
								lineHeight: 1.65,
							}}
						>
							{shot.action}
						</div>
						{shot.prompt && (
							<div
								style={{
									marginTop: 25,
									paddingLeft: 25,
									borderLeft: "4px solid #6058ca",
									maxWidth: 1440,
								}}
							>
								<div style={{ fontSize: 22, color: "#6058ca", marginBottom: 8 }}>现场输入</div>
								<div style={{ fontSize: 28, lineHeight: 1.6, color: "#273244" }}>{shot.prompt}</div>
							</div>
						)}
					</Interactive.Div>
					<div
						style={{
							position: "absolute",
							left: 112,
							bottom: 48,
							fontSize: 22,
							color: "#596579",
							fontFamily: "Consolas, monospace",
						}}
					>
						public/{media.file}
					</div>
				</>
			)}
			{available && directorMode && (
				<div
					style={{
						position: "absolute",
						left: 24,
						top: 22,
						right: 24,
						padding: "14px 20px",
						backgroundColor: "#fff9ddf2",
						color: "#524622",
						fontSize: 23,
						lineHeight: 1.6,
						borderRadius: 8,
					}}
				>
					导演提示 · {shot.title}：{shot.note}
				</div>
			)}
		</AbsoluteFill>
	);
}
