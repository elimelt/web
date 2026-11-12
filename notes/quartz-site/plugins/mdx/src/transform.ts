// Turns the JSX in an MDX note into placeholders that ordinary Markdown can
// carry, so the rest of the Quartz pipeline (wikilinks, callouts, math,
// Mermaid, aliases) treats the note exactly like a .md note.
//
// Only what a note needs to place a component is supported: a self-closing
// component tag on its own lines at the top level, with literal attribute
// values. Imports, exports, inline JSX and {expressions} fail the build with
// the line that caused it, rather than rendering as stray text.

import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { mathFromMarkdown } from "mdast-util-math";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { frontmatter } from "micromark-extension-frontmatter";
import { math } from "micromark-extension-math";
import { mdxjs } from "micromark-extension-mdxjs";

export const MDX_FLAG = /^mdx:\s*true\s*$/m;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
export const PLACEHOLDER = /^<div data-mdx-component="([A-Za-z][\w]*)" data-mdx-props="([\w-]*)"><\/div>$/;

type Node = {
  type: string;
  name?: string | null;
  value?: string;
  attributes?: Attribute[];
  children?: Node[];
  position?: { start: { line: number; offset?: number }; end: { offset?: number } };
  data?: { estree?: Program };
};
type Attribute = { type: string; name?: string; value?: unknown };
type Program = { body: Array<{ type: string; expression?: Expr }>; comments?: unknown[] };
type Expr = {
  type: string;
  value?: unknown;
  operator?: string;
  argument?: Expr;
  elements?: Array<Expr | null>;
  properties?: Array<{ type: string; computed?: boolean; key: Expr; value: Expr; kind?: string }>;
  name?: string;
  quasis?: Array<{ value: { cooked: string } }>;
  expressions?: Expr[];
};

export function isMdx(source: string): boolean {
  const match = FRONTMATTER.exec(source);
  return Boolean(match && MDX_FLAG.test(match[1]));
}

function noteTitle(source: string): string {
  const title = FRONTMATTER.exec(source)?.[1].match(/^title:\s*["']?(.*?)["']?\s*$/m)?.[1];
  return title ? `"${title}"` : "an MDX note";
}

/** Evaluate an attribute expression that is a plain literal. */
function literal(expr: Expr | undefined, fail: (why: string) => never): unknown {
  if (!expr) fail("an empty expression");
  switch (expr.type) {
    case "Literal":
      return expr.value;
    case "TemplateLiteral":
      if (expr.expressions?.length) fail("a template literal with ${…}");
      return expr.quasis!.map((q) => q.value.cooked).join("");
    case "UnaryExpression": {
      const value = literal(expr.argument, fail);
      if (typeof value !== "number" || (expr.operator !== "-" && expr.operator !== "+")) {
        fail(`the operator ${expr.operator}`);
      }
      return expr.operator === "-" ? -value : value;
    }
    case "ArrayExpression":
      return expr.elements!.map((element) => literal(element ?? undefined, fail));
    case "ObjectExpression": {
      const out: Record<string, unknown> = {};
      for (const property of expr.properties!) {
        if (property.type !== "Property" || property.computed || property.kind !== "init") {
          fail("a spread or computed object key");
        }
        const key = property.key.type === "Identifier" ? property.key.name! : String(literal(property.key, fail));
        out[key] = literal(property.value, fail);
      }
      return out;
    }
    case "Identifier":
      if (expr.name === "undefined") return undefined;
      fail(`the variable ${expr.name}`);
    default:
      fail(`a ${expr.type}`);
  }
}

function props(node: Node, fail: (why: string) => never): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const attribute of node.attributes ?? []) {
    if (attribute.type !== "mdxJsxAttribute" || !attribute.name) fail("a spread attribute");
    const value = attribute.value as { type?: string; data?: { estree?: Program } } | string | null | undefined;
    if (value === null || value === undefined) {
      out[attribute.name] = true;
    } else if (typeof value === "string") {
      out[attribute.name] = value;
    } else {
      const body = value.data?.estree?.body;
      if (!body || body.length !== 1 || body[0].type !== "ExpressionStatement") {
        fail(`the value of ${attribute.name}`);
      }
      out[attribute.name] = literal(body[0].expression, (why) =>
        fail(`${why} in the value of ${attribute.name}; attribute values must be literals`),
      );
    }
  }
  return out;
}

const isComment = (node: Node): boolean => {
  const program = node.data?.estree;
  return Boolean(program && program.body.length === 0 && (program.comments?.length ?? 0) > 0);
};

/**
 * Replace each component tag with a placeholder and drop {/* comments *\/}.
 * Returns the source unchanged when the note isn't marked as MDX.
 */
export function transformMdx(source: string, known: ReadonlySet<string>): string {
  if (!isMdx(source)) return source;
  const title = noteTitle(source);
  let tree: Node;
  try {
    tree = fromMarkdown(source, {
      extensions: [frontmatter(["yaml"]), math(), mdxjs()],
      mdastExtensions: [frontmatterFromMarkdown(["yaml"]), mathFromMarkdown(), mdxFromMarkdown()],
    }) as unknown as Node;
  } catch (error) {
    const err = error as { message?: string; line?: number; place?: { line?: number } };
    const line = err.line ?? err.place?.line;
    throw new Error(`MDX: ${title} isn't valid MDX${line ? ` at line ${line}` : ""}: ${err.message ?? error}`);
  }

  const edits: Array<{ start: number; end: number; text: string }> = [];
  const visit = (node: Node, depth: number) => {
    const line = node.position?.start.line;
    const fail = (why: string): never => {
      throw new Error(`MDX: ${title} line ${line}: ${why}.`);
    };
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    switch (node.type) {
      case "mdxjsEsm":
        fail("import and export aren't supported; register components in quartz-site/plugins/mdx instead");
        break;
      case "mdxFlowExpression":
      case "mdxTextExpression":
        if (!isComment(node)) {
          fail("{expressions} aren't supported; write a literal { as \\{ or put it in code");
        }
        edits.push({ start: start!, end: end!, text: "" });
        return;
      case "mdxJsxTextElement":
        fail(`<${node.name ?? ""}> must stand on its own lines; inline components aren't supported`);
        break;
      case "mdxJsxFlowElement": {
        if (depth !== 1) fail(`<${node.name ?? ""}> must be at the top level, not inside a list, quote or callout`);
        if (!node.name || !known.has(node.name)) {
          fail(`unknown component <${node.name ?? ""}>; known components: ${[...known].join(", ") || "none"}`);
        }
        if (node.children?.length) fail(`<${node.name}> takes no children; write it as <${node.name} />`);
        const encoded = Buffer.from(JSON.stringify(props(node, fail)), "utf8").toString("base64url");
        edits.push({
          start: start!,
          end: end!,
          text: `\n<div data-mdx-component="${node.name}" data-mdx-props="${encoded}"></div>\n`,
        });
        return;
      }
    }
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  visit(tree, 0);

  let out = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

export function decodeProps(encoded: string): Record<string, unknown> {
  return encoded ? JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) : {};
}
