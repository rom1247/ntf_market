import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { network } from "hardhat";
import { zeroAddress, Address, getAddress, encodeFunctionData } from "viem";

// 定义一个类型 Connection 来表示 Hardhat 网络连接
type Connection = Awaited<ReturnType<typeof network.connect>>;


// 部署 FeeManagerProxy 合约
async function deployFeeManagerProxy(viem: Connection["viem"]) {

    //获取两个钱包客户端，一个是合约部署者，一个是其他地址
    const [ownerClient, otherClient] = await viem.getWalletClients();
    const owner = ownerClient.account.address;
    const initialFeeBp = 250n;
    const initialReceiver = otherClient.account.address;

    //部署 FeeManagerLogic 合约
    const impl = await viem.deployContract("FeeManagerLogic", [], { client: { wallet: ownerClient } });


    //构造一个initialize数据，用于部署 FeeManagerProxy 合约
    const initData = encodeFunctionData({
        abi: impl.abi,
        functionName: "initialize",
        args: [owner, initialFeeBp, initialReceiver],
    });

    //部署 ERC1967Proxy 合约，并初始化 initialize 函数
    const proxy = await viem.deployContract("TestProxy", [impl.address, initData], { client: { wallet: ownerClient } });

    //获取 代理合约的一个 FeeManagerLogic 合约实例
    const feeManager = await viem.getContractAt("FeeManagerLogic", proxy.address);

    //部署 TestERC20 合约，用于测试
    const token = await viem.deployContract("TestERC20", ["Mock", "MCK"], { client: { wallet: ownerClient } });
    //给合约部署者铸造 1000 个代币  
    await token.write.mint([ownerClient.account.address, 1000n], { account: ownerClient.account });

    return { feeManager, impl, proxy, token, ownerClient, otherClient };
}

// 定义一个类型 FeeContext 来表示测试上下文
interface FeeContext {
    viem: Connection["viem"];
    publicClient: Awaited<ReturnType<Connection["viem"]["getPublicClient"]>>;
    ownerClient: Awaited<ReturnType<Connection["viem"]["getWalletClients"]>>[0];
    otherClient: Awaited<ReturnType<Connection["viem"]["getWalletClients"]>>[1];
    feeManager: Awaited<ReturnType<typeof deployFeeManagerProxy>>["feeManager"];
    proxy: Awaited<ReturnType<typeof deployFeeManagerProxy>>["proxy"];
    token: Awaited<ReturnType<typeof deployFeeManagerProxy>>["token"];
}

//定义一个 fixture 函数，以便重复测试可以恢复到一个快照状态
async function deployFeeFixture(connection: Connection): Promise<FeeContext> {
    const { viem } = connection;
    const publicClient = await viem.getPublicClient();
    const [ownerClient, otherClient] = await viem.getWalletClients();
    const { feeManager, proxy, token } = await deployFeeManagerProxy(viem);
    return { viem, publicClient, ownerClient, otherClient, feeManager, proxy, token };
}

//定义一个获取EIP-1967 Implementation Storage Slot 的值
async function getImplementation(publicClient: any, proxyAddress: string) {
    //固定槽 bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
    const slot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
    const raw = await publicClient.getStorageAt({ address: proxyAddress, slot });
    return `0x${raw.slice(-40)}`;
}

