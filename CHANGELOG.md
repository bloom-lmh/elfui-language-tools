# elfui-language-features

## 0.3.5

### Patch Changes

- b9929ca: Keep inline Fragment list wrappers compact during formatting and preserve existing attributes when completing an adjacent ElfUI directive or event.

## 0.3.4

### Patch Changes

- 2f63533: Suppress inline Fragment compiler temporaries and scoped callback false positives, settle nested
  Fragment formatting before applying edits, and insert generated template declarations next to
  their owning template.

## 0.3.3

### Patch Changes

- 11ec2c0: Exclude ElfUI `v-*` directives from component prop contract diagnostics while preserving
  `v-model` and `v-bind` prop validation.

## 0.3.2

### Patch Changes

- 8371cd4: Highlight quoted `v-for` expressions as TypeScript, expose declaration semantic tokens for loop
  locals, and infer array loop indexes as `number` for completion and hover.

## 0.3.1

### Patch Changes

- 2133fee: Fix named Fragment directive highlighting, keep multiline quoted binding formatting idempotent,
  and suppress native TypeScript unused diagnostics only for `defineFragment` values consumed by an
  ElfUI template tag.

## 0.3.0

### Minor Changes

- 862f2f6: Upgrade to `@elfui/compiler@0.1.0-beta.13` metadata schema v2 and add language support for named
  and inline Fragments, including typed props and scope completion, navigation, references, rename,
  structured diagnostics, grammar highlighting, formatting, and metadata JSON indexing.
