export const supportedAttributeWrapping = [
  "prettier",
  "auto",
  "force",
  "force-aligned",
  "force-expand-multiline",
  "aligned-multiple",
  "preserve",
  "preserve-aligned"
] as const;

export type ElfAttributeWrapping = (typeof supportedAttributeWrapping)[number];

export const resolveAttributeWrapping = (
  configured: string | null | undefined,
  prettierSingleAttributePerLine: boolean
): ElfAttributeWrapping | undefined => {
  if (supportedAttributeWrapping.some((candidate) => candidate === configured)) {
    return configured as ElfAttributeWrapping;
  }

  return prettierSingleAttributePerLine ? "force-expand-multiline" : "prettier";
};
