import { ElfUI } from "elfui";

const Demo = ElfUI.createComponent();
Demo.template(`<section>
<button>{{ count }}</button>
</section>`);
Demo.style(`:host{color:red;display:block;}`);
Demo.build();
