import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import path from "path";
import { exec } from "child_process";

export default async function (
  _taskArgs: Record<string, unknown>,
  hre: HardhatRuntimeEnvironment
) {
  const scriptPath = path.resolve(process.cwd(), "gen-go-bindings.js");
  const artifactsPath = path.resolve(process.cwd(), "artifacts/contracts");
  const pkgName = "contracts";
  const cmd = `node "${scriptPath}" --path "${artifactsPath}" --pkg "${pkgName}"`;
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`❌ Error executing Go bindings script: ${error.message}`);
      return;
    }
    if (stderr) console.warn(`⚠️ Script stderr: ${stderr}`);
    console.log(stdout);
    console.log("✅ Go bindings generation completed.");
  });
}
