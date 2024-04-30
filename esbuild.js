/* eslint node/no-unpublished-require: 0 */
/* eslint no-unused-vars: 0 */

import * as utils from "@switchboard-xyz/common/esm-utils";
import { execSync } from "child_process";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const buildFiles = ["tsconfig.tsbuildinfo"];

const outDir = path.join(__dirname, "lib");

async function main() {
  await Promise.all([
    fsPromises.rm(outDir, { recursive: true, force: true }),
    fsPromises.rm(path.join(__dirname, "lib-cjs"), {
      recursive: true,
      force: true,
    }),
    buildFiles.map((f) => fsPromises.rm(f, { force: true })),
  ]);

  fs.mkdirSync(outDir, { recursive: true });

  execSync(`pnpm exec tsc --removeComments --outDir lib`, {
    encoding: "utf-8",
  });

  execSync(
    `pnpm exec tsc --removeComments --outDir lib-cjs -p tsconfig.cjs.json`,
    {
      encoding: "utf-8",
    }
  );

  await utils
    .moveCjsFilesAsync("lib-cjs", "lib")
    .then(() => fsPromises.rm("lib-cjs", { recursive: true, force: true }));

  console.log(`Generating entrypoints ...`);
  utils.generateEntrypoints(__dirname, "lib", {
    index: "index",
  });
}

main().catch((error) => {
  console.error(error);
  throw error;
});
