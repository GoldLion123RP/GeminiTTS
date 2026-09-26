#!/usr/bin/env node
// Regenerates the generated table inside docs/README.md and docs/archive/README.md.
// Only rewrites content between the sync markers; all prose is left untouched.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const DOCS = join(ROOT, "docs");
const START = "<!-- sync:start -->";
const END = "<!-- sync:end -->";


async function collect(dir, { recursive = false } = {}) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (recursive) files.push(...(await collect(full, { recursive })));
			continue;
		}
		if (!entry.name.endsWith(".md")) continue;
		if (entry.name === "README.md") continue;
		files.push(full);
	}
	return files.sort();
}

function firstHeading(markdown) {
	for (const line of markdown.split("\n")) {
		if (line.startsWith("# ")) return line.slice(2).trim();
	}
	return null;
}

function description(markdown) {
	const match = markdown.match(/^<!--\s*desc:\s*(.+?)\s*-->$/m);
	return match ? match[1] : null;
}

function tableFor(rows) {
	if (rows.length === 0) return "_No documents yet._";
	const out = ["| Document | Description |", "| :--- | :--- |"];
	for (const row of rows) out.push(`| [${row.title}](${row.href}) | ${row.desc || "—"} |`);
	return out.join("\n");
}

async function render(dir, indexPath) {
	const files = await collect(dir, { recursive: true });
	const rows = [];
	for (const file of files) {
		const markdown = await readFile(file, "utf8");
		const title = firstHeading(markdown);
		if (!title) continue;
		const href = relative(join(ROOT, "docs"), file).split(sep).join("/");
		const desc = description(markdown);
		if (desc === null) {
			throw new Error(
				`${relative(ROOT, file)} has no \`<!-- desc: ... -->\` marker, so it cannot be indexed automatically.`,
			);
		}
		rows.push({ title, href, desc: desc.replace(/\|/g, "\\|") });
	}

	let content = await readFile(indexPath, "utf8");
	const start = content.indexOf(START);
	const end = content.indexOf(END);
	if (start === -1 || end === -1) {
		throw new Error(`${relative(ROOT, indexPath)} is missing its sync markers.`);
	}
	const updated =
		content.slice(0, start + START.length) + "\n\n" + tableFor(rows) + "\n\n" + content.slice(end);
	if (updated !== content) await writeFile(indexPath, updated, "utf8");
	return { path: relative(ROOT, indexPath), count: rows.length };
}

const results = [];

// Top-level index.
results.push(await render(DOCS, join(DOCS, "README.md")));

// Every subfolder that keeps its own README.md gets a generated index too.
for (const entry of await readdir(DOCS, { withFileTypes: true })) {
	if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
	const dir = join(DOCS, entry.name);
	const index = join(dir, "README.md");
	try {
		await readFile(index, "utf8");
	} catch {
		continue;
	}
	results.push(await render(dir, index));
}

for (const result of results) console.log(`${result.path}: ${result.count} document(s)`);
