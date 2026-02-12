import type { BaseCodeOptions, BaseDiffOptions } from "@pierre/diffs/react";
import "./vercel-themes";

const unsafeCSS = `
  :host {
    display: block;
    max-width: 100%;
    --diffs-bg: var(--background);
    --diffs-fg: var(--foreground);
    --diffs-font-family: var(--font-geist-mono);
    --diffs-tab-size: 2;
    --diffs-gap-inline: 8px;
    --diffs-gap-block: 0px;
    --diffs-addition-color-override: #3dc96a;
    --diffs-deletion-color-override: #f04b78;
    --diffs-bg-addition-override: rgba(61, 201, 106, 0.12);
    --diffs-bg-deletion-override: rgba(240, 75, 120, 0.12);
  }
`;

const theme = {
  dark: "vercel-dark",
  light: "vercel-light",
} as const;

export const defaultDiffOptions = {
  theme,
  diffStyle: "unified",
  diffIndicators: "classic",
  overflow: "scroll",
  disableFileHeader: true,
  unsafeCSS,
} satisfies BaseDiffOptions;

export const splitDiffOptions = {
  ...defaultDiffOptions,
  diffStyle: "split",
} satisfies BaseDiffOptions;

export const defaultFileOptions = {
  theme,
  overflow: "scroll",
  disableFileHeader: true,
  unsafeCSS,
} satisfies BaseCodeOptions;
