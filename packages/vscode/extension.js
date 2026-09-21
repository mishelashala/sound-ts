const vscode = require("vscode");
const { spawn } = require("node:child_process");
const path = require("node:path");

/**
 * Thin extension: dialect highlighting + optional CLI transform.
 * No custom TypeScript checker / language server in v0.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const cmd = vscode.commands.registerCommand(
    "superset-ts.transformFile",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("Open a .ts / .sts file first.");
        return;
      }
      const file = editor.document.uri.fsPath;
      const cliCandidates = [
        path.join(__dirname, "..", "cli", "dist", "cli.js"),
        "sts",
        "superset-ts",
      ];

      const out = await vscode.window.showInputBox({
        prompt: "Output path (-o). Leave empty for CLI default.",
        placeHolder: "e.g. ./out/file.ts",
      });

      const args = [file];
      if (out && out.trim()) {
        args.push("-o", out.trim());
      }

      const run = (command, commandArgs) =>
        new Promise((resolve) => {
          const child = spawn(command, commandArgs, {
            cwd: path.dirname(file),
            shell: true,
          });
          let stderr = "";
          let stdout = "";
          child.stdout.on("data", (d) => {
            stdout += d.toString();
          });
          child.stderr.on("data", (d) => {
            stderr += d.toString();
          });
          child.on("close", (code) => {
            resolve({ code, stdout, stderr });
          });
          child.on("error", (err) => {
            resolve({ code: 1, stdout, stderr: String(err) });
          });
        });

      let result = await run("node", [cliCandidates[0], ...args]);
      if (result.code !== 0) {
        result = await run("sts", args);
      }
      if (result.code !== 0) {
        result = await run("superset-ts", args);
      }

      if (result.code === 0) {
        vscode.window.showInformationMessage(
          result.stdout.trim() || "Transform complete.",
        );
      } else {
        vscode.window.showErrorMessage(
          `Transform failed. Build packages/cli first (pnpm build), then retry.\n${result.stderr || result.stdout}`,
        );
      }
    },
  );

  context.subscriptions.push(cmd);
}

function deactivate() {}

module.exports = { activate, deactivate };
