import { defineHtml, defineModel, defineSlots, useComponents } from "@elfui/core";
import { DialogActionButton } from "./DialogActionButton";

const open = defineModel<boolean>("open");
const value = defineModel<string>();
const plain = defineModel();
defineSlots<{
  footer?: (scope: { action: { disabled: boolean; label: string } }) => unknown;
}>();
useComponents({ DialogAction: DialogActionButton });
useComponents({ ModalAlias: DialogActionButton });
export default defineHtml(`
  <ModalA
  <ModalAlias v-model:open="open">
    <input v-model="value">
    <template #footer="{ action }">{{ action.disabled }}</template>
  </ModalAlias>
`);
