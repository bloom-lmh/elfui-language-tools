"use strict";

const fs = require("node:fs");
const path = require("node:path");

const linkedDist = path.resolve(__dirname, "..", "dist", "typescript-plugin.js");
const packagedDist = path.resolve(__dirname, "..", "..", "dist", "typescript-plugin.js");

module.exports = require(fs.existsSync(linkedDist) ? linkedDist : packagedDist).default;
