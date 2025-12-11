import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { network } from "hardhat";
import { zeroAddress, getAddress, stringToBytes, Address } from "viem";

// 定义 Connection 类型（Hardhat 3 的标准方式）
//Awaited作用是TypeScript 中的一个内置工具类型，用于提取 Promise 类型的内部值类型（把 Promise<T> 解包成 T），一般用于异步解包。
//ReturnType也是TypeScript 中的一个内置工具类型，用于获取某个函数的返回类型（不执行函数，只看类型）
//typeof是TypeScript中的一个关键字，用于把某个变量的变成一个类型（包括函数、类、接口等）
//  这里Awaited<ReturnType<typeof network.connect>>  这个意思就是定义一个network.connect的返回值类型，
//  因为network.connect是一个异步函数，所以返回值是一个Promise类型，
//  我们用Awaited<ReturnType<typeof network.connect>>  来提取Promise的内部值类型，
//  即定义一个Connection类型，它的属性和方法与network.connect的返回值类型相同。
type Connection = Awaited<ReturnType<typeof network.connect>>;

// 单独封装 NTF 部署函数，方便类型推导
async function deployNTFContract(viem: Connection["viem"]) {
  const name = "NTF";
  const symbol = "NTF";
  const baseURI = "ipfs://base/";
  const [ownerClient] = await viem.getWalletClients();
  const owner = ownerClient.account.address;

  // 部署合约
  // 第一个是合约名称
  // 第二个是合约构造函数的参数
  // 第三个是部署合约的配置项，这里指定了使用ownerClient作为交易发送者
  return viem.deployContract("NTF", [name, symbol, baseURI, owner],
    { client: { wallet: ownerClient } });
}


// 定义返回值类型
interface NtfContext {
  // 这是typeScript的索引访问类型，只要Connection是一个对象类型，就可以从中提取出某个字段的类型
  // 这里Connection["viem"]  就是提取出Connection对象的viem字段的类型，
  //  即定义一个Viem类型，它的属性和方法与Connection["viem"]的类型相同。
  viem: Connection["viem"];
  publicClient: Awaited<ReturnType<Connection["viem"]["getPublicClient"]>>;
  ownerClient: Awaited<ReturnType<Connection["viem"]["getWalletClients"]>>[0];
  otherClient: Awaited<ReturnType<Connection["viem"]["getWalletClients"]>>[1];
  ntf: Awaited<ReturnType<typeof deployNTFContract>>;
  name: string;
  symbol: string;
  baseURI: string;
  owner: Address;
}

// 定义部署 NTF 合约的 fixture  ,用于恢复合约快照
async function deployNTFFixture(connection: Connection): Promise<NtfContext> {
  // network.connect()连接网络，获取viem实例，参数可以指定网络名称，如"hardhat"、"localhost"等
  const { viem } = connection;
  const publicClient = await viem.getPublicClient(); //获取公共客户端，用于查询合约状态 模拟查询公链
  const [ownerClient, otherClient] = await viem.getWalletClients(); //获取钱包客户端，用于发送交易 模拟用户操作
  const name = "NTF";
  const symbol = "NTF";
  const baseURI = "ipfs://base/";
  const owner = ownerClient.account.address;
  const ntf = await deployNTFContract(viem);
  return { viem, publicClient, ownerClient, otherClient, ntf, name, symbol, baseURI, owner }

}


describe("NTF", async function () {
  let context: NtfContext;
  let ntf: Awaited<ReturnType<typeof deployNTFContract>>;
  let viem: Connection["viem"];

  beforeEach(async function () {
    const connection = await network.connect();
    context = await connection.networkHelpers.loadFixture(deployNTFFixture);
    ntf = context.ntf;
    viem = context.viem;

  })

  it("should deploy NTF contract", async function () {
    assert.ok(ntf.address);
    assert.equal(await ntf.read.name(), context.name);
    assert.equal(await ntf.read.symbol(), context.symbol);
    assert.equal(await ntf.read.baseTokenURI(), context.baseURI);

    // Viem在生成钱包地址的时候会自动使用 EIP-55 规范大小写，所以在测试用例比较的时候，只做逻辑等价比较，不关系大小写
    assert.equal((await ntf.read.owner()).toLowerCase(), context.owner.toLowerCase());
  })

  it("should mint NTF token", async function () {
    const tokenId = 1n;
    const to = context.otherClient.account.address;
    const tx = ntf.write.mint([to], { account: context.ownerClient.account });
    // 检查 Transfer 事件是否触发
    await viem.assertions.emitWithArgs(
      tx,
      ntf,
      "Transfer",
      [zeroAddress, getAddress(to), 1n],
    );

    assert.equal((await ntf.read.ownerOf([tokenId])).toLowerCase(), to.toLowerCase());
    assert.equal(await ntf.read.balanceOf([to]), 1n);
  })

  //测试非owner调用mint失败
  it("should not mint NTF token if not owner", async function () {
    const to = context.otherClient.account.address;
    await viem.assertions.revertWithCustomError(
      ntf.write.mint([to], { account: context.otherClient.account }),
      ntf,
      "OwnableUnauthorizedAccount"
    );
  })

  //测试owner调用setBaseURI失败
  it("should not setBaseURI if not owner", async function () {
    const newBaseURI = "ipfs://new/";
    await viem.assertions.revertWithCustomError(
      ntf.write.setBaseURI([newBaseURI], { account: context.otherClient.account }),
      ntf,
      "OwnableUnauthorizedAccount"
    );
  })

  //测试owner调用setBaseURI成功
  it("should setBaseURI if owner", async function () {
    const newBaseURI = "ipfs://new/";

    await ntf.write.setBaseURI([newBaseURI], { account: context.ownerClient.account });
    assert.equal(await ntf.read.baseTokenURI(), newBaseURI);
  })

  //测试tokenURI是否正确
  it("should tokenURI be correct", async function () {
    const tokenId = 1n;
    const to = context.otherClient.account.address;
    await ntf.write.mint([to], { account: context.ownerClient.account });
    assert.equal(await ntf.read.tokenURI([tokenId]), (await ntf.read.baseTokenURI()) + tokenId.toString() + ".json");
  })


});
