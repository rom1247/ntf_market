import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { network } from "hardhat";
import { zeroAddress, getAddress, encodeFunctionData, decodeEventLog, type Abi, type DecodeEventLogReturnType } from "viem";

type Connection = Awaited<ReturnType<typeof network.connect>>;


async function deployAuctionContract(viem: Connection["viem"]) {
    const publicClient = await viem.getPublicClient();
    const [ownerClient, bidderClient, otherClient] = await viem.getWalletClients();

    const feeManager = await viem.deployContract("FeeManagerLogic", [], { client: { wallet: ownerClient } });
    await feeManager.write.initialize([
        ownerClient.account.address,
        250n,
        otherClient.account.address,
    ], { account: ownerClient.account });

    const impl = await viem.deployContract("NTFAuctionLogic", [], { client: { wallet: ownerClient } });
    const initData = encodeFunctionData({
        abi: impl.abi,
        functionName: "initialize",
        args: [ownerClient.account.address, feeManager.address],
    });
    const proxy = await viem.deployContract("TestProxy", [impl.address, initData], { client: { wallet: ownerClient } });
    const auction = await viem.getContractAt("NTFAuctionLogic", proxy.address);

    const nft = await viem.deployContract("NTF", ["MockNFT", "MNFT", "ipfs://example/", ownerClient.account.address], { client: { wallet: ownerClient } });
    const token = await viem.deployContract("TestERC20", ["Mock", "MCK"], { client: { wallet: ownerClient } });
    const feeder1 = await viem.deployContract("TestMockV3Aggregator", [8, 10_000_000n], { client: { wallet: ownerClient } });
    const feeder2 = await viem.deployContract("TestMockV3Aggregator", [8, 20_000_000n], { client: { wallet: ownerClient } });
    await token.write.mint([bidderClient.account.address, 10_000_000_000_000_000n], { account: ownerClient.account });
    await token.write.mint([otherClient.account.address, 10_000_000_000_000_000n], { account: ownerClient.account });

    return { viem, publicClient, ownerClient, bidderClient, otherClient, auction, feeManager, nft, token, feeder1, feeder2 };
}


// 从交易日志中提取事件参数
async function getEventArgs({
    publicClient,
    txHash,
    abi,
    eventName,
}: {
    publicClient: any;
    txHash: `0x${string}`;
    abi: Abi;
    eventName: string;
}) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    for (const log of receipt.logs) {
        try {
            const decoded = decodeEventLog({
                abi,
                data: log.data,
                topics: log.topics,
            });

            if (decoded.eventName === eventName) {
                return decoded.args;
            }
        } catch (_) { }
    }

    throw new Error(`Event ${eventName} not found in tx ${txHash}`);
}


async function createAuction(ctx: AuctionContext, startTime: number, endTime: number) {
    const mintHash = await ctx.nft.write.mint([ctx.ownerClient.account.address], { account: ctx.ownerClient.account });

    const mintEventArgs = await getEventArgs({
        publicClient: ctx.publicClient,
        txHash: mintHash,
        abi: ctx.nft.abi,
        eventName: "Transfer",
    });

    const mintedId = (mintEventArgs as any).tokenId;
    console.log("mintedId", mintedId);
    await ctx.nft.write.approve([ctx.auction.address, mintedId], { account: ctx.ownerClient.account });

    const tx = ctx.auction.write.createAuction([
        "Auction1",
        ctx.nft.address,
        mintedId,
        1000n,
        zeroAddress,
        BigInt(startTime),
        BigInt(endTime),
        [zeroAddress, ctx.token.address],
        [ctx.feeder1.address, ctx.feeder2.address]

    ], { account: ctx.ownerClient.account });


    const createAuctionEventArgs = await getEventArgs({
        publicClient: ctx.publicClient,
        txHash: await tx,
        abi: ctx.auction.abi,
        eventName: "NewAuctionCreated",
    });
    const auctionId = (createAuctionEventArgs as any).id;

    console.log(auctionId);

    return { mintedId, tx, auctionId };
}

async function createSimpleAuction(ctx: AuctionContext) {
    const now = Number((await ctx.publicClient.getBlock()).timestamp);
    const startTime = now + 5;
    const endTime = now + 1000;
    const res = await createAuction(ctx, startTime, endTime);
    return { ...res, startTime, endTime };
}


interface AuctionContext {
    viem: Connection["viem"];
    publicClient: Awaited<ReturnType<Connection["viem"]["getPublicClient"]>>;
    ownerClient: Awaited<ReturnType<Connection["viem"]["getWalletClients"]>>[0];
    bidderClient: Awaited<ReturnType<Connection["viem"]["getWalletClients"]>>[1];
    otherClient: Awaited<ReturnType<Connection["viem"]["getWalletClients"]>>[2];
    auction: Awaited<ReturnType<typeof deployAuctionContract>>["auction"];
    feeManager: Awaited<ReturnType<typeof deployAuctionContract>>["feeManager"];
    nft: Awaited<ReturnType<typeof deployAuctionContract>>["nft"];
    token: Awaited<ReturnType<typeof deployAuctionContract>>["token"];
    feeder1: Awaited<ReturnType<typeof deployAuctionContract>>["feeder1"];
    feeder2: Awaited<ReturnType<typeof deployAuctionContract>>["feeder2"];
}

