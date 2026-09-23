import { AbsoluteFill, Interactive, interpolate, useCurrentFrame } from "remotion";

export function Outro() {
	const frame = useCurrentFrame();
	return (
		<AbsoluteFill style={{ backgroundColor: "#f0eef8", color: "#202738", padding: "100px 120px" }}>
			<div style={{ fontSize: 38, color: "#6058ca", fontWeight: 750 }}>Rhyza</div>
			<Interactive.Div
				name="核心出发点"
				style={{
					position: "absolute",
					left: 128,
					top: 170,
					fontSize: 28,
					color: "#667084",
				}}
			>
				为发散思考，保留每一条探索路径。
			</Interactive.Div>
			<Interactive.Div
				name="片尾主张"
				style={{
					position: "absolute",
					left: 120,
					top: 240,
					fontSize: 105,
					fontWeight: 780,
					lineHeight: 1.3,
					opacity: interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" }),
				}}
			>
				让问题自由分叉。
				<br />
				让知识持续积累。
			</Interactive.Div>
			<Interactive.Div
				name="项目地址"
				style={{
					position: "absolute",
					left: 128,
					top: 580,
					fontFamily: "Consolas, monospace",
					fontSize: 37,
					color: "#6058ca",
					opacity: interpolate(frame, [20, 40], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
					}),
				}}
			>
				github.com/wyunchi-ms/Rhyza
			</Interactive.Div>
			<div
				style={{
					position: "absolute",
					left: 128,
					top: 692,
					fontSize: 28,
					color: "#667084",
					lineHeight: 1.7,
				}}
			>
				Windows 优先 · 早期 MVP · 通过源码运行
				<br />
				本地保存会话与知识；AI 请求使用你连接的服务。
			</div>
		</AbsoluteFill>
	);
}
