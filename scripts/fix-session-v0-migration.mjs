#!/usr/bin/env node
/**
 * One-shot local repair for historical session logs that dsh 0.1.5-rc.2's
 * v0→v3 migration chain refuses. Backups: <file>.bak-migfix.
 *
 * Repairs:
 *  1. subagent/descriptor data.version 2 → 3 (v2/v3 shapes are identical).
 *  2. duplicate seq at `session/end-seed` → `agent/inbox/spliced` boundary:
 *     full seq-space renumber (top-level seq, chunk seq0 + dt offsets,
 *     sourceEventSeqs, surfaceOp.start/end, messageSeqs) so coordinates stay
 *     globally contiguous; references remapped via the old→new coordinate map.
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.join(process.env.HOME, '.dsh', 'sessions');

function listSessionLogs() {
	const out = [];
	for (const ws of fs.readdirSync(ROOT)) {
		const wsPath = path.join(ROOT, ws);
		if (!fs.statSync(wsPath).isDirectory()) continue;
		for (const sid of fs.readdirSync(wsPath)) {
			const sPath = path.join(wsPath, sid);
			if (!fs.statSync(sPath).isDirectory()) continue;
			const f = ['session.v3.jsonl.zstd', 'session.jsonl.zstd'].find((n) =>
				fs.existsSync(path.join(sPath, n)),
			);
			if (f) out.push(path.join(sPath, f));
		}
	}
	return out;
}

/**
 * Chunk rows expand into one coordinate per text/arg piece: seq0 + index.
 * (`dt` is a time-delta payload, not a coordinate delta.)
 */
function chunkRow(ev) {
	if (ev.seq0 !== undefined) return { start: ev.seq0, top: true, ev };
	if (ev.data?.seq0 !== undefined) return { start: ev.data.seq0, top: false, ev: ev.data };
	if (/\bchunks$/.test(ev.type) && ev.seq === undefined) return { start: undefined, top: null, ev: ev.data ?? ev };
	return null;
}

/** Enumerate every seq coordinate a row occupies, in order (needs running `last`). */
function rowCoords(ev, last) {
	const c = chunkRow(ev);
	if (c) {
		const n = ev.data?.texts?.length ?? ev.data?.args?.length ?? c.ev.texts?.length ?? 1;
		const start = c.start !== undefined ? c.start : last + 1;
		return { coords: Array.from({ length: n }, (_, i) => start + i), start: c.start };
	}
	return { coords: ev.seq !== undefined ? [ev.seq] : [], start: ev.seq };
}

function repair(file) {
	const text = zlib.zstdDecompressSync(fs.readFileSync(file)).toString();
	const lines = text.split('\n').filter(Boolean);
	const header = JSON.parse(lines[0]);
	const events = lines.slice(1).map((l) => JSON.parse(l));

	/* repair 1: descriptor v2 → v3 */
	let descFixed = 0;
	for (const ev of events) {
		if (ev.type === 'subagent/descriptor' && ev.data?.version === 2) {
			ev.data.version = 3;
			descFixed++;
		}
	}

	/* repair 2: seq-space renumber */
	const rows = events.map((ev) => ({ ev }));
	let last = -1;
	rows.forEach((r) => {
		const { coords } = rowCoords(r.ev, last);
		r.coords = coords;
		if (coords.length) last = coords[coords.length - 1];
	});
	const flat = []; // {rowIdx, coordIdx, oldCoord, newCoord}
	for (let i = 0; i < rows.length; i++)
		rows[i].coords.forEach((oldCoord, coordIdx) => flat.push({ rowIdx: i, coordIdx, oldCoord }));
	const coordMap = new Map(); // oldCoord -> newCoord, first occurrence (for references)
	// coords are in file order; simply renumber them 0..n-1 (fixes dups AND gaps)
	flat.forEach((entry, idx) => {
		entry.newCoord = idx;
		if (!coordMap.has(entry.oldCoord)) coordMap.set(entry.oldCoord, idx);
	});
	const map = (v) => {
		const n = coordMap.get(v);
		if (n === undefined) throw new Error(`unmapped coordinate ${v}`);
		return n;
	};

	let changed = descFixed > 0;
	const outLines = [lines[0]];
	const rowNew = flat.reduce((acc, e) => {
		(acc[e.rowIdx] ??= [])[e.coordIdx] = e.newCoord;
		return acc;
	}, []);
	rows.forEach(({ ev }, i) => {
		const before = JSON.stringify(ev);
		const news = rowNew[i];
		const c = chunkRow(ev);
		if (c) {
			if (c.start !== undefined && news?.[0] !== undefined) {
				if (c.top) ev.seq0 = news[0];
				else ev.data.seq0 = news[0];
			}
		} else if (ev.seq !== undefined && news?.[0] !== undefined) {
			ev.seq = news[0];
		}
		if (Array.isArray(ev.sourceEventSeqs))
			ev.sourceEventSeqs = ev.sourceEventSeqs.map((r) =>
				Array.isArray(r) ? r.map(map) : map(r),
			);
		if (Array.isArray(ev.data?.messageSeqs)) ev.data.messageSeqs = ev.data.messageSeqs.map(map);
		if (ev.data?.surfaceOp && ev.data.surfaceOp.start !== undefined) {
			ev.data.surfaceOp.start = map(ev.data.surfaceOp.start);
			ev.data.surfaceOp.end = map(ev.data.surfaceOp.end);
		}
		if (JSON.stringify(ev) !== before) changed = true;
		outLines.push(JSON.stringify(ev));
	});

	if (!changed) return 'clean';
	const backup = file + '.bak-migfix';
	if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
	const raw = Buffer.from(outLines.join('\n') + '\n');
	const tmp = file + '.tmp-migfix';
	fs.writeFileSync(tmp, raw);
	execFileSync('zstd', ['-q', '-f', tmp, '-o', file]);
	fs.unlinkSync(tmp);
	return `fixed (descriptor v2→v3: ${descFixed}, rows: ${rows.length})`;
}

const logs = listSessionLogs();
console.log('session logs:', logs.length);
for (const f of logs) {
	try {
		const r = repair(f);
		if (r !== 'clean') console.log(path.basename(path.dirname(f)), '→', r);
	} catch (e) {
		console.log('ERROR', f, '→', e.message);
	}
}
console.log('done');
