import { AbsoluteFill, Interactive, interpolate, useCurrentFrame } from "remotion";

export function Intro() {
	const frame = useCurrentFrame();
	return (
		<AbsoluteFill style={{ backgroundColor: "#f6f6f3", color: "#202738" }}>
			<div
				style={{
					position: "absolute",
					top: 80,
					left: 100,
					display: "flex",
					alignItems: "center",
					gap: 20,
				}}
			>
				<div style={{ width: 16, height: 16, borderRadius: "50%", backgroundColor: "#6058ca" }} />
				<span style={{ fontSize: 37, fontWeight: 750 }}>Rhyza</span>
			</div>
			<Interactive.Div
				name="片头主标题"
				style={{
					position: "absolute",
					top: 290,
					left: 100,
					fontSize: 108,
					fontWeight: 780,
					lineHeight: 1.28,
					opacity: interpolate(frame, [0, 24], [0, 1], { extrapolateRight: "clamp" }),
					translate: interpolate(frame, [0, 24], ["0px 24px", "0px 0px"], {
						extrapolateRight: "clamp",
					}),
				}}
			>
				思考会发散。
				<br />
				<span style={{ color: "#6058ca" }}>对话也应该。</span>
			</Interactive.Div>
			<Interactive.Div
				name="片头说明"
				style={{
					position: "absolute",
					top: 658,
					left: 106,
					fontSize: 36,
					color: "#626d82",
					opacity: interpolate(frame, [25, 50], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
					}),
				}}
			>
				从线性聊天，走向可自由展开的探索。
			</Interactive.Div>
			<svg
				width="780"
				height="620"
				viewBox="0 0 780 620"
				style={{ position: "absolute", left: 1040, top: 220 }}
				aria-label="从线性对话到发散探索的概念示意"
			>
				<g
					style={{
						opacity: interpolate(frame, [0, 20, 210, 240], [0, 1, 1, 0], {
							extrapolateLeft: "clamp",
							extrapolateRight: "clamp",
						}),
					}}
				>
					<text x="30" y="218" fontSize="28" fill="#657087">
						一问一答，沿着一条线往下聊
					</text>
					<rect x="30" y="270" width="200" height="82" rx="12" fill="#fff" stroke="#d8d7e3" />
					<rect x="275" y="270" width="200" height="82" rx="12" fill="#fff" stroke="#d8d7e3" />
					<rect x="520" y="270" width="200" height="82" rx="12" fill="#eeecfa" stroke="#8176d1" />
					<path
						d="M232 311 H264 M254 302 L264 311 L254 320 M477 311 H509 M499 302 L509 311 L499 320"
						fill="none"
						stroke="#a29bbf"
						strokeWidth="3"
					/>
					<text x="130" y="322" textAnchor="middle" fontSize="31" fill="#283347">
						提问
					</text>
					<text x="375" y="322" textAnchor="middle" fontSize="31" fill="#283347">
						回答
					</text>
					<text x="620" y="322" textAnchor="middle" fontSize="31" fill="#6058ca">
						继续追问
					</text>
				</g>
				<g
					style={{
						opacity: interpolate(frame, [225, 255], [0, 1], {
							extrapolateLeft: "clamp",
							extrapolateRight: "clamp",
						}),
					}}
				>
					<g
						fill="none"
						stroke="#c7c3df"
						strokeWidth="3"
						style={{
							opacity: interpolate(frame, [225, 265], [0, 1], {
								extrapolateLeft: "clamp",
								extrapolateRight: "clamp",
							}),
						}}
					>
						<path d="M90 310 H195 Q220 310 220 285 V130 Q220 105 250 105 H330" />
						<path d="M90 310 H330" />
						<path d="M90 310 H195 Q220 310 220 340 V490 Q220 515 250 515 H330" />
					</g>
					<circle cx="90" cy="310" r="20" fill="#6058ca" />
					<text x="38" y="366" fill="#6058ca" fontSize="26">
						一个问题
					</text>
					<g
						style={{
							opacity: interpolate(frame, [240, 270], [0, 1], {
								extrapolateLeft: "clamp",
								extrapolateRight: "clamp",
							}),
						}}
					>
						<rect x="330" y="55" width="395" height="100" rx="12" fill="#fff" stroke="#d8d7e3" />
						<text x="360" y="117" fontSize="31" fill="#283347">
							主线 · 请求如何流转？
						</text>
					</g>
					<g
						style={{
							opacity: interpolate(frame, [270, 300], [0, 1], {
								extrapolateLeft: "clamp",
								extrapolateRight: "clamp",
							}),
						}}
					>
						<rect
							x="330"
							y="260"
							width="395"
							height="100"
							rx="12"
							fill="#eeecfa"
							stroke="#8176d1"
						/>
						<text x="360" y="322" fontSize="31" fill="#6058ca">
							支线 · 换个方案呢？
						</text>
					</g>
					<g
						style={{
							opacity: interpolate(frame, [300, 330], [0, 1], {
								extrapolateLeft: "clamp",
								extrapolateRight: "clamp",
							}),
						}}
					>
						<rect x="330" y="465" width="395" height="100" rx="12" fill="#fff" stroke="#d8d7e3" />
						<text x="360" y="527" fontSize="31" fill="#283347">
							解释 · 这个词是什么？
						</text>
					</g>
				</g>
				<text x="725" y="610" textAnchor="end" fontSize="21" fill="#939aaa">
					对话结构 · 概念示意
				</text>
			</svg>
		</AbsoluteFill>
	);
}
