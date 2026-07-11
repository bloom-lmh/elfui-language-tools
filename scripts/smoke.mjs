import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fork, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const requiredFiles = [
  packageJson.main,
  packageJson.icon,
  "README.md",
  "syntaxes/elfui-chain.tmLanguage.json",
  "dist/lsp-server.js",
  "dist/typescript-lib/lib.dom.d.ts",
  "dist/typescript-lib/lib.dom.iterable.d.ts",
  "dist/typescript-lib/lib.es2022.d.ts"
];

const missingFiles = requiredFiles
  .map((file) => resolve(root, file))
  .filter((file) => !existsSync(file));

if (missingFiles.length > 0) {
  console.error("ElfUI VS Code extension smoke check failed.");
  missingFiles.forEach((file) => console.error(`Missing: ${file}`));
  process.exit(1);
}

const grammar = packageJson.contributes?.grammars?.find(
  (item) => item.scopeName === "elfui.chain.injection"
);

if (!grammar) {
  console.error("ElfUI VS Code extension smoke check failed.");
  console.error("Missing ElfUI chain injection grammar contribution.");
  process.exit(1);
}

const serverPath = resolve(root, "dist/lsp-server.js");

await assertServerStartsWithStdio(serverPath);
await assertServerStartsWithIpc(serverPath);

console.log("ElfUI VS Code extension smoke check passed.");

function assertServerStartsWithStdio(serverPath) {
  return new Promise((resolvePromise, reject) => {
    const server = spawn(process.execPath, [serverPath, "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    let settled = false;

    const finish = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      globalThis.clearTimeout(timer);
      server.kill();

      if (error) {
        reject(error);
      } else {
        resolvePromise();
      }
    };
    const timer = setTimeout(() => finish(), 500);

    server.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    server.on("error", (error) => finish(error));
    server.on("exit", (code, signal) => {
      finish(
        new Error(
          `ElfUI language server exited during smoke check. code=${String(
            code
          )} signal=${String(signal)} stderr=${stderr.trim()}`
        )
      );
    });
  });
}

function assertServerStartsWithIpc(serverPath) {
  return new Promise((resolvePromise, reject) => {
    const server = fork(serverPath, ["--node-ipc"], {
      stdio: ["pipe", "pipe", "pipe", "ipc"]
    });
    let stderr = "";
    let settled = false;

    const finish = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      globalThis.clearTimeout(timer);
      server.kill();

      if (error) {
        reject(error);
      } else {
        resolvePromise();
      }
    };
    const timer = setTimeout(() => finish(), 500);

    server.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    server.on("error", (error) => finish(error));
    server.on("exit", (code, signal) => {
      finish(
        new Error(
          `ElfUI language server exited during IPC smoke check. code=${String(
            code
          )} signal=${String(signal)} stderr=${stderr.trim()}`
        )
      );
    });
  });
}
