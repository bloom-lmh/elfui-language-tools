export const elfuiDemoFixture = `
  import { defineHtml, defineStyle, useRef } from "@elfui/core";
  import styles from "./App.scss?inline";

  defineStyle(styles);

  const theme = useRef("light");
  const toggleTheme = () => theme.set(theme.value === "light" ? "dark" : "light");

  export default defineHtml(\`
    <main class="app-shell">
      <header class="app-header">
        <a class="brand" href="#/">ElfUI</a>
        <nav class="app-nav" aria-label="Main navigation">
          <elf-link to="/">Home</elf-link>
          <elf-link to="/about">About</elf-link>
        </nav>
        <button type="button" @click=\${toggleTheme}>Toggle theme</button>
      </header>
      <elf-router-view></elf-router-view>
    </main>
  \`);
`;
