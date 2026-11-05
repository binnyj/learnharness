"use client";

/**
 * The code editor (Phase 2, owner decision: CodeMirror 6). One editor per
 * file tab; uncontrolled internally, reporting every change. Enter types a
 * newline; Tab indents and Escape leaves the editor so keyboard users are
 * never trapped. The editor is a contenteditable typing surface, so the
 * app's window-level Enter-submits hook never fires from inside it.
 */

import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { oneDark } from "@codemirror/theme-one-dark";

function languageFor(fileName: string) {
	const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
	if (ext === ".css") return css();
	if (ext === ".html") return html();
	return javascript({ jsx: ext === ".jsx" || ext === ".tsx", typescript: ext === ".ts" || ext === ".tsx" });
}

const isDark = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");

const baseTheme = EditorView.theme({
	"&": { fontSize: "13px", backgroundColor: "transparent" },
	".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)", lineHeight: "1.5" },
	".cm-content": { minHeight: "8rem" },
	"&.cm-focused": { outline: "none" },
	".cm-gutters": { backgroundColor: "var(--card)", borderRight: "1px solid var(--border)" },
});

export function CodeEditor({
	fileName,
	value,
	onChange,
	onSubmitShortcut,
	ariaLabel,
}: {
	fileName: string;
	value: string;
	onChange: (value: string) => void;
	/** ⌘/Ctrl+Enter inside the editor (the dock's explicit submit chord). */
	onSubmitShortcut?: () => void;
	ariaLabel: string;
}) {
	const hostRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const onChangeRef = useRef(onChange);
	const onSubmitRef = useRef(onSubmitShortcut);
	onChangeRef.current = onChange;
	onSubmitRef.current = onSubmitShortcut;

	// One view per file; the value prop seeds it and later external changes
	// (draft restore, reset) are pushed in below.
	useEffect(() => {
		if (!hostRef.current) return;
		const theme = new Compartment();
		const view = new EditorView({
			parent: hostRef.current,
			state: EditorState.create({
				doc: value,
				extensions: [
					basicSetup,
					keymap.of([
						{ key: "Mod-Enter", run: () => { onSubmitRef.current?.(); return true; } },
						{ key: "Escape", run: (v) => { v.contentDOM.blur(); return true; } },
						indentWithTab,
					]),
					languageFor(fileName),
					baseTheme,
					theme.of(isDark() ? oneDark : []),
					EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
					EditorView.updateListener.of((u) => {
						if (u.docChanged) onChangeRef.current(u.state.doc.toString());
					}),
				],
			}),
		});
		viewRef.current = view;
		// Follow the app's light/dark switch.
		const observer = new MutationObserver(() => view.dispatch({ effects: theme.reconfigure(isDark() ? oneDark : []) }));
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
		return () => {
			observer.disconnect();
			view.destroy();
			viewRef.current = null;
		};
	}, [fileName, ariaLabel]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		const current = view.state.doc.toString();
		if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
	}, [value]);

	return <div ref={hostRef} data-testid="code-editor" className="min-w-0" />;
}
