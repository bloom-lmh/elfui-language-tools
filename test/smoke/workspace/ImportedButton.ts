import { defineEmits, defineHtml, defineProps, defineSlots } from "@elfui/core";

interface Props {
  label: string;
  open?: boolean;
}

defineProps<Props>();
defineEmits<{ submit: [] }>();
defineSlots<{ item: (scope: { row: { id: number; label: string } }) => unknown }>();

export const ImportedButton = defineHtml(`<button></button>`);
