// Flow templates surfaced in the "新建 Flow" dialog. Templates are pure
// frontend data (no backend API) — selecting one stamps a starter
// FlowDefinition the user can edit immediately.

import type { FlowDefinition, FlowNode, FlowEdge, NodeType } from "../types/flow";

export interface FlowTemplate {
  id: string;
  label: string;
  description: string;
  /** Builds a fresh definition with deterministic-but-unique node ids. */
  build: () => FlowDefinition;
}

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

function n(type: NodeType, x: number, y: number, config: FlowNode["config"] = {}): FlowNode {
  return { id: uid("n"), type, position: { x, y }, config };
}

function e(source: string, target: string, label?: string): FlowEdge {
  const branch = label;
  return { id: uid("e"), source, target, label, branch };
}

const PR_REVIEW_SCRIPT = `// Parse the GitHub webhook payload into a normalized PR descriptor.
// \`input\` is whatever the webhook delivered (already JSON-parsed).
const pr = input?.pull_request ?? {};
return {
  owner: input?.repository?.owner?.login,
  repo: input?.repository?.name,
  number: pr.number,
  title: pr.title,
  body: pr.body ?? "",
  head: pr.head?.sha,
  diff_url: pr.diff_url,
};
`;

const SIMPLE_HTTP_SCRIPT = `// Build the HTTP payload for the next node.
return {
  greeting: "hello",
  ts: Date.now(),
};
`;

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: "blank",
    label: "空白 Flow",
    description: "不预置任何节点，从零开始拖拽。",
    build: () => ({ nodes: [], edges: [] }),
  },
  {
    id: "simple-http",
    label: "简单 HTTP 调用",
    description: "Script 生成 payload → HTTP 节点发出请求。",
    build: () => {
      const script = n("action.script", 80, 80, {
        label: "Build payload",
        scriptLanguage: "javascript",
        scriptCode: SIMPLE_HTTP_SCRIPT,
      });
      const http = n("action.http", 360, 80, {
        label: "Send request",
        httpMethod: "POST",
        httpUrl: "https://example.com/api/echo",
        httpHeaders: [{ key: "Content-Type", value: "application/json" }],
        httpBody: '{"hello":"world"}',
      });
      return {
        nodes: [script, http],
        edges: [e(script.id, http.id)],
      };
    },
  },
  {
    id: "condition",
    label: "条件分支",
    description: "Script → 条件节点 → 分别走两条 HTTP 分支。",
    build: () => {
      const script = n("action.script", 80, 120, {
        label: "Compute branch",
        scriptLanguage: "javascript",
        scriptCode: `// Return any value the condition node can evaluate against.\nreturn { kind: input?.kind ?? "a" };\n`,
      });
      const cond = n("logic.condition", 360, 120, {
        label: "Route by kind",
        conditionExpression: "input.kind",
        conditionBranches: [
          { value: "a", label: "Branch A" },
          { value: "b", label: "Branch B" },
        ],
      });
      const httpA = n("action.http", 640, 40, {
        label: "Branch A",
        httpMethod: "POST",
        httpUrl: "https://example.com/branch-a",
      });
      const httpB = n("action.http", 640, 200, {
        label: "Branch B",
        httpMethod: "POST",
        httpUrl: "https://example.com/branch-b",
      });
      return {
        nodes: [script, cond, httpA, httpB],
        edges: [
          e(script.id, cond.id),
          e(cond.id, httpA.id, "a"),
          e(cond.id, httpB.id, "b"),
        ],
      };
    },
  },
  {
    id: "pr-review",
    label: "PR Review",
    description: "Webhook 触发 → 解析 PR → 调 review API → 条件 → 发 comment。",
    build: () => {
      const trigger = n("trigger.webhook", 60, 120, {
        label: "GitHub webhook",
        signatureAlgo: "hmac-sha256",
        signatureHeader: "X-Hub-Signature-256",
      });
      const parse = n("action.script", 320, 120, {
        label: "Parse PR",
        scriptLanguage: "javascript",
        scriptCode: PR_REVIEW_SCRIPT,
      });
      const review = n("action.http", 580, 120, {
        label: "Call review API",
        httpMethod: "POST",
        httpUrl: "https://im-lab.xming.ai/v1/review",
        httpHeaders: [{ key: "Content-Type", value: "application/json" }],
        httpBody: '{"owner":"{{ steps.parse.owner }}","repo":"{{ steps.parse.repo }}","number":{{ steps.parse.number }}}',
      });
      const cond = n("logic.condition", 840, 120, {
        label: "Has findings?",
        conditionExpression: "input.findings && input.findings.length > 0",
        conditionBranches: [
          { value: "true", label: "comment" },
          { value: "false", label: "skip" },
        ],
      });
      const comment = n("action.http", 1100, 60, {
        label: "Post comment",
        httpMethod: "POST",
        httpUrl: "https://api.github.com/repos/{{ steps.parse.owner }}/{{ steps.parse.repo }}/issues/{{ steps.parse.number }}/comments",
        httpHeaders: [
          { key: "Authorization", value: "Bearer {{ secrets.GITHUB_TOKEN }}" },
          { key: "Accept", value: "application/vnd.github+json" },
        ],
        httpBody: '{"body":"{{ steps.review.summary }}"}',
      });
      return {
        nodes: [trigger, parse, review, cond, comment],
        edges: [
          e(trigger.id, parse.id),
          e(parse.id, review.id),
          e(review.id, cond.id),
          e(cond.id, comment.id, "true"),
        ],
      };
    },
  },
];

export function findTemplate(id: string): FlowTemplate | undefined {
  return FLOW_TEMPLATES.find((t) => t.id === id);
}
