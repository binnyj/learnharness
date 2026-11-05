/**
 * Code answers in the UI (Phase 2): the dock form, the answered card and the
 * practice submission card render as static markup.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionDock } from "../components/question-dock.tsx";
import { AnsweredCard } from "../components/answered-card.tsx";
import { ThinkingCard } from "../components/practice-cards.tsx";

const input = {
	question: "Write the click handler.",
	language: "react",
	run: true,
	files: [{ name: "App.jsx", content: "export default () => <button/>" }, { name: "Btn.jsx", content: "" }],
	solution: "onClick={() => setN(n + 1)}",
	type: "check",
	nodeId: "n1",
};

describe("code answer UI", () => {
	it("the dock shows the workspace, tabs, Run and Submit code — and never the solution", () => {
		const html = renderToStaticMarkup(
			<QuestionDock toolName="code" toolCallId="c1" input={input as never} expanded onExpand={() => {}} onSubmit={() => {}} chatId="chat1" phase="teach" />,
		);
		assert.match(html, /data-testid="code-question-dock"/);
		assert.match(html, /App\.jsx/);
		assert.match(html, /Btn\.jsx/);
		assert.match(html, /data-testid="code-run"/);
		assert.match(html, /Submit code/);
		assert.match(html, /I don(&#x27;|')t know/);
		assert.ok(!html.includes("setN(n + 1)"), "the commitment never renders before submit");
	});

	it("a malformed code question renders the quiet fallback", () => {
		const html = renderToStaticMarkup(
			<QuestionDock toolName="code" toolCallId="c2" input={{ ...input, solution: "" } as never} expanded onExpand={() => {}} onSubmit={() => {}} />,
		);
		assert.ok(!html.includes("code-question-dock"));
	});

	it("the answered card shows the files, the run and the revealed solution", () => {
		const html = renderToStaticMarkup(
			<AnsweredCard
				answer={{ kind: "code", tool: "code", questionText: "Write it", dontKnow: false, answers: [], answeredAt: "t", committed: "the solution", files: [{ name: "App.jsx", content: "<script>alert(1)</script>" }], run: { status: "error", output: [], errors: ["boom"] } }}
				input={input}
			/>,
		);
		assert.match(html, /data-testid="code-answer"/);
		assert.match(html, /Runtime error/);
		assert.match(html, /data-testid="code-solution"/);
		assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "learner code renders as text, never markup");
	});

	it("practice code submissions render the code and any thinking", () => {
		const html = renderToStaticMarkup(
			<ThinkingCard data={{ problemCallId: "p1", text: "my idea", code: { language: "javascript", files: [{ name: "main.js", content: "console.log(1)" }] } }} />,
		);
		assert.match(html, /data-testid="code-submission-card"/);
		assert.match(html, /console\.log\(1\)/);
		assert.match(html, /Not run/);
		assert.match(html, /my idea/);
	});
});
