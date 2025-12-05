// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./NTFAuctionUtils.sol";
import "./IFeeManager.sol";

contract NTFAuctionLogic is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using PriceConverter for address;
    using NTFAuctionUtils for address;

    //声明拍卖结构体，支持多个币种竞价
    struct Auction {
        uint256 id; // 拍卖id
        string name; // 拍卖名称
        address nftAddress; // nft地址
        uint256 tokenId; // nft tokenId
        address seller; // 卖家地址
        uint256 startingPrice; // 起始价格
        address startingPayToken; // 支付币种
        uint256 startTime; // 开始时间
        uint256 endTime; // 结束时间
        address highestBidder; // 最高出价者
        address payToken; // 支付币种
        uint256 highestBid; // 最高出价
        bool isEnded; // 是否结束
    }

    mapping(uint256 => Auction) public auctions; // 拍卖id到拍卖结构体的映射
    // 拍卖id到出价者到出价的映射  有个疑问? 这个数据有必要存在链上吗，还是通过事件记保存到链下
    mapping(uint256 => mapping(address => uint256)) public bids;

    uint256 public nextAuctionId; // 下一个拍卖id

    // 手续费管理合约地址
    IFeeManager private feeManager;

    //每个拍卖喂价地址映射
    mapping(uint256 => mapping(address => AggregatorV3Interface))
        public auctionFeeders;

    // 事件：新的拍卖创建
    event NewAuctionCreated(
        uint256 indexed id,
        address indexed nftAddress,
        uint256 tokenId,
        address indexed seller,
        uint256 startingPrice,
        address startingPayToken,
        uint256 startTime,
        uint256 endTime
    );

    // 事件：新的出价
    event NewBid(
        uint256 indexed id,
        address indexed bidder,
        address indexed nftAddress,
        uint256 tokenId,
        address payToken,
        uint256 bidAmount
    );
    // 事件：拍卖结束
    event AuctionEnded(
        uint256 indexed id,
        address indexed nftAddress,
        uint256 tokenId,
        address indexed winner,
        address payToken,
        uint256 sellerAmount
    );

    // 事件：ntf转移
    event NFTTransferred(
        uint256 indexed id,
        address indexed winner,
        address indexed nftAddress,
        uint256 tokenId
    );

    //事件：ETH转移给卖家
    event ETHTransferredToSeller(
        uint256 indexed id,
        address indexed seller,
        uint256 amount
    );

    // 初始化函数（代替构造函数）
    function initialize(
        address initialOwner,
        address feeManager_
    ) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        feeManager = IFeeManager(feeManager_);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    //初始化喂价合约
    function initializeFeeder(
        uint256 auctionId,
        address[] memory payTokens,
        address feeder
    ) internal {
        for (uint256 i = 0; i < payTokens.length; i++) {
            auctionFeeders[auctionId][payTokens[i]] = AggregatorV3Interface(
                feeder
            );
        }
    }

    /// @notice 创建一个新的拍卖
    /// @param _name 拍卖名称
    /// @param _ntfAddress nft地址
    /// @param _tokenId nft tokenId
    /// @param _startingPrice 起始价格
    /// @param _startTime 开始时间
    /// @param _endTime 结束时间
    /// @param _payTokens 支持的支付币种
    /// @param _feeder 喂价合约地址
    /// @return auctionId 拍卖id
    function createAuction(
        string memory _name,
        address _ntfAddress,
        uint256 _tokenId,
        uint256 _startingPrice,
        address _startingPayToken,
        uint256 _startTime,
        uint256 _endTime,
        address[] memory _payTokens,
        address _feeder
    ) external nonReentrant returns (uint256) {
        // nonReentrant 这个是防止重入攻击

        IERC721 nft = IERC721(_ntfAddress);
        address _seller = msg.sender;
        //检查ntf是否属于卖家
        require(nft.ownerOf(_tokenId) == _seller, "Not the seller of the NFT");

        //检查ntf是否被授权给拍卖合约
        require(
            nft.getApproved(_tokenId) == address(this),
            "Not approved for transfer"
        );
        // 卖家转入合约托管
        nft.safeTransferFrom(_seller, address(this), _tokenId);

        //检查拍卖开始时间是否在当前时间之后
        require(
            _startTime > block.timestamp,
            "Start time must be in the future"
        );

        //检查拍卖结束时间是否在当前时间之后
        require(_endTime > block.timestamp, "End time must be in the future");

        //检查拍卖结束时间是否在开始时间之后
        require(_endTime > _startTime, "End time must be after start time");

        //检查起始价格是否大于0
        require(_startingPrice > 0, "Starting price must be greater than 0");

        uint256 auctionId = nextAuctionId++;

        //初始化喂价合约
        initializeFeeder(auctionId, _payTokens, _feeder);

        //检查拍卖起始价格币种是否支持支付币种的喂价类型
        AggregatorV3Interface payTokenFeeder = auctionFeeders[auctionId][
            _startingPayToken
        ];
        require(
            address(payTokenFeeder) != address(0),
            "Pay token not supported"
        );

        auctions[auctionId] = Auction({
            id: auctionId,
            name: _name,
            nftAddress: _ntfAddress,
            tokenId: _tokenId,
            seller: _seller,
            startingPrice: _startingPrice,
            startingPayToken: _startingPayToken,
            startTime: _startTime,
            endTime: _endTime,
            highestBidder: address(0),
            payToken: address(0),
            highestBid: 0,
            isEnded: false
        });

        emit NewAuctionCreated(
            auctionId,
            _ntfAddress,
            _tokenId,
            _seller,
            _startingPrice,
            _startingPayToken,
            _startTime,
            _endTime
        );

        return auctionId;
    }

    /// @notice 为拍卖出价
    /// @param auctionId 拍卖id
    /// @param bidAmount 出价金额
    function bid(
        uint256 auctionId,
        address payToken,
        uint256 bidAmount
    ) external payable nonReentrant {
        Auction storage auction = auctions[auctionId];
        require(!auction.isEnded, "Auction already ended");
        require(block.timestamp >= auction.startTime, "Auction not started");
        require(block.timestamp <= auction.endTime, "Auction ended");
        require(bidAmount > 0, "Bid amount must be greater than 0");

        if (payToken.isNativeToken()) {
            //检查买家携带的eth是否和出价金额相等，防止作弊
            require(
                msg.value == bidAmount,
                "Native token bid amount must be equal to bid amount"
            );
        } else {
            //检查买家是否携带了eth 使用erc20代币支付时，不需要携带eth
            //这个检查是一个安全的措施，如果买家误传了eth，有可能导致eth留在在合约了
            require(msg.value == 0, "Pay token bid amount must be 0");

            //检查买家是否授权了足够的代币
            require(
                IERC20(payToken).allowance(msg.sender, address(this)) >=
                    bidAmount,
                "Pay token allowance must be greater than or equal to bid amount"
            );
        }

        //换算出价价格
        uint256 usdBidAmount = payToken.toUSD(
            bidAmount,
            auctionFeeders[auctionId][payToken]
        );
        //获取当前最高出价
        uint256 usdHighestBid = getCurrentUsdHighestBid(auctionId);

        require(usdBidAmount > usdHighestBid, "Bid amount must be higher");

        //出价成功，如果是 erc20那么先转入合约
        if (!payToken.isNativeToken()) {
            bool success = IERC20(payToken).transferFrom(
                msg.sender,
                address(this),
                bidAmount
            );
            require(success, "Pay token transfer failed");
        }

        //先退款 再更新最高出价
        //第一次出价不需要退款场景
        if (auction.highestBid > 0 && auction.highestBidder != address(0)) {
            if (auction.payToken.isNativeToken()) {
                //如果是eth 则退款给上一个最高出价人
                (bool success, ) = auction.highestBidder.call{
                    value: auction.highestBid
                }("");
                require(success, "ETH refund failed");
            } else {
                //如果是erc20 则退款给上一个最高出价人
                bool success = IERC20(auction.payToken).transfer(
                    auction.highestBidder,
                    auction.highestBid
                );
                require(success, "ERC20 refund failed");
            }
        }

        //更新最高出价
        auction.highestBidder = msg.sender;
        auction.highestBid = bidAmount;
        auction.payToken = payToken;
        emit NewBid(
            auctionId,
            msg.sender,
            auction.nftAddress,
            auction.tokenId,
            payToken,
            bidAmount
        );
    }

    //结束拍卖
    /// @notice 结束拍卖
    /// @param auctionId 拍卖id
    function endAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        require(!auction.isEnded, "Auction already ended");
        require(block.timestamp >= auction.endTime, "Auction not ended yet");

        auction.isEnded = true; //标记拍卖已结束

        address seller = auction.seller;
        address highestBidder = auction.highestBidder;
        address payToken = auction.payToken;
        uint256 highestBid = auction.highestBid;

        if (highestBidder != address(0)) {
            //如果有最高出价人，则将NTF转移给最高出价人
            IERC721(auction.nftAddress).safeTransferFrom(
                address(this),
                highestBidder,
                auction.tokenId
            );
        } else {
            //如果没有最高出价人，则将NTF转移给卖家
            IERC721(auction.nftAddress).safeTransferFrom(
                address(this),
                seller,
                auction.tokenId
            );
        }

        //如果有最高出价人，则将eth或erc20转移给卖家 ,并收取手续费
        if (highestBid > 0) {
            //计算手续费
            uint256 fee = feeManager.calcFee(highestBid);
            uint256 sellerAmount = highestBid - fee;
            feeManager.deductFee(
                address(this),
                auctionId,
                payToken,
                highestBid,
                fee
            );
            if (payToken.isNativeToken()) {
                //如果是eth 则直接转账
                (bool success, ) = seller.call{value: sellerAmount}("");
                require(success, "ETH transfer failed");
            } else {
                bool success = IERC20(payToken).transferFrom(
                    address(this),
                    seller,
                    sellerAmount
                );
                require(success, "ERC20 transfer failed");
            }
        }

        emit AuctionEnded(
            auctionId,
            auction.nftAddress,
            auction.tokenId,
            auction.highestBidder,
            auction.payToken,
            highestBid
        );
    }

    //获取当前拍卖的最高出价 换算后的价格
    function getCurrentUsdHighestBid(
        uint256 auctionId
    ) internal view returns (uint256) {
        Auction storage auction = auctions[auctionId];

        //如果当前没人出价，则是起始价格
        uint256 highestBid = auction.highestBid;
        address payToken = auction.payToken;
        if (highestBid == 0) {
            highestBid = auction.startingPrice;
            payToken = auction.startingPayToken;
        }

        //换算出价价格
        uint256 usdHighestBid = payToken.toUSD(
            highestBid,
            auctionFeeders[auctionId][payToken]
        );

        return usdHighestBid;
    }
}
