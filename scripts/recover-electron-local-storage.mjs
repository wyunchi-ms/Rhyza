import { readFileSync, writeFileSync } from "node:fs";

const stateKey = "rhyza-workspace-v2";
const legacyStateKey = `${["know", "branch"].join("")}-workspace-v2`;
const candidates = [];

for (const file of process.argv.slice(2)) {
	const bytes = readFileSync(file);
	const entries = readTable(bytes);
	if (process.env.RHYZA_RECOVERY_DEBUG === "1") {
		process.stderr.write(
			`${file}: ${entries.length} entries; ${entries
				.slice(0, 5)
				.map((entry) => JSON.stringify(entry.key))
				.join(", ")}\n`,
		);
	}
	for (const { key, value } of entries) {
		if (!key.includes(stateKey) && !key.includes(legacyStateKey)) continue;
		const serialized = decodeLocalStorageValue(value);
		try {
			const parsed = JSON.parse(serialized);
			const state = parsed?.state ?? {};
			candidates.push({
				file,
				key,
				serialized,
				score:
					(state.turns?.length ?? 0) * 100 +
					(state.entities?.length ?? 0) * 20 +
					(state.diagrams?.length ?? 0) * 20 +
					(state.changesets?.length ?? 0) * 5 +
					(state.sessions?.length ?? 0),
				counts: {
					sessions: state.sessions?.length ?? 0,
					turns: state.turns?.length ?? 0,
					entities: state.entities?.length ?? 0,
					diagrams: state.diagrams?.length ?? 0,
				},
			});
		} catch {
			// Ignore unrelated or superseded malformed records.
			if (process.env.RHYZA_RECOVERY_DEBUG === "1") {
				process.stderr.write(
					`Unparsed ${JSON.stringify(key)} value(${value.length})=${JSON.stringify(decodeLocalStorageValue(value).slice(0, 160))}\n`,
				);
			}
		}
	}
}

candidates.sort((left, right) => right.score - left.score);
const best = candidates[0];
if (best && process.env.RHYZA_RECOVERY_OUTPUT) {
	writeFileSync(process.env.RHYZA_RECOVERY_OUTPUT, best.serialized, "utf8");
}
process.stdout.write(
	JSON.stringify(
		best
			? {
					file: best.file,
					key: best.key,
					score: best.score,
					counts: best.counts,
					output: process.env.RHYZA_RECOVERY_OUTPUT ?? null,
				}
			: null,
	),
);

function readTable(bytes) {
	if (bytes.length < 48) return [];
	let footerOffset = bytes.length - 48;
	const metaHandle = readHandle(bytes, footerOffset);
	const indexHandle = readHandle(bytes, metaHandle.next);
	const indexEntries = readBlockEntries(bytes, indexHandle.offset, indexHandle.size);
	return indexEntries.flatMap((entry) => {
		const handle = readHandle(entry.value, 0);
		return readBlockEntries(bytes, handle.offset, handle.size);
	});
}

function readBlockEntries(table, offset, size) {
	const raw = table.subarray(offset, offset + size);
	const compression = table[offset + size];
	const block = compression === 1 ? unsnappy(raw) : raw;
	if (block.length < 4) return [];
	const restartCount = block.readUInt32LE(block.length - 4);
	const entriesEnd = block.length - 4 - restartCount * 4;
	const entries = [];
	let cursor = 0;
	let previousKey = Buffer.alloc(0);
	while (cursor < entriesEnd) {
		const shared = readVarint(block, cursor);
		cursor = shared.next;
		const unshared = readVarint(block, cursor);
		cursor = unshared.next;
		const valueLength = readVarint(block, cursor);
		cursor = valueLength.next;
		const suffix = block.subarray(cursor, cursor + unshared.value);
		cursor += unshared.value;
		const value = block.subarray(cursor, cursor + valueLength.value);
		cursor += valueLength.value;
		const internalKey = Buffer.concat([previousKey.subarray(0, shared.value), suffix]);
		previousKey = internalKey;
		const userKey = internalKey.length >= 8 ? internalKey.subarray(0, -8) : internalKey;
		entries.push({ key: userKey.toString("utf8"), value });
	}
	return entries;
}

function readHandle(bytes, offset) {
	const blockOffset = readVarint(bytes, offset);
	const blockSize = readVarint(bytes, blockOffset.next);
	return { offset: blockOffset.value, size: blockSize.value, next: blockSize.next };
}

function readVarint(bytes, start) {
	let value = 0;
	let shift = 0;
	let cursor = start;
	while (cursor < bytes.length) {
		const byte = bytes[cursor++];
		value += (byte & 0x7f) * 2 ** shift;
		if ((byte & 0x80) === 0) break;
		shift += 7;
	}
	return { value, next: cursor };
}

function unsnappy(input) {
	const expected = readVarint(input, 0);
	const output = Buffer.alloc(expected.value);
	let source = expected.next;
	let target = 0;
	while (source < input.length && target < output.length) {
		const tag = input[source++];
		const type = tag & 3;
		if (type === 0) {
			let length = tag >> 2;
			if (length < 60) length += 1;
			else {
				const byteCount = length - 59;
				length = 1;
				for (let index = 0; index < byteCount; index += 1)
					length += input[source++] * 2 ** (index * 8);
			}
			input.copy(output, target, source, source + length);
			source += length;
			target += length;
			continue;
		}
		let length;
		let distance;
		if (type === 1) {
			length = 4 + ((tag >> 2) & 7);
			distance = ((tag & 0xe0) << 3) | input[source++];
		} else if (type === 2) {
			length = 1 + (tag >> 2);
			distance = input.readUInt16LE(source);
			source += 2;
		} else {
			length = 1 + (tag >> 2);
			distance = input.readUInt32LE(source);
			source += 4;
		}
		for (let index = 0; index < length; index += 1) {
			output[target] = output[target - distance];
			target += 1;
		}
	}
	return output;
}

function decodeLocalStorageValue(value) {
	if (value[0] === 0) return value.subarray(1).toString("utf16le");
	if (value[0] === 1) return value.subarray(1).toString("utf8");
	return value.toString("utf8");
}
