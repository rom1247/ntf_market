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
    struct FeeRecord {
        address auctionContract;
        uint256 auctionId;
        address payToken; // address(0) = ETH
        uint256 amount; // 实际手续费金额
        uint256 timestamp;
    }

    /// @notice 手续费
    /// @dev 单位：BP（basis points），1% = 100
    uint256 public feeBp;

    /// @notice 手续费接收地址
    address public feeReceiver;

    /// @notice 手续费总金额
    mapping(address => uint256) public feeTotal;

    //真实场景记录会保存在链上吗，还是在链下？
    /// @notice 手续费记录
    FeeRecord[] public feeRecords;

    event FeeBpUpdated(uint256 feeBp);
    event FeeReceiverUpdated(address feeReceiver);
    event FeeRecordUpdated(
        address auctionContract,
        uint256 auctionId,
        address payToken,
        uint256 amount,
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

    //扣除手续费
    function deductFee(
        address auction,
        uint256 auctionId,
        address payToken,
        uint256 amount,
        uint256 fee
    ) external payable override nonReentrant {
        require(amount > 0, "FeeManager: amount must be greater than 0");
        require(fee >= 0, "FeeManager: fee must be greater than or equal to 0");
        require(fee < amount, "FeeManager: fee must be less than to amount");

        //校验手续费是否一致
        uint256 _fee = calcFee(amount);
        require(_fee == fee, "FeeManager: fee not match");
        if (payToken == address(0)) {
            // ETH
            require(
                msg.value == fee,
                "FeeManager: msg.value must be equal to fee"
            );
        } else {
            // 其他代币
            IERC20(payToken).transferFrom(msg.sender, address(this), fee);
        }

        feeTotal[payToken] += fee;

        FeeRecord memory feeRecord = FeeRecord({
            auctionContract: auction,
            auctionId: auctionId,
            payToken: payToken,
            amount: fee,
            timestamp: block.timestamp
        });
        feeRecords.push(feeRecord);
        emit FeeRecordUpdated(
            auction,
            auctionId,
            payToken,
            fee,
            block.timestamp
        );
    }

    //提现手续费
    function withdrawFee(
        address payToken,
        uint256 amount
    ) public onlyOwner nonReentrant {
        uint256 fee = feeTotal[payToken];
        require(fee > 0, "FeeManager: no fee to withdraw");
        require(
            fee >= amount,
            "FeeManager: amount must be less than or equal to fee"
        );
        feeTotal[payToken] -= amount;
        if (payToken == address(0)) {
            // ETH
            (bool success, ) = feeReceiver.call{value: amount}("");
            require(success, "FeeManager: ETH transfer failed");
        } else {
            // 其他代币
            IERC20(payToken).transfer(feeReceiver, amount);
        }
    }

    //提现全部
    function withdrawAllFee(address payToken) external onlyOwner nonReentrant {
        withdrawFee(payToken, feeTotal[payToken]);
    }
}
