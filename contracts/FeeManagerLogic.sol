// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./IFeeManager.sol";

contract FeeManagerLogic is
    IFeeManager,
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    /// @notice 手续费
    /// @dev 单位：BP（basis points），1% = 100
    uint256 public feeBp;

    /// @notice 手续费接收地址
    address public feeReceiver;

    event FeeBpUpdated(uint256 feeBp);
    event FeeReceiverUpdated(address feeReceiver);
    event FeeRecordUpdated(
        address auctionContract,
        uint256 auctionId,
        address payToken,
        uint256 amount,
        uint256 feeBp,
        uint256 fee,
        uint256 timestamp
    );

    // 初始化函数（代替构造函数）
    function initialize(
        address _initialOwner,
        uint256 _feeBp,
        address _feeReceiver
    ) public initializer {
        __Ownable_init(_initialOwner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        feeBp = _feeBp;
        feeReceiver = _feeReceiver;
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    function setFeeBp(uint256 _feeBp) external onlyOwner {
        feeBp = _feeBp;
        emit FeeBpUpdated(_feeBp);
    }

    function setFeeReceiver(address _feeReceiver) external onlyOwner {
        //不能设置合约自己
        require(
            _feeReceiver != address(this),
            "FeeManager: cannot set fee receiver to self"
        );
        feeReceiver = _feeReceiver;
        emit FeeReceiverUpdated(_feeReceiver);
    }

    /// @notice 计算手续费：fee = amount * feeBp / 10000
    function calcFee(uint256 amount) public view override returns (uint256) {
        return (amount * feeBp) / 10000;
    }

    //记录日志
    function recordFee(
        address auction,
        uint256 auctionId,
        address payToken,
        uint256 amount,
        uint256 fee
    ) external override nonReentrant {
        emit FeeRecordUpdated(
            auction,
            auctionId,
            payToken,
            amount,
            fee,
            feeBp,
            block.timestamp
        );
    }

    receive() external payable {}

    //提现手续费
    function withdrawFee(
        address payToken,
        uint256 amount
    ) public onlyOwner nonReentrant {
        if (payToken == address(0)) {
            // ETH
            uint256 fee = payToken.balance;

            require(fee > 0, "FeeManager: no  ETH fee to withdraw");
            require(
                fee >= amount,
                "FeeManager: amount must be less than or equal to ETH fee"
            );

            (bool success, ) = feeReceiver.call{value: amount}("");
            require(success, "FeeManager: ETH transfer failed");
        } else {
            IERC20 token = IERC20(payToken);
            uint256 fee = token.balanceOf(address(this));

            require(fee > 0, "FeeManager: no IERC20 fee to withdraw");
            require(
                fee >= amount,
                "FeeManager: amount must be less than or equal to IERC20 fee"
            );
            // 其他代币
            token.transfer(feeReceiver, amount);
        }
    }

    //提现全部
    function withdrawAllFee(address payToken) external onlyOwner nonReentrant {
        if (payToken == address(0)) {
            // ETH
            uint256 fee = payToken.balance;

            require(fee > 0, "FeeManager: no  ETH fee to withdraw");

            (bool success, ) = feeReceiver.call{value: fee}("");
            require(success, "FeeManager: ETH transfer failed");
        } else {
            IERC20 token = IERC20(payToken);
            uint256 fee = token.balanceOf(address(this));

            require(fee > 0, "FeeManager: no IERC20 fee to withdraw");
            // 其他代币
            token.transfer(feeReceiver, fee);
        }
    }
}
