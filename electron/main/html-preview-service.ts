import { open, realpath } from "node:fs/promises";
import path from "node:path";
import {
	extractHtmlPreviewReferences,
	type HtmlPreviewDocument,
} from "../../src/shared/html-preview.js";

const maxDocumentBytes = 5_000_000;
const maxTotalBytes = 10_000_000;

/** Snapshot only HTML files inside this turn's actual workspace (including worktrees). */
export async function collectHtmlPreviews(
	answer: string,
	workspacePath: string,
): Promise<HtmlPreviewDocument[]> {
	const references = extractHtmlPreviewReferences(answer);
	if (!references.length) return [];
	const documents: HtmlPreviewDocument[] = [];
	let totalBytes = 0;
	const snapshot = async (root: string, requestedPath: string): Promise<string> => {
		const filename = await realpath(path.resolve(root, requestedPath));
		const relative = path.relative(root, filename);
		if (
			!relative ||
			relative === ".." ||
			relative.startsWith(`..${path.sep}`) ||
			path.isAbsolute(relative) ||
			!/\.html?$/i.test(filename)
		) {
			throw new Error("HTML previews must reference an HTML file inside the session workspace.");
		}
		const file = await open(filename, "r");
		try {
			const info = await file.stat();
			if (!info.isFile()) {
				throw new Error("HTML previews must reference a regular HTML file.");
			}
			if (info.size > maxDocumentBytes || totalBytes + info.size > maxTotalBytes)
				throw new Error("HTML preview exceeds the attachment size limit.");
			const buffer = Buffer.alloc(Math.min(maxDocumentBytes, maxTotalBytes - totalBytes) + 1);
			let length = 0;
			while (length < buffer.length) {
				const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
				if (!bytesRead) break;
				length += bytesRead;
			}
			if (length > maxDocumentBytes || totalBytes + length > maxTotalBytes)
				throw new Error("HTML preview exceeds the attachment size limit.");
			totalBytes += length;
			return buffer.subarray(0, length).toString("utf8");
		} finally {
			await file.close();
		}
	};
	for (const reference of references) {
		try {
			const root = await realpath(workspacePath);
			const document: HtmlPreviewDocument = {
				...reference,
				html: await snapshot(root, reference.path),
			};
			if (reference.previewPath !== undefined) {
				try {
					document.previewHtml = await snapshot(root, reference.previewPath);
				} catch (error) {
					document.previewError = error instanceof Error ? error.message : String(error);
				}
			}
			documents.push(document);
		} catch (error) {
			documents.push({
				...reference,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return documents;
}
