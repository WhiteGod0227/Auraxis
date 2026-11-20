// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Auraxis practice badges and proof-of-research anchors
/// @notice Deployed on a TEST network (Base Sepolia). Tokens have no value.
///
/// Badges: soulbound ERC-721 tokens (ERC-5192) for Auraxis practice
/// achievements. Only the Auraxis server (`operator`) can mint, and only to
/// wallets that users linked with Sign-In with Ethereum. Every transfer and
/// approval reverts, so badges can never be moved or sold.
///
/// Anchors: the operator publishes each proof-of-research Merkle root, so
/// anyone can look up when a root was recorded (`anchoredAt`, `Anchored`).
contract AuraxisBadges {
    string public constant name = "Auraxis Practice Badges";
    string public constant symbol = "AXB";
    uint8 public constant BADGE_COUNT = 5;

    address public immutable operator;

    uint256 public totalSupply;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => uint8) public badgeOf;
    /// holder => badge => tokenId (0 when not minted)
    mapping(address => mapping(uint8 => uint256)) public tokenOfBadge;
    /// Merkle root => block timestamp when anchored (0 when not anchored)
    mapping(bytes32 => uint256) public anchoredAt;
    mapping(bytes32 => uint256) public anchorBatch;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Locked(uint256 tokenId);
    event Anchored(bytes32 indexed root, uint256 indexed batchId, uint256 timestamp);

    error NotOperator();
    error Soulbound();
    error AlreadyMinted();
    error UnknownBadge();
    error NoToken();
    error AlreadyAnchored();
    error ZeroAddress();

    constructor(address operator_) {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    // ------------------------------------------------------------------ //
    // Operator actions
    // ------------------------------------------------------------------ //

    function mint(address to, uint8 badge) external onlyOperator returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        if (badge >= BADGE_COUNT) revert UnknownBadge();
        if (tokenOfBadge[to][badge] != 0) revert AlreadyMinted();
        tokenId = ++totalSupply;
        _owners[tokenId] = to;
        _balances[to] += 1;
        badgeOf[tokenId] = badge;
        tokenOfBadge[to][badge] = tokenId;
        emit Transfer(address(0), to, tokenId);
        emit Locked(tokenId);
    }

    function anchor(bytes32 root, uint256 batchId) external onlyOperator {
        if (anchoredAt[root] != 0) revert AlreadyAnchored();
        anchoredAt[root] = block.timestamp;
        anchorBatch[root] = batchId;
        emit Anchored(root, batchId, block.timestamp);
    }

    // ------------------------------------------------------------------ //
    // ERC-165 / ERC-721 views / ERC-5192
    // ------------------------------------------------------------------ //

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x80ac58cd // ERC-721
            || interfaceId == 0x5b5e139f // ERC-721 metadata
            || interfaceId == 0xb45a3c0e; // ERC-5192 (soulbound)
    }

    function balanceOf(address owner) external view returns (uint256) {
        if (owner == address(0)) revert ZeroAddress();
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _owners[tokenId];
        if (owner == address(0)) revert NoToken();
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return address(0);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function locked(uint256 tokenId) external view returns (bool) {
        ownerOf(tokenId);
        return true;
    }

    // ------------------------------------------------------------------ //
    // Transfers and approvals are disabled (soulbound)
    // ------------------------------------------------------------------ //

    function approve(address, uint256) external pure {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) external pure {
        revert Soulbound();
    }

    function transferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert Soulbound();
    }

    // ------------------------------------------------------------------ //
    // Metadata (fully on-chain)
    // ------------------------------------------------------------------ //

    function badgeName(uint8 badge) public pure returns (string memory) {
        if (badge == 0) return "First trade";
        if (badge == 1) return "Pair trader";
        if (badge == 2) return "Gap hunter";
        if (badge == 3) return "In the green";
        if (badge == 4) return "Regular";
        revert UnknownBadge();
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        string memory badge = badgeName(badgeOf[tokenId]);
        return string.concat(
            'data:application/json;utf8,{"name":"Auraxis badge: ',
            badge,
            '","description":"Soulbound Auraxis practice achievement on a test network. ',
            'No monetary value; cannot be transferred.",',
            '"attributes":[{"trait_type":"Badge","value":"',
            badge,
            '"}]}'
        );
    }
}
