import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// 部署 TestERC20 和 TestMockV3Aggregator

export default buildModule("TestMockModule", (m) => {

    const erc20Name = m.getParameter("erc20Name", "TestERC20");
    const erc20Symbol = m.getParameter("erc20Symbol", "TEST");

    const decimals = m.getParameter("decimals", 8);
    const answer1 = m.getParameter("answer1", 10_000_000n);
    const answer2 = m.getParameter("answer2", 100_000_000n);

    const token = m.contract("TestERC20", [erc20Name, erc20Symbol], { id: "TestERC20" });
    const feeder1 = m.contract("TestMockV3Aggregator", [decimals, answer1], { id: "TestMockV3Aggregator" });
    const feeder2 = m.contract("TestMockV3Aggregator", [decimals, answer2], { id: "TestMockV3Aggregator2" });


    return { token, feeder1, feeder2 };
});