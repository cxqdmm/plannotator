/**
 * openCodePluginInstalled (packages/server/inbox-agents.ts): what counts as
 * "Plannotator's OpenCode plugin is installed" — our npm name in `plugin`
 * (OpenCode 1) or `plugins` (OpenCode 2), a local plugin folder or entry file
 * named by path (OpenCode 2 loads those in place) whose own package.json
 * names ours, and a loader file in the config's `plugins/` folder re-exporting
 * the package. Scratch home through tests/helpers/fake-agents.ts; the real
 * config is never read.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createFakeAgents, type FakeAgents } from "../../tests/helpers/fake-agents";
import { createAgentEnvironmentFor, openCodeGeneration, openCodePluginInstalled, type AgentEnvironment } from "./inbox-agents";

let fake: FakeAgents;
let env: AgentEnvironment;
/** The global config's folder (`$OPENCODE_CONFIG_DIR` of the scratch home). */
let configDir: string;

beforeEach(() => {
  fake = createFakeAgents();
  env = createAgentEnvironmentFor({ platform: "linux", homeDir: fake.home, env: fake.env });
  configDir = fake.env.OPENCODE_CONFIG_DIR!;
  mkdirSync(configDir, { recursive: true });
});
afterEach(() => {
  fake.remove();
});

const writeConfig = (config: unknown) => writeFileSync(join(configDir, "opencode.json"), JSON.stringify(config));

/** A plugin checkout fixture at `<under>/<name>/package.json`, as a plugin folder OpenCode could load. */
const checkout = (under: string, name: string, packageName = "@plannotator/opencode") => {
  const dir = join(under, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: packageName, version: "0.0.0" }));
  return dir;
};

describe("openCodePluginInstalled", () => {
  test("no config: not installed", () => {
    expect(openCodePluginInstalled(env)).toBe(false);
  });

  test("our npm name in plugins (OpenCode 2) and plugin (OpenCode 1)", () => {
    writeConfig({ plugins: ["@plannotator/opencode@latest"] });
    expect(openCodePluginInstalled(env)).toBe(true);
    writeConfig({ plugin: ["@plannotator/opencode"] });
    expect(openCodePluginInstalled(env)).toBe(true);
  });

  test("our npm name in a { package } entry, and someone else's name is not ours", () => {
    writeConfig({ plugins: [{ package: "@plannotator/opencode@0.28.66", options: { workflow: "plan-agent" } }] });
    expect(openCodePluginInstalled(env)).toBe(true);
    writeConfig({ plugins: ["oh-my-openagent"] });
    expect(openCodePluginInstalled(env)).toBe(false);
  });

  test("a local plugin folder by absolute path, string or { package }", () => {
    const dir = checkout(join(fake.root, "checkouts"), "plannotator-opencode");
    writeConfig({ plugins: [dir] });
    expect(openCodePluginInstalled(env)).toBe(true);
    writeConfig({ plugins: [{ package: dir }] });
    expect(openCodePluginInstalled(env)).toBe(true);
  });

  test("a local plugin folder by file:// URL, and by a bare file: prefix", () => {
    const dir = checkout(join(fake.root, "checkouts"), "plannotator-opencode");
    writeConfig({ plugins: [pathToFileURL(dir).href] });
    expect(openCodePluginInstalled(env)).toBe(true);
    writeConfig({ plugins: [`file:${dir}`] });
    expect(openCodePluginInstalled(env)).toBe(true);
  });

  test("an entry file inside the package (V1's tuple path, V2's dist/server.js), not just the folder", () => {
    const dir = checkout(join(fake.root, "checkouts"), "plannotator-opencode");
    writeConfig({ plugin: [[join(dir, "index.ts"), { workflow: "plan-agent" }]] });
    expect(openCodePluginInstalled(env)).toBe(true);
    writeConfig({ plugins: [join(dir, "dist", "server.js")] });
    expect(openCodePluginInstalled(env)).toBe(true);
  });

  test("a relative path resolves from the config file's folder, as OpenCode resolves it", () => {
    checkout(join(configDir, "checkouts"), "opencode-plugin");
    writeConfig({ plugins: ["./checkouts/opencode-plugin"] });
    expect(openCodePluginInstalled(env)).toBe(true);
  });

  test("a ~/ path resolves from the home folder", () => {
    checkout(fake.home, "opencode-plugin");
    writeConfig({ plugins: ["~/opencode-plugin"] });
    expect(openCodePluginInstalled(env)).toBe(true);
  });

  test("a path to another package, a missing folder, and an unreadable package.json are not ours", () => {
    const other = checkout(join(fake.root, "checkouts"), "oh-my-openagent", "oh-my-openagent");
    writeConfig({ plugins: [other] });
    expect(openCodePluginInstalled(env)).toBe(false);
    writeConfig({ plugins: [join(fake.root, "no-such-folder")] });
    expect(openCodePluginInstalled(env)).toBe(false);
    const broken = join(fake.root, "checkouts", "broken");
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, "package.json"), "{ not json");
    writeConfig({ plugins: [broken] });
    expect(openCodePluginInstalled(env)).toBe(false);
  });

  test("a loader file in the config's plugins/ folder that re-exports a local checkout counts, one for another package does not", () => {
    const dir = checkout(join(fake.root, "checkouts"), "plannotator-opencode");
    const pluginsDir = join(configDir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, "plannotator.ts"), `export { default } from "${join(dir, "server.ts")}";\nexport * from "${join(dir, "server.ts")}";\n`);
    expect(openCodePluginInstalled(env)).toBe(true);
    const other = checkout(join(fake.root, "checkouts"), "oh-my-openagent", "oh-my-openagent");
    writeFileSync(join(pluginsDir, "plannotator.ts"), `export { default } from "${join(other, "index.ts")}";\n`);
    expect(openCodePluginInstalled(env)).toBe(false);
  });

  test("a path entry in plugins still reads as OpenCode 2", () => {
    checkout(join(configDir, "checkouts"), "opencode-plugin");
    writeConfig({ plugin: ["oh-my-openagent"], plugins: ["./checkouts/opencode-plugin"] });
    expect(openCodeGeneration(env)).toBe("2");
    expect(openCodePluginInstalled(env)).toBe(true);
  });
});
