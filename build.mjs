import { build, context } from "esbuild";
import { rm } from "fs/promises";

const isWatch = process.argv.includes("--watch");

const common = {
  bundle: true,
  sourcemap: false,
  target: ["chrome114"],
  platform: "browser",
  logLevel: "info",
  outdir: "dist",
  tsconfig: "tsconfig.json",
  legalComments: "none",
  minify: false,
  treeShaking: true,
  splitting: false,
};

const builds = [
  {
    ...common,
    format: "iife",
    entryPoints: {
      "content-script/auth": "content-script/auth.ts",
      "content-script/worm-module": "content-script/worm-module.ts",
    },
  },
  {
    ...common,
    format: "esm",
    entryPoints: {
      "service-worker/background": "service-worker/background.ts",
      "popup-logic/popup": "popup-logic/popup.ts",
      "shared/auth": "shared/auth.ts",
      "shared/toggles": "shared/toggles.ts",
      "page-worms/page-worms": "page-worms/page-worms.ts",
    },
  },
];

async function run() {
  if (!isWatch) {
    await rm("dist", { recursive: true, force: true });
    await Promise.all(builds.map((options) => build(options)));
    return;
  }

  const contexts = await Promise.all(builds.map((options) => context(options)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("[esbuild] watching for changes...");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
