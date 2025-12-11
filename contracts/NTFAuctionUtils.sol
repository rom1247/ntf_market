// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "hardhat/console.sol";

library NTFAuctionUtils {
    address public constant NATIVE_TOKEN = address(0);

    /// @notice 判断token是否是本地token
    /// @param token token地址
    /// @return isNativeToken 是否是本地token
    function isNativeToken(address token) internal pure returns (bool) {
        return token == NATIVE_TOKEN;
    }

    /// @notice 获取token的精度
    /// @param token token地址
    /// @return decimals token精度
    function getTokenDecimals(address token) internal view returns (uint8) {
        if (isNativeToken(token)) {
            return 18;
        }
        return IERC20Metadata(token).decimals();
    }
}

library PriceConverter {
    using NTFAuctionUtils for address;

    /// @notice 将token金额转换为USD金额
    /// @param token token地址
    /// @param amount token金额
    /// @param feed 喂价合约地址
    /// @param usdDecimals USD的精度
    /// @return usdAmount USD金额
    function toUSD(
        address token,
        uint256 amount,
        AggregatorV3Interface feed,
        uint8 usdDecimals
    ) internal view returns (uint256) {
        //检查是否支持token的喂价类型
        //AggregatorV3Interface是一个合约类型接口，如果存在，那么address(feed)就是一个合约地址,而不是0地址，0地址是不存在的时候的默认值
        require(
            address(feed) != address(0),
            "PriceConverter: Feed address is zero, price feed not supported"
        );

        (, int256 price, , , ) = feed.latestRoundData();

        require(price > 0, "PriceConverter: Price is zero, invalid price feed");
        uint256 feedDecimals = feed.decimals(); //喂价的精度
        uint256 tokenDecimals = token.getTokenDecimals(); //token的精度
        console.log("tokenDecimals", tokenDecimals);
        console.log("feedDecimals", feedDecimals);
        console.log("usdDecimals", usdDecimals);
        
        // 转换为相同精度的金额
        uint256 divisor = 10 ** (tokenDecimals + feedDecimals - usdDecimals);
        console.log("amount", amount);
        console.log("price", uint256(price));
        console.log("divisor", divisor);

        return (amount * uint256(price)) / divisor;
    }

    /// @notice 重载：默认返回 6 decimals 的 USD
    function toUSD(
        address token,
        uint256 amount,
        AggregatorV3Interface feed
    ) internal view returns (uint256) {
        return toUSD(token, amount, feed, 6);
    }
}
