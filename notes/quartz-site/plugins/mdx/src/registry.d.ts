// build.mjs generates this module from the directories in components/.
declare module "mdx:components" {
  export interface Component {
    /** The figure's full markup, rendered at build time. */
    render: (props: Record<string, unknown>) => string;
    /** The directory name; the page loads /static/mdx/<module>.js. */
    module: string;
  }
  export const components: Record<string, Component>;
}
