// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFeeManager {
    // 计算手续费
    function calcFee(uint256 amount) external view returns (uint256);

    function recordFee(
        address auction,
        uint256 auctionId,
        address payToken,
        uint256 amount,
        uint256 fee
    ) external;
}
