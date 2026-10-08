// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IHeirly.sol";

/**
 * @title HeirlyConsumer
 * @dev Reference third-party DApp integration contract that demonstrates how an
 *      external protocol can interact with Heirly purely through the
 *      standardized {IHeirly} interface.
 *
 *      It performs two things a real consumer needs:
 *      1. ERC-165 discovery — confirm a candidate address implements Heirly
 *         before issuing any cross-contract calls.
 *      2. Delegated access checks — query document access state for an arbitrary
 *         user without owning Heirly-specific ABI knowledge beyond {IHeirly}.
 *
 *      This contract is intentionally minimal and stateless; it only reads from
 *      the target vault and never mutates Heirly state.
 */
contract HeirlyConsumer {
    /// @notice The ERC-165 interface id of {IHeirly}, exposed for off-chain tooling.
    bytes4 public constant HEIRLY_INTERFACE_ID = type(IHeirly).interfaceId;

    /**
     * @notice ERC-165 discovery: returns true if `candidate` advertises support
     *         for the {IHeirly} interface.
     * @dev Uses a low-level `staticcall` so that probing an EOA or a contract
     *      that does not implement ERC-165 safely returns false instead of
     *      bubbling a revert to the caller.
     * @param candidate The address to probe.
     * @return bool True if `candidate` implements {IHeirly}.
     */
    function isHeirly(address candidate) external view returns (bool) {
        (bool ok, bytes memory data) = candidate.staticcall(
            abi.encodeWithSelector(
                IHeirly.supportsInterface.selector,
                type(IHeirly).interfaceId
            )
        );
        if (!ok || data.length < 32) {
            return false;
        }
        return abi.decode(data, (bool));
    }

    /**
     * @notice Performs a delegated access check against a Heirly deployment.
     * @param vault The Heirly contract address.
     * @param documentId The document whose access state is queried.
     * @param user The user whose access is checked.
     * @return code The {IHeirly-checkAccess} status code
     *         (0 = not found, 1 = denied, 2 = granted).
     */
    function delegatedAccessCheck(
        address vault,
        uint256 documentId,
        address user
    ) external view returns (uint8) {
        return IHeirly(vault).checkAccess(documentId, user);
    }

    /**
     * @notice Returns whether `user` is a guardian of `vaultId` in `vault`.
     * @param vault The Heirly contract address.
     * @param vaultId The vault identifier.
     * @param user The address being checked.
     * @return bool True if `user` is a guardian.
     */
    function isGuardianOf(
        address vault,
        uint256 vaultId,
        address user
    ) external view returns (bool) {
        return IHeirly(vault).isGuardian(vaultId, user);
    }

    /**
     * @notice Returns the creator of `vaultId` in `vault` (used by a consumer to
     *         resolve the accountable owner for access delegation flows).
     * @param vault The Heirly contract address.
     * @param vaultId The vault identifier.
     * @return creator The vault creator address.
     */
    function resolveVaultCreator(
        address vault,
        uint256 vaultId
    ) external view returns (address) {
        return IHeirly(vault).getVaultCreator(vaultId);
    }
}
