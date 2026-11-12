// Quartz transformer for .mdx notes.
//
// scripts/prepare_mdx.py renames each .mdx note to .md in the build's content
// copy and marks it `mdx: true`, because Quartz only reads .md files. This
// plugin then:
//   1. textTransform: swaps each component tag for a placeholder <div>, before
//      Obsidian-flavored Markdown sees the text;
//   2. a remark plugin: replaces each placeholder with the component's
//      build-time markup and the URL of its browser module;
//   3. a small loader script: imports a component's module only on pages that
//      contain that component, on first load and after SPA navigation.

import { visit } from "unist-util-visit";
import { components } from "./components";
import { decodeProps, PLACEHOLDER, transformMdx } from "./transform";

declare const __MDX_MODULE_VERSIONS__: Record<string, string>;

const known = new Set(Object.keys(components));

type MdNode = { type: string; value?: string; data?: Record<string, unknown>; children?: MdNode[] };

const moduleUrl = (name: string): string => `/static/mdx/${name}.js?v=${__MDX_MODULE_VERSIONS__[name]}`;

function remarkMdxComponents() {
  return (tree: MdNode) => {
    visit(tree as never, "html", (node: MdNode, index: number | undefined, parent: MdNode | undefined) => {
      const match = PLACEHOLDER.exec((node.value ?? "").trim());
      if (!match || !parent || index === undefined) return;
      const [, name, encoded] = match;
      const component = components[name];
      if (!component) throw new Error(`MDX: unknown component <${name}>`);
      const props = decodeProps(encoded);
      parent.children![index] = {
        type: "mdxComponent",
        data: {
          hName: "div",
          hProperties: { className: ["mdx-component"], dataMdxModule: moduleUrl(component.module) },
          // A raw node: the rehype-raw pass that Obsidian-flavored Markdown runs
          // parses it into elements before the page is rendered.
          hChildren: [{ type: "raw", value: component.render(props) }],
        },
      };
    });
  };
}

// Mounts each component once. Popovers show a static copy of the markup.
const loader = `(()=>{const mount=()=>{for(const el of document.querySelectorAll("[data-mdx-module]:not([data-mdx-ready])")){if(el.closest(".popover"))continue;el.dataset.mdxReady="1";import(el.dataset.mdxModule).then(m=>{const cleanup=m.mount(el);if(typeof cleanup==="function"&&window.addCleanup)window.addCleanup(cleanup)}).catch(e=>{console.error(e);delete el.dataset.mdxReady})}};document.addEventListener("nav",mount);mount()})()`;

export default () => ({
  name: "Mdx",
  textTransform(_ctx: unknown, src: string) {
    return transformMdx(src, known);
  },
  markdownPlugins() {
    return [remarkMdxComponents];
  },
  externalResources() {
    return {
      js: [{ loadTime: "afterDOMReady", contentType: "inline", script: loader }],
    };
  },
});
