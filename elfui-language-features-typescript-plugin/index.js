"use strict";

const fs = require("node:fs");
const path = require("node:path");

const localDist = path.resolve(__dirname, "dist", "typescript-plugin.js");
const linkedDist = path.resolve(__dirname, "..", "dist", "typescript-plugin.js");
const packagedDist = path.resolve(__dirname, "..", "..", "dist", "typescript-plugin.js");

module.exports = require(
  fs.existsSync(localDist) ? localDist : fs.existsSync(linkedDist) ? linkedDist : packagedDist
).default;
