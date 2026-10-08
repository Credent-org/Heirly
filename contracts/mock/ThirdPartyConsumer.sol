// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IHeirly.sol";

/**
 * @title ThirdPartyConsumer
 * @dev Sample external DApp / DAO contract demonstrating programmatic interaction with Heirly
 * via standard ERC-165 introspection and the IHeirly interface without hardcoded ABIs.
 */
contract ThirdPartyConsumer {
    IHeirly public immutable heirly;

    error HeirlyInterfaceNotSupported();
    error DocumentAccessDenied(uint8 status);

    constructor(address heirlyAddress) {
        require(heirlyAddress != address(0), "Invalid address");
        IHeirly vault = IHeirly(heirlyAddress);

        // ERC-165 check
        if (!vault.supportsInterface(type(IHeirly).interfaceId)) {
            revert HeirlyInterfaceNotSupported();
        }

        heirly = vault;
    }

    /**
     * @notice Check whether Heirly advertises IHeirly support via ERC-165.
     */
    function isHeirlySupported() external view returns (bool) {
        return heirly.supportsInterface(type(IHeirly).interfaceId);
    }

    /**
     * @notice Query document access status code for a given user.
     */
    function queryAccessStatus(uint256 documentId, address user) external view returns (uint8) {
        return heirly.checkAccess(documentId, user);
    }

    /**
     * @notice Execute an action conditional on valid document access.
     */
    function performAuthorizedAction(uint256 documentId, address user) external view returns (bool) {
        uint8 status = heirly.checkAccess(documentId, user);
        if (status != uint8(IHeirly.AccessCheckResult.GRANTED)) {
            revert DocumentAccessDenied(status);
        }
        return true;
    }
}