async function deployAuctionFixture(connection: Connection): Promise<AuctionContext> {
    const { viem } = connection;
    return await deployAuctionContract(viem);
}

async function mineNextBlock(ctx: AuctionContext) {
    await ctx.ownerClient.sendTransaction({ to: ctx.ownerClient.account.address, value: 0n });
}

// 快进链上时间
async function mineToTime(ctx: AuctionContext, time: number) {
    const now = Number((await ctx.publicClient.getBlock()).timestamp);
    const delta = time - now;
    if (delta > 0) {
        await ctx.publicClient.request({
            method: "evm_increaseTime" as any,
            params: [time] as any,
        });
    }
    await ctx.publicClient.request({
        method: "evm_mine" as any,
        params: [] as any,
    });
}

describe("NTFAuctionLogic", async function () {
    let context: AuctionContext;
    let viem: Connection["viem"];
    let auction: AuctionContext["auction"];
    let nft: AuctionContext["nft"];
    let token: AuctionContext["token"];

    beforeEach(async function () {
        const connection = await network.connect();
        context = await connection.networkHelpers.loadFixture(deployAuctionFixture);
        viem = context.viem;
        auction = context.auction;
        nft = context.nft;
        token = context.token;
    });

    it("should initialize", async function () {
        const owner = await auction.read.owner();
        assert.equal(owner.toLowerCase(), context.ownerClient.account.address.toLowerCase());
    });

    it("should createAuction and emit event", async function () {

        const now = Number((await context.publicClient.getBlock()).timestamp);
        const startTime = now + 5;
        const endTime = now + 1000;
        console.log("startTime", startTime);
        console.log("endTime", endTime);
        console.log("now", now);
        const { mintedId, tx, auctionId } = await createAuction(context, startTime, endTime);

        //检查NTF已转入拍卖合约
        const nftOwner = await nft.read.ownerOf([mintedId]);
        assert.equal(nftOwner.toLowerCase(), auction.address.toLowerCase());


        await viem.assertions.emitWithArgs(tx, auction,
            "NewAuctionCreated",
            [auctionId, getAddress(nft.address), mintedId,
                getAddress(context.ownerClient.account.address), 1000n,
                zeroAddress,
                BigInt(startTime), BigInt(endTime)]);
    });

    it("should bid with ERC20 and refund previous bidder", async function () {
        const { mintedId, tx, auctionId } = await createSimpleAuction(context);

        await mineNextBlock(context);
        await context.publicClient.waitForTransactionReceipt({ hash: await token.write.approve([auction.address, 2_000_000_000_000_000n], { account: context.bidderClient.account }) });

        const bid1 = auction.write.bid([auctionId, token.address, 2_000_000_000_000_000n], { account: context.bidderClient.account });
        await viem.assertions.emitWithArgs(bid1, auction, "NewBid", [auctionId, getAddress(context.bidderClient.account.address), getAddress(nft.address), mintedId, getAddress(token.address), 2_000_000_000_000_000n]);

        await context.publicClient.waitForTransactionReceipt({ hash: await token.write.approve([auction.address, 3_000_000_000_000_000n], { account: context.otherClient.account }) });
        const beforeRefund = await token.read.balanceOf([context.bidderClient.account.address]);
        const bid2Hash = await auction.write.bid([auctionId, token.address, 3_000_000_000_000_000n], { account: context.otherClient.account });
        await context.publicClient.waitForTransactionReceipt({ hash: bid2Hash });
        const afterRefund = await token.read.balanceOf([context.bidderClient.account.address]);
        assert.equal(afterRefund - beforeRefund, 2_000_000_000_000_000n);
    });

    it("should endAuction and transfer funds with fee", async function () {
        const { mintedId, tx, auctionId, endTime } = await createSimpleAuction(context);

        await mineNextBlock(context);
        const bidAmt = 2_000_000_000_000_000n;
        await context.publicClient.waitForTransactionReceipt({ hash: await auction.write.bid([auctionId, zeroAddress, bidAmt], { account: context.bidderClient.account, value: bidAmt }) });

        await mineToTime(context, endTime + 1);

        const feeMgrBefore = await context.publicClient.getBalance({ address: context.feeManager.address });

        const endTxHash = await auction.write.endAuction([auctionId], { account: context.ownerClient.account });
        await context.publicClient.waitForTransactionReceipt({ hash: endTxHash });

        const feeMgrAfter = await context.publicClient.getBalance({ address: context.feeManager.address });
        const expectedFee = await context.feeManager.read.calcFee([bidAmt]);
        assert.equal(feeMgrAfter - feeMgrBefore, expectedFee);
        const newOwner = await nft.read.ownerOf([mintedId]);
        assert.equal(newOwner.toLowerCase(), context.bidderClient.account.address.toLowerCase());
    });
});

