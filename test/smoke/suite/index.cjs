const Mocha = require("mocha");
const path = require("node:path");

exports.run = () =>
  new Promise((resolve, reject) => {
    const mocha = new Mocha({
      color: true,
      timeout: 120000,
      ui: "tdd"
    });

    mocha.addFile(path.resolve(__dirname, "extension.test.cjs"));
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} ElfUI VS Code smoke test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
