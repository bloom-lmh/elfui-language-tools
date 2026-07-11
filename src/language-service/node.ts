import { createConnection, ProposedFeatures } from "vscode-languageserver/node";

import { startElfLanguageServer } from "./server";

startElfLanguageServer(createConnection(ProposedFeatures.all));
