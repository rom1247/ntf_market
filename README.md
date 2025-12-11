# NTF Market — Hardhat 3 + Viem 项目

![Node Version](https://img.shields.io/badge/node-%3E%3D18-blue)
![Hardhat](https://img.shields.io/badge/Hardhat-3.x-yellow)
![License](https://img.shields.io/badge/license-MIT-green)

本项目是一个基于 Hardhat 3 的 NFT 拍卖与手续费管理示例，使用 `viem` 与原生 `node:test` 进行集成测试，并包含 Hardhat Ignition 部署模块。

**主要特性**

- 使用 Hardhat 3 配置与 `@nomicfoundation/hardhat-toolbox-viem`
- Solidity 合约：`NTF`、`NTFAuctionLogic`、`FeeManagerLogic` 等
- 原生 `node:test` + `viem` 的 TypeScript 集成测试（见 `test/*`）
- Ignition 部署模块：`NTFMarketModule`、`TestMockModule`
- 支持本地 L1/OP 模拟网络与 Sepolia 部署

## 目录结构

```text
contracts/                 Solidity 合约源码
  ├─ NTF.sol               ERC721 + 基于 baseURI 的元数据
  ├─ NTFAuctionLogic.sol   升级合约，支持多币种竞价与链上结算
  ├─ NTFAuctionUtils.sol   工具库：喂价转换、精度处理
  ├─ FeeManagerLogic.sol   升级合约：手续费计算与记录
  ├─ IFeeManager.sol       手续费接口
  ├─ TestERC20.sol         测试用 ERC20
  ├─ TestMockV3Aggregator.sol  测试用 Chainlink 喂价
  └─ TestProxy.sol         ERC1967Proxy 包装
ignition/modules/          Hardhat Ignition 部署模块
  ├─ NTFMarketModule.ts
  └─ TestMockModule.ts
ignition/parameters.json   部署参数示例
scripts/send-op-tx.ts      OP 模拟链路交易示例
test/NTF_test.ts           NTF 合约的 node:test 集成测试
test/FeeManagerLogic_test.ts  FeeManager 升级与手续费逻辑测试
test/NTFAuctionLogic_test.ts  拍卖流程与竞价逻辑测试
test/NTFAuctionLogic_iginition_test.ts  通过 Ignition 的部署集成测试
hardhat.config.ts          Hardhat 3 配置
package.json               项目脚本与依赖
tsconfig.json              TypeScript 编译配置
.gitignore                 常见忽略规则
```

## 环境要求

- Node.js ≥ 18
- NPM ≥ 9（本仓库使用 `npm`，已包含 `package-lock.json`）

## 安装与初始化

- 安装依赖：

```bash
npm install
```

- 编译合约与类型：

```bash
npx hardhat compile
```

## 常用命令

- 编译：

```bash
npx hardhat compile
```

- 运行全部测试：

```bash
npx hardhat test
```

- 仅运行 Solidity 测试：

```bash
npx hardhat test solidity
```

- 仅运行 node:test 集成测试：

```bash
npx hardhat test nodejs
```

- TypeScript 类型检查：

```bash
npm run typecheck
```

- 代码格式化（TS/Solidity/JSON/MD）：

```bash
npx prettier --write "**/*.{ts,sol,md,json}"
```

- Solidity 静态检查：

```bash
npx solhint "contracts/**/*.sol"
```

## 网络与部署

Hardhat 已配置以下网络（见 `hardhat.config.ts`）：

- `hardhatMainnet`：本地 L1 模拟（EDR simulated）
- `hardhatOp`：本地 OP 模拟（EDR simulated）
- `sepolia`：HTTP 远程网络（需环境变量）

环境变量（推荐使用系统环境变量方式）：

- `SEPOLIA_RPC_URL`：Sepolia RPC 访问地址
- `SEPOLIA_PRIVATE_KEY`：用于部署的账户私钥（请确保账户已有余额）

Ignition 部署示例（默认使用 `ignition/parameters.json` 参数）：

- 本地部署：

```bash
npx hardhat ignition deploy ignition/modules/NTFMarketModule.ts --parameters ignition/parameters.json
```

- 部署到 Sepolia：

```bash
npx hardhat ignition deploy --network sepolia ignition/modules/NTFMarketModule.ts --parameters ignition/parameters.json
```

## OP 模拟网络交易示例

使用 `scripts/send-op-tx.ts` 在本地 OP 模拟网络发送交易：

```bash
npx hardhat run scripts/send-op-tx.ts
```

## 测试说明

- TypeScript 集成测试位于 `test/*`，使用 `node:test` 与 `viem`

```bash
npx hardhat test
# 或仅运行 node:test 集成测试
npx hardhat test nodejs
```

## 项目目标与合约概览

- `NTF.sol`：基于 ERC721 的 NFT，实现 `baseURI` 拼接 `tokenURI`
- `NTFAuctionLogic.sol`：支持多币种竞价与喂价（Chainlink），结束后结算至卖家并记录手续费
- `FeeManagerLogic.sol`：按 BP 计算手续费、记录日志，支持提取手续费
- `NTFAuctionUtils/PriceConverter`：工具库，统一精度并将价格转换到 USD 维度

## 安全与规范

- 请勿泄露私钥，建议通过环境变量或安全的密钥管理工具注入
- 生产环境请审计合约与完整测试
- 使用 `solhint` 与 `prettier` 保持代码规范

## 贡献

- 提交 PR 前请运行：`npm run typecheck`、`npm test`、`npm run lint:sol`
- 遵循现有代码风格与目录组织

## 许可证

- 本项目采用 MIT 许可证。详见仓库根目录的 `LICENSE` 文件（如未提供请根据企业/个人需求添加）。

## 参考

- Hardhat 文档：https://hardhat.org/docs
- Viem 文档：https://viem.sh
