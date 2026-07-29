const fs = require("node:fs");
const path = require("node:path");

const tokenLengthError = "Token length and text length do not match!";
const extensionManifest = require("../../package.json");
const extensionId = `${extensionManifest.publisher}.${extensionManifest.name}`;
const forbiddenHostLogMessages = [
  tokenLengthError,
  `onWillSaveTextDocument-listener from extension '${extensionId}' threw ERROR`,
  "ElfUI deferred save formatting failed:",
  "ElfUI deferred save formatting could not apply embedded edits.",
  "ElfUI deferred save formatting could not save embedded edits."
];

exports.assertHostLogsClean = (cachePaths, startedAt) => {
  const logsRoots = (Array.isArray(cachePaths) ? cachePaths : [cachePaths]).map(
    (cachePath) => path.join(cachePath, "user-data", "logs")
  );
  const rendererLogs = logsRoots
    .flatMap(findRendererLogs)
    .filter((fileName) => fs.statSync(fileName).mtimeMs >= startedAt - 5000);

  if (rendererLogs.length === 0) {
    throw new Error(
      `Could not inspect a current VS Code renderer log under ${logsRoots.join(", ")}.`
    );
  }

  const hostLogs = logsRoots
    .flatMap(findHostLogs)
    .filter((fileName) => fs.statSync(fileName).mtimeMs >= startedAt - 5000);

  for (const fileName of hostLogs) {
    const content = fs.readFileSync(fileName, "utf8");
    const failedMessage = forbiddenHostLogMessages.find((message) => content.includes(message));

    if (failedMessage) {
      throw new Error(`${failedMessage} See ${fileName}`);
    }
  }
};

const findRendererLogs = (directory) => {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) return findRendererLogs(entryPath);
    return entry.isFile() && entry.name === "renderer.log" ? [entryPath] : [];
  });
};

const findHostLogs = (directory) => {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) return findHostLogs(entryPath);
    return entry.isFile() && entry.name.endsWith(".log") ? [entryPath] : [];
  });
};