//开始测试 FeeManagerLogic 合约
describe("FeeManagerLogic", async function () {
    let context: FeeContext;
    let feeManager: FeeContext["feeManager"];
    let viem: Connection["viem"];
    let token: FeeContext["token"];


    beforeEach(async function () {
        const connection = await network.connect();
        context = await connection.networkHelpers.loadFixture(deployFeeFixture);
        feeManager = context.feeManager;
        viem = context.viem;
        token = context.token;
    });



    it("should initialize", async function () {
        assert.ok(feeManager.address);
        const feeBp = await feeManager.read.feeBp();
        const receiver = await feeManager.read.feeReceiver();
        const owner = await feeManager.read.owner();
        assert.equal(feeBp, 250n);
        assert.equal(receiver.toLowerCase(), context.otherClient.account.address.toLowerCase());
        assert.equal(owner.toLowerCase(), context.ownerClient.account.address.toLowerCase());
    });

    it("should not re-initialize", async function () {
        let threw = false;
        try {
            await feeManager.write.initialize([
                context.ownerClient.account.address,
                300n,
                context.otherClient.account.address,
            ], { account: context.ownerClient.account });
        } catch (e: any) {
            threw = true;
        }
        assert.equal(threw, true);
    });

    it("should setFeeBp by owner", async function () {
        const newBp = 500n;
        const tx = feeManager.write.setFeeBp([newBp], { account: context.ownerClient.account });
        await viem.assertions.emitWithArgs(tx, feeManager, "FeeBpUpdated", [newBp]);
        assert.equal(await feeManager.read.feeBp(), newBp);
    });

    it("should not setFeeBp if not owner", async function () {
        await viem.assertions.revertWithCustomError(
            feeManager.write.setFeeBp([300n], { account: context.otherClient.account }),
            feeManager,
            "OwnableUnauthorizedAccount"
        );
    });

    it("should setFeeReceiver by owner", async function () {
        const newReceiver = context.ownerClient.account.address;
        const tx = feeManager.write.setFeeReceiver([newReceiver], { account: context.ownerClient.account });
        await viem.assertions.emitWithArgs(tx, feeManager, "FeeReceiverUpdated", [getAddress(newReceiver)]);
        assert.equal((await feeManager.read.feeReceiver()).toLowerCase(), newReceiver.toLowerCase());
    });

    it("should not setFeeReceiver to self", async function () {
        let threw = false;
        try {
            await feeManager.write.setFeeReceiver([feeManager.address], { account: context.ownerClient.account });
        } catch (e: any) {
            threw = true;
            assert.match(String(e?.message ?? ""), /FeeManager: cannot set fee receiver to self/);
        }
        assert.equal(threw, true);
    });

    it("should calcFee", async function () {
        assert.equal(await feeManager.read.calcFee([10000n]), 250n);
        await feeManager.write.setFeeBp([1000n], { account: context.ownerClient.account });
        assert.equal(await feeManager.read.calcFee([10000n]), 1000n);
    });

    it("should recordFee and emit event", async function () {
        const auction = context.ownerClient.account.address;
        const auctionId = 1n;
        const payToken = zeroAddress;
        const amount = 1000n;
        const fee = await feeManager.read.calcFee([amount]);
        const tx = feeManager.write.recordFee([auction, auctionId, payToken, amount, fee], {
            account: context.ownerClient.account,
        });
        await viem.assertions.emit(tx, feeManager, "FeeRecordUpdated");
    });

    it("should withdrawFee only owner", async function () {
        await viem.assertions.revertWithCustomError(
            feeManager.write.withdrawFee([zeroAddress, 1n], { account: context.otherClient.account }),
            feeManager,
            "OwnableUnauthorizedAccount"
        );
    });

    it("should withdrawAllFee only owner", async function () {
        await viem.assertions.revertWithCustomError(
            feeManager.write.withdrawAllFee([zeroAddress], { account: context.otherClient.account }),
            feeManager,
            "OwnableUnauthorizedAccount"
        );
    });

    it("should fail withdraw ETH due to zero check", async function () {
        await feeManager.write.recordFee([
            context.ownerClient.account.address,
            2n,
            zeroAddress,
            500n,
            await feeManager.read.calcFee([500n]),
        ], { account: context.ownerClient.account });

        let threw = false;
        try {
            await feeManager.write.withdrawFee([zeroAddress, 1n], { account: context.ownerClient.account });
        } catch (e: any) {
            threw = true;
            assert.match(String(e?.message ?? ""), /FeeManager: no  ETH fee to withdraw/);
        }
        assert.equal(threw, true);
    });

    it("should withdrawFee ERC20 success", async function () {
        await token.write.transfer([feeManager.address, 1000n], { account: context.ownerClient.account });

        const beforeReceiver = await token.read.balanceOf([context.otherClient.account.address]);
        const beforeFeeMgr = await token.read.balanceOf([feeManager.address]);

        await feeManager.write.withdrawFee([token.address, 400n], { account: context.ownerClient.account });

        const afterReceiver = await token.read.balanceOf([context.otherClient.account.address]);
        const afterFeeMgr = await token.read.balanceOf([feeManager.address]);
        assert.equal(afterReceiver - beforeReceiver, 400n);
        assert.equal(beforeFeeMgr - afterFeeMgr, 400n);
    });

    it("should withdrawFee ERC20 revert when amount exceeds", async function () {
        await token.write.transfer([feeManager.address, 500n], { account: context.ownerClient.account });

        let threw = false;
        try {
            await feeManager.write.withdrawFee([token.address, 600n], { account: context.ownerClient.account });
        } catch (e: any) {
            threw = true;
            assert.match(String(e?.message ?? ""), /amount must be less than or equal to IERC20 fee/);
        }
        assert.equal(threw, true);
    });

    it("should withdrawAllFee ERC20 success", async function () {
        await token.write.transfer([feeManager.address, 700n], { account: context.ownerClient.account });

        const beforeReceiver = await token.read.balanceOf([context.otherClient.account.address]);
        const beforeFeeMgr = await token.read.balanceOf([feeManager.address]);

        await feeManager.write.withdrawAllFee([token.address], { account: context.ownerClient.account });

        const afterReceiver = await token.read.balanceOf([context.otherClient.account.address]);
        const afterFeeMgr = await token.read.balanceOf([feeManager.address]);
        assert.equal(afterReceiver - beforeReceiver, 700n);
        assert.equal(beforeFeeMgr - afterFeeMgr, 700n);
    });

    it("should withdrawAllFee ERC20 revert when no fee", async function () {
        let threw = false;
        try {
            await feeManager.write.withdrawAllFee([token.address], { account: context.ownerClient.account });
        } catch (e: any) {
            threw = true;
            assert.match(String(e?.message ?? ""), /no IERC20 fee to withdraw/);
        }
        assert.equal(threw, true);
    });


    it("should upgrade by owner and preserve storage", async function () {
        //重新部署逻辑合约
        const newImpl = await viem.deployContract("FeeManagerLogic", [], { client: { wallet: context.ownerClient } });

        //设置新的费率
        await feeManager.write.setFeeBp([333n], { account: context.ownerClient.account });
        const beforeBp = await feeManager.read.feeBp();

        //声明一个简单的 ABI 来调用 upgradeToAndCall 函数
        //ABI简单理解就是合约对外的接口协议
        const UUPS_ABI = [
            {
                //inputs 是函数的输入参数 type 是参数类型，是一个必填字段，name 是参数名，不影响编码，为了可读性 internalType也是内部声明编译器生成类型注释用途，不影响编码
                inputs: [
                    { internalType: "address", name: "newImplementation", type: "address" },
                    { internalType: "bytes", name: "data", type: "bytes" },
                ],
                name: "upgradeToAndCall",  //函数名
                outputs: [],   //输出参数，这里为空数组表示没有输出参数
                stateMutability: "payable",  //函数的可变性，这里是 payable 表示可以接收 ETH ，还有 nonpayable 表示不能接收 ETH
                type: "function",  //函数类型，这里是 function 表示是一个函数 还有 constructor 表示是一个构造函数 event 表示是一个事件
            },
        ] as const;  // 这里 as const 是为了告诉 TypeScript 这个数组和对象里的元素类型就是字面量类型，而不是普通的 string

        //调用 upgradeToAndCall 函数升级合约
        await context.ownerClient.writeContract({
            address: feeManager.address,
            abi: UUPS_ABI,
            functionName: "upgradeToAndCall",
            args: [newImpl.address, "0x"],
        });

        const afterBp = await feeManager.read.feeBp();
        const owner = await feeManager.read.owner();
        assert.equal(beforeBp, 333n);
        assert.equal(afterBp, 333n);
        assert.equal(owner.toLowerCase(), context.ownerClient.account.address.toLowerCase());
        //检查新的逻辑合约地址是否正确

        const implAddress = await getImplementation(context.publicClient, context.proxy.address);
        assert.equal(implAddress.toLowerCase(), newImpl.address.toLowerCase());
    });

    it("should not upgrade if not owner", async function () {
        const newImpl = await viem.deployContract("FeeManagerLogic", [], { client: { wallet: context.ownerClient } });
        const UUPS_ABI = [
            {
                inputs: [
                    { internalType: "address", name: "newImplementation", type: "address" },
                    { internalType: "bytes", name: "data", type: "bytes" },
                ],
                name: "upgradeToAndCall",
                outputs: [],
                stateMutability: "payable",
                type: "function",
            },
        ] as const;
        let threw = false;
        try {
            await context.otherClient.writeContract({
                address: feeManager.address,
                abi: UUPS_ABI,
                functionName: "upgradeToAndCall",
                args: [newImpl.address, "0x"],
            });
        } catch (e: any) {
            threw = true;
        }
        assert.equal(threw, true);
    });
});
