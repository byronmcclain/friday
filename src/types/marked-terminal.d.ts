declare module "marked-terminal" {
  import type { MarkedExtension } from "marked";

  interface MarkedTerminalOptions {
    firstHeading?: (text: string) => string;
    heading?: (text: string) => string;
    codespan?: (text: string) => string;
    code?: (text: string) => string;
    blockquote?: (text: string) => string;
    html?: (text: string) => string;
    hr?: (text: string) => string;
    listitem?: (text: string) => string;
    table?: (text: string) => string;
    paragraph?: (text: string) => string;
    strong?: (text: string) => string;
    em?: (text: string) => string;
    del?: (text: string) => string;
    link?: (text: string) => string;
    href?: (text: string) => string;
    text?: (text: string) => string;
    tab?: number;
    width?: number;
    unescape?: boolean;
    emoji?: boolean;
    showSectionPrefix?: boolean;
    reflowText?: boolean;
  }

  export function markedTerminal(
    options?: MarkedTerminalOptions,
    highlightOptions?: object,
  ): MarkedExtension;
}
