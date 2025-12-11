import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("NTFMarketModule", (m) => {
  const deployer = m.getAccount(0);

  //获取模块运行时参数
  const ntfName = m.getParameter("ntfName", "NTF");
  const ntfSymbol = m.getParameter("ntfSymbol", "NTF");
  const ntfBaseURI = m.getParameter("ntfBaseURI", "ipfs://base/");

  const feeBp = m.getParameter("feeBp", 300n);

  const ntf = m.contract("NTF", [ntfName, ntfSymbol, ntfBaseURI, deployer], { id: "NTF" });

  const feeManagerImpl = m.contract("FeeManagerLogic", [], { id: "FeeManagerImpl" });
  const feeManagerInitData = m.encodeFunctionCall(feeManagerImpl, "initialize", [deployer, feeBp, deployer]);
  const feeManagerProxy = m.contract("ERC1967Proxy", [feeManagerImpl, feeManagerInitData], { id: "FeeManagerProxy" });
  const feeManager = m.contractAt("FeeManagerLogic", feeManagerProxy, { id: "FeeManager" });


  const auctionImpl = m.contract("NTFAuctionLogic", [], { id: "AuctionImpl" });
  const auctionInitData = m.encodeFunctionCall(auctionImpl, "initialize", [deployer, feeManagerProxy]);
  const auctionProxy = m.contract("ERC1967Proxy", [auctionImpl, auctionInitData], { id: "AuctionProxy" });
  const auction = m.contractAt("NTFAuctionLogic", auctionProxy, { id: "Auction" });

  return {
    ntf,
    feeManagerImpl,
    feeManagerProxy,
    feeManager,
    auctionImpl,
    auctionProxy,
    auction,
  };
});
