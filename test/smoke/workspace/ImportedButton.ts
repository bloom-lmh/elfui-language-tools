import { defineEmits, defineHtml, defineProps, defineSlots, html } from "elfui";

interface Props {
  label: string;
  open?: boolean;
}

defineProps<Props>();
defineEmits<{ submit: [] }>();
defineSlots<{ item: (scope: { row: { id: number; label: string } }) => unknown }>();

export const ImportedButton = defineHtml(html`<button></button>`);
