#!/usr/bin/env node
/**
 * Cross-platform script to generate Go bindings from Hardhat artifacts
 * Compatible with Windows, Linux, macOS
 *
 * Usage:
 *   node gen-go-bindings.js --path artifacts/contracts --pkg contracts
 */

import fs from "fs";
import path from "path";
import { exec } from "child_process";

// ----------------- 参数解析 -----------------
const args = process.argv.slice(2);
const getArg = (name, defaultValue) => {
  const index = args.findIndex((arg) => arg === name);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  return defaultValue;
};

const searchPath = getArg("--path", "artifacts/contracts");
const pkgName = getArg("--pkg", "contracts");

// ----------------- 工具检查 -----------------
const isAbigenAvailable = () => {
  try {
    exec("abigen --version", (err) => {
      if (err) throw err;
    });
    return true;
  } catch (err) {
    console.error("abigen not found in PATH. Please install it first.");
    process.exit(1);
  }
};
isAbigenAvailable();

// ----------------- 遍历 JSON 文件 -----------------
function walkDir(dir, callback) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(fullPath, callback);
    else if (entry.isFile() && entry.name.endsWith(".json")) callback(fullPath);
  });
}

walkDir(searchPath, (jsonFile) => {
  const dir = path.dirname(jsonFile);
  const contractName = path.basename(jsonFile, ".json");

  const abiFile = path.join(dir, `${contractName}.abi`);
  const binFile = path.join(dir, `${contractName}.bin`);
  const goFile = path.join(dir, `${contractName}.go`);

  // 读取 JSON
  const jsonContent = JSON.parse(fs.readFileSync(jsonFile, "utf8"));

  // 写入 ABI 和 BIN，覆盖旧文件
  fs.writeFileSync(abiFile, JSON.stringify(jsonContent.abi), "utf8");
  fs.writeFileSync(binFile, jsonContent.bytecode, "utf8");

  // 调用 abigen 生成 Go 文件
  const cmd = `abigen --abi="${abiFile}" --bin="${binFile}" --pkg=${pkgName} --out="${goFile}"`;

  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(
        `Error generating Go binding for ${contractName}: ${error.message}`
      );
      return;
    }
    if (stderr) console.warn(`⚠️ abigen stderr: ${stderr}`);
    console.log(`Generated: ${goFile}`);
  });
});
