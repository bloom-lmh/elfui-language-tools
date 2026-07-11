import { ElfUI, ref } from "elfui";

const LocalBadge = ElfUI.createComponent();

LocalBadge.props({
  tone: String
});

LocalBadge.template(`
  <span class="badge">{{ tone }}</span>
`);

const LocalBadgeElement = LocalBadge.build();

const DemoCard = ElfUI.createComponent();

DemoCard.props({
  title: String,
  disabled: Boolean
});

DemoCard.emits(["submit"]);
DemoCard.use({ LocalBadge: LocalBadgeElement });
DemoCard.formControl();

DemoCard.setup(() => {
  const count = ref(0);

  return {
    count,
    handleSubmit() {}
  };
});

DemoCard.template(`
  <article>
    <h2>{{ title }}</h2>
    <LocalBadge tone="info"></LocalBadge>
    <button :disabled="disabled" @click="emit('submit')">
      {{ count }}
    </button>
    <template #footer="{ action }">
      {{ action.label }}
    </template>
  </article>
`);

DemoCard.style(`
  :host {
    display: block;
    color: #2f6fed;
  }

  ::part(button) {
    border-color: var(--elfui-color-primary);
  }
`);

DemoCard.register("demo-card");
