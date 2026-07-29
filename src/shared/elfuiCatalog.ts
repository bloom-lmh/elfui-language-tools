export interface ElfApiCompletion {
  detail: string;
  insertText: string;
  label: string;
}

export type ElfTemplateDirective =
  | {
      label: string;
      placeholder: string;
      value: "expression";
    }
  | {
      label: string;
      value: "for";
    }
  | {
      label: string;
      value: "none";
    };

const api = (label: string, detail: string, insertText: string): ElfApiCompletion => ({
  detail,
  insertText,
  label
});

export const elfApiCompletions: readonly ElfApiCompletion[] = [
  api("defineHtml", "Define a macro component template", "defineHtml(`${1:<main>$0</main>}`)"),
  api("defineStyle", "Define component styles", "defineStyle(`${1::host { display: block; }}$0`)"),
  api("defineName", "Define the custom element name", 'defineName("${1:elf-component}")'),
  api("defineOptions", "Configure macro component options", "defineOptions({\n  ${1:shadow: true}\n})"),
  api("defineProps", "Declare component props", "defineProps<${1:Props}>()"),
  api("defineEmits", "Declare component events", "defineEmits<${1:Emits}>()"),
  api("defineModel", "Declare a two-way model", 'defineModel<${1:string}>("${2:modelValue}")'),
  api("defineSlots", "Declare typed slots", "defineSlots<${1:Slots}>()"),
  api("defineDirective", "Declare a local directive", "defineDirective({\n  mounted(${1:element}) {\n    $0\n  }\n})"),
  api("defineExpose", "Expose a public host API", "defineExpose({\n  $0\n})"),
  api("useComponents", "Register template components", "useComponents({ ${1:Component} })"),
  api("useExtend", "Create an extendable macro component", "useExtend(${1:BaseComponent})"),
  api("useVariant", "Create a macro component variant", "useVariant(${1:BaseComponent}, ${2:options})"),
  api("useRef", "Create reactive state", "useRef(${1:initialValue})"),
  api("useReactive", "Create a reactive object", "useReactive(${1:initialValue})"),
  api("useShallowRef", "Create shallow reactive state", "useShallowRef(${1:initialValue})"),
  api("useShallowReactive", "Create a shallow reactive object", "useShallowReactive(${1:initialValue})"),
  api("useComputed", "Create derived state", "useComputed(() => ${1:value})"),
  api("useEffect", "Run a reactive effect", "useEffect(() => {\n  $0\n})"),
  api("watch", "Watch reactive sources", "watch(${1:source}, (${2:value}) => {\n  $0\n})"),
  api("nextTick", "Wait for the next render flush", "nextTick(() => {\n  $0\n})"),
  api("effectScope", "Create an effect scope", "effectScope()"),
  api("onScopeDispose", "Register effect-scope cleanup", "onScopeDispose(() => {\n  $0\n})"),
  api("onWatcherCleanup", "Register watcher cleanup", "onWatcherCleanup(() => {\n  $0\n})"),
  api("batch", "Batch reactive updates", "batch(() => {\n  $0\n})"),
  api("useTemplateRef", "Create a typed template ref", 'useTemplateRef<${1:HTMLElement}>("${2:element}")'),
  api("useModel", "Access a component model", 'useModel<${1:string}>("${2:modelValue}")'),
  api("useScopedSlot", "Access a scoped slot", 'useScopedSlot<${1:unknown}>("${2:default}")'),
  api("useHost", "Access the component host", "useHost<${1:HTMLElement}>()"),
  api("useShadowRoot", "Access the component shadow root", "useShadowRoot()"),
  api("useRenderRoot", "Access the active render root", "useRenderRoot()"),
  api("useAttrs", "Access host attributes", "useAttrs()"),
  api("useAppConfig", "Access application configuration", "useAppConfig()"),
  api("useId", "Create a stable component ID", 'useId("${1:elf}")'),
  api("useEventListener", "Register a lifecycle-aware event listener", "useEventListener(${1:target}, \"${2:click}\", ${3:handler})"),
  api("useClickOutside", "Handle clicks outside an element", "useClickOutside(${1:target}, ${2:handler})"),
  api("useEscapeKey", "Handle the Escape key", "useEscapeKey(${1:handler})"),
  api("useFocusTrap", "Trap focus inside an element", "useFocusTrap(${1:target})"),
  api("useScrollLock", "Lock document scrolling reactively", "useScrollLock(() => ${1:locked})"),
  api("useResizeObserver", "Observe element size changes", "useResizeObserver(${1:target}, ${2:handler})"),
  api("useIntersectionObserver", "Observe element visibility", "useIntersectionObserver(${1:target}, ${2:handler})"),
  api("useHostAttr", "Bind a host attribute", 'useHostAttr("${1:name}", () => ${2:value})'),
  api("useHostClass", "Bind host classes", "useHostClass(() => ${1:classes})"),
  api("useHostCssVar", "Bind a host CSS variable", 'useHostCssVar("${1:name}", () => ${2:value})'),
  api("useHostFlag", "Bind a boolean host flag", 'useHostFlag("${1:name}", () => ${2:value})'),
  api("useHostStyle", "Bind a host style property", 'useHostStyle("${1:display}", () => ${2:value})'),
  api("createFormControlContext", "Create a form-control context", "createFormControlContext(${1:options})"),
  api("useFormControlContext", "Access the current form-control context", "useFormControlContext<${1:unknown}>()"),
  api("provide", "Provide an injected value", "provide(${1:key}, ${2:value})"),
  api("inject", "Read an injected value", "inject<${1:unknown}>(${2:key})"),
  api("createInjectionKey", "Create a typed injection key", 'createInjectionKey<${1:unknown}>("${2:key}")'),
  api("onBeforeMount", "Run before the component mounts", "onBeforeMount(() => {\n  $0\n})"),
  api("onMounted", "Run after the component mounts", "onMounted(() => {\n  $0\n})"),
  api("onBeforeUpdate", "Run before a component update", "onBeforeUpdate(() => {\n  $0\n})"),
  api("onUpdated", "Run after a component update", "onUpdated(() => {\n  $0\n})"),
  api("onBeforeUnmount", "Run before the component unmounts", "onBeforeUnmount(() => {\n  $0\n})"),
  api("onUnmounted", "Run after the component unmounts", "onUnmounted(() => {\n  $0\n})"),
  api("onAttributeChanged", "Handle observed host attribute changes", "onAttributeChanged((${1:name}, ${2:oldValue}, ${3:newValue}) => {\n  $0\n})"),
  api("onErrorCaptured", "Capture descendant component errors", "onErrorCaptured((${1:error}) => {\n  $0\n})"),
  api("onActivated", "Run when a kept-alive component activates", "onActivated(() => {\n  $0\n})"),
  api("onDeactivated", "Run when a kept-alive component deactivates", "onDeactivated(() => {\n  $0\n})"),
  api("createApp", "Mount an ElfUI application", 'createApp(${1:App}).mount("${2:#app}")')
];

