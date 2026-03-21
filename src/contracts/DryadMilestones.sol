// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title DryadMilestones
 * @notice Records land management milestones onchain for the Dryad autonomous agent.
 * @dev Deployed on Base L2. Milestone types:
 *   0 = SiteAssessment
 *   1 = InvasiveRemoval
 *   2 = SoilPrep
 *   3 = NativePlanting
 *   4 = Monitoring
 */
contract DryadMilestones {
    struct Milestone {
        uint8 milestoneType;
        string parcel;
        string description;
        bytes32 dataHash;
        uint256 timestamp;
        address recorder;
    }

    address public owner;
    uint256 public milestoneCount;
    mapping(uint256 => Milestone) public milestones;

    event MilestoneRecorded(
        uint256 indexed id,
        uint8 milestoneType,
        string parcel,
        uint256 timestamp
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function recordMilestone(
        uint8 milestoneType,
        string calldata parcel,
        string calldata description,
        bytes32 dataHash
    ) external onlyOwner returns (uint256) {
        require(milestoneType <= 4, "Invalid milestone type");

        uint256 id = milestoneCount;
        milestones[id] = Milestone({
            milestoneType: milestoneType,
            parcel: parcel,
            description: description,
            dataHash: dataHash,
            timestamp: block.timestamp,
            recorder: msg.sender
        });

        milestoneCount = id + 1;

        emit MilestoneRecorded(id, milestoneType, parcel, block.timestamp);

        return id;
    }

    function getMilestone(uint256 id)
        external
        view
        returns (
            uint8 milestoneType,
            string memory parcel,
            string memory description,
            bytes32 dataHash,
            uint256 timestamp,
            address recorder
        )
    {
        require(id < milestoneCount, "Milestone does not exist");
        Milestone storage m = milestones[id];
        return (m.milestoneType, m.parcel, m.description, m.dataHash, m.timestamp, m.recorder);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }
}
