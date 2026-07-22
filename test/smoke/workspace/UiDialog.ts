import { defineEmits, defineHtml, defineModel, defineProps, defineSlots, useComponents } from "elfui";
import { DialogActionButton } from "./DialogActionButton";

interface DialogProps {
  title: string;
  disabled?: boolean;
}

defineProps<DialogProps>();
const open = defineModel("open");
const value = defineModel();
defineEmits<{ confirm: [] }>();
defineSlots<{
  footer: (scope: { action: { label: string; disabled: boolean } }) => unknown;
}>();
useComponents({ DialogAction: DialogActionButton });

export const UiDialog = defineHtml(`
  <article>
    <header>{{ title }}</header>
    <DialogAction>{{ value }}</DialogAction>
    <footer><slot name="footer"></slot></footer>
  </article>
`);