export const elfTemplateDirectives: readonly ElfTemplateDirective[] = [
  { label: "v-if", placeholder: "condition", value: "expression" },
  { label: "v-for", value: "for" },
  { label: "v-model", placeholder: "value", value: "expression" },
  { label: "v-show", placeholder: "visible", value: "expression" },
  { label: "v-else-if", placeholder: "condition", value: "expression" },
  { label: "v-else", value: "none" },
  { label: "v-once", value: "none" },
  { label: "v-memo", placeholder: "[deps]", value: "expression" },
  { label: "v-text", placeholder: "value", value: "expression" },
  { label: "v-html", placeholder: "html", value: "expression" }
];

export const elfEventModifiers: readonly string[] = [".stop", ".prevent", ".capture", ".once", ".passive", ".self"];
export const elfModelModifiers: readonly string[] = [".trim", ".number", ".lazy"];
export const elfCommonDomEvents: readonly string[] = [
  "blur",
  "change",
  "click",
  "focus",
  "input",
  "keydown",
  "keyup",
  "mouseenter",
  "mouseleave",
  "mouseover",
  "submit"
];

export const elfBuiltInComponentCompletions = [
  {
    detail: "ElfUI built-in component",
    label: "Teleport",
    newText: 'Teleport to="${1:body}">$0</Teleport>'
  },
  {
    detail: "ElfUI built-in component",
    label: "Transition",
    newText: 'Transition name="${1:fade}">$0</Transition>'
  },
  {
    detail: "ElfUI built-in component",
    label: "TransitionGroup",
    newText: 'TransitionGroup name="${1:list}" tag="${2:div}">$0</TransitionGroup>'
  },
  {
    detail: "ElfUI built-in component",
    label: "KeepAlive",
    newText: "KeepAlive>$0</KeepAlive>"
  },
  {
    detail: "ElfUI built-in component",
    label: "Suspense",
    newText: "Suspense>$0</Suspense>"
  },
  {
    detail: "ElfUI dynamic component outlet",
    label: "component",
    newText: "component :is=${1:component}></component>"
  }
] as const;

export const elfBuiltInComponentTags = new Set<string>(
  elfBuiltInComponentCompletions
    .map((item) => item.label)
    .filter((label) => label !== "component")
);
