// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract NTF is ERC721, Ownable {
    using Strings for uint256;

    uint256 private _tokenIdCounter;

    string private _baseTokenURI; // IPFS baseURI

    address private admin;

    constructor(
        string memory name,
        string memory symbol,
        string memory baseTokenURI,
        address admin_
    ) ERC721(name, symbol) Ownable(admin_) {
        _baseTokenURI = baseTokenURI;
    }

    //铸币
    function mint(address to) public onlyOwner returns (uint256) {
        _tokenIdCounter += 1;
        uint256 newTokenId = _tokenIdCounter;
        _safeMint(to, newTokenId);
        return newTokenId;
    }

    /// @notice 设置 baseURI
    function setBaseURI(string calldata baseURI_) external onlyOwner {
        _baseTokenURI = baseURI_;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    /// @notice 返回自动拼接后的 tokenURI
    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        _requireOwned(tokenId);
        return
            string(
                abi.encodePacked(_baseTokenURI, tokenId.toString(), ".json")
            );
    }

    function baseTokenURI() public view returns (string memory) {
        return _baseTokenURI;
    }
}
