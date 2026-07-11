export const basicChainFixture = `
  import { ElfUI, ref } from "elfui";
  import Icon from "./Icon";

  const Demo = ElfUI.createComponent().name("DemoButton");

  Demo.props({
    label: String,
    disabled: Boolean
  });

  Demo.emits(["click", "focus"]);
  Demo.use({ LocalIcon: Icon });
  Demo.formControl();

  Demo.setup(() => {
    const count = ref(0);
    return {
      count,
      handleClick() {}
    };
  });

  Demo.template(\`
    <button :disabled="disabled" @click="handleClick">
      <LocalIcon></LocalIcon>
      {{ label }} {{ count }}
    </button>
  \`);

  Demo.style(\`
    :host {
      display: inline-block;
    }
  \`);
`;
