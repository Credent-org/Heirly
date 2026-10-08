const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployHeirly } = require("./helpers/deployHeirly.cjs");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Heirly Guardian Rotation & Threshold Adjustment (Multi-Stage Governance)", function () {
  let heirly;
  let owner;
  let guardian1;
  let guardian2;
  let guardian3;
  let beneficiary;
  let vaultId;

  beforeEach(async function () {
    [owner, guardian1, guardian2, guardian3, beneficiary] =
      await ethers.getSigners();

    heirly = await deployHeirly();

    // Create a vault with 4 guardians total (owner + 3 external), threshold = 3
    const guardians = [guardian1.address, guardian2.address, guardian3.address];
    const tx = await heirly
      .connect(owner)
      .createVault(
        "Guardian Rotation Test Vault",
        "Multi-sig vault for testing guardian rotation",
        guardians,
        3
      );
    await tx.wait();
    vaultId = 1;

    // Accept guardian invites
    await heirly.connect(guardian1).acceptGuardianInvite(vaultId);
    await heirly.connect(guardian2).acceptGuardianInvite(vaultId);
    await heirly.connect(guardian3).acceptGuardianInvite(vaultId);
  });

  describe("Proposal Creation", function () {
    it("should allow a guardian to propose removal of another guardian", async function () {
      const tx = heirly
        .connect(owner)
        .proposeGuardianRemoval(vaultId, guardian1.address);
      await expect(tx)
        .to.emit(heirly, "GuardianRemovalProposed")
        .withArgs(vaultId, guardian1.address, owner.address);
    });

    it("should revert if non-guardian tries to propose removal", async function () {
      await expect(
        heirly
          .connect(beneficiary)
          .proposeGuardianRemoval(vaultId, guardian1.address)
      ).to.be.revertedWithCustomError(heirly, "OnlyGuardian");
    });

    it("should revert if trying to remove non-existent guardian", async function () {
      await expect(
        heirly
          .connect(owner)
          .proposeGuardianRemoval(vaultId, beneficiary.address)
      ).to.be.revertedWithCustomError(heirly, "GuardianNotExists");
    });

    it("should allow a guardian to propose threshold update", async function () {
      const newThreshold = 2;
      const tx = heirly
        .connect(owner)
        .proposeThresholdUpdate(vaultId, newThreshold);

      await expect(tx)
        .to.emit(heirly, "ThresholdUpdateProposed")
        .withArgs(vaultId, newThreshold, owner.address);
    });

    it("should revert if new threshold is zero", async function () {
      await expect(
        heirly.connect(owner).proposeThresholdUpdate(vaultId, 0)
      ).to.be.revertedWithCustomError(heirly, "InvalidNewThreshold");
    });

    it("should revert if new threshold exceeds guardian count", async function () {
      await expect(
        heirly.connect(owner).proposeThresholdUpdate(vaultId, 5)
      ).to.be.revertedWithCustomError(heirly, "InvalidNewThreshold");
    });
  });

  describe("Voting & Approvals", function () {
    it("should allow guardians to approve removal", async function () {
      await heirly
        .connect(owner)
        .proposeGuardianRemoval(vaultId, guardian1.address);

      const tx = heirly
        .connect(guardian2)
        .approveGuardianRemoval(vaultId, guardian1.address);

      await expect(tx)
        .to.emit(heirly, "GuardianRemovalApproved")
        .withArgs(vaultId, guardian1.address, guardian2.address);
    });

    it("should revert if trying to approve removal twice", async function () {
      await heirly
        .connect(owner)
        .proposeGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian2)
        .approveGuardianRemoval(vaultId, guardian1.address);

      await expect(
        heirly
          .connect(guardian2)
          .approveGuardianRemoval(vaultId, guardian1.address)
      ).to.be.revertedWithCustomError(heirly, "ApprovalAlreadyGiven");
    });

    it("should revert if approval is after proposal expiration", async function () {
      await heirly
        .connect(owner)
        .proposeGuardianRemoval(vaultId, guardian1.address);

      // Fast forward time by 8 days (past 7-day expiration)
      await time.increase(8 * 24 * 60 * 60);

      await expect(
        heirly
          .connect(guardian2)
          .approveGuardianRemoval(vaultId, guardian1.address)
      ).to.be.revertedWithCustomError(heirly, "ProposalExpired");
    });

    it("should allow guardians to approve threshold update", async function () {
      const newThreshold = 2;
      await heirly
        .connect(owner)
        .proposeThresholdUpdate(vaultId, newThreshold);

      const tx = heirly
        .connect(guardian2)
        .approveThresholdUpdate(vaultId, newThreshold);

      await expect(tx)
        .to.emit(heirly, "ThresholdUpdateApproved")
        .withArgs(vaultId, newThreshold, guardian2.address);
    });
  });

  describe("Timelock Queueing & Quorum Check", function () {
    it("should revert queueing if approvals do not meet ceil(K/2)+1 quorum", async function () {
      // 4 guardians: ceil(4/2) + 1 = 3 approvals required
      await heirly
        .connect(owner)
        .proposeGuardianRemoval(vaultId, guardian1.address);

      // Only 2 approvals (owner + guardian2)
      await heirly
        .connect(owner)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian2)
        .approveGuardianRemoval(vaultId, guardian1.address);

      // Try to queue with only 2 approvals -> should revert
      await expect(
        heirly
          .connect(owner)
          .queueVaultReconfiguration(vaultId, guardian1.address, 0)
      ).to.be.revertedWithCustomError(
        heirly,
        "InsufficientApprovalsForExecution"
      );
    });

    it("should allow queueing once ceil(K/2)+1 quorum approvals are met", async function () {
      await heirly
        .connect(owner)
        .proposeGuardianRemoval(vaultId, guardian1.address);

      // Get 3 approvals out of 4 (ceil(4/2)+1 = 3)
      await heirly
        .connect(owner)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian2)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian3)
        .approveGuardianRemoval(vaultId, guardian1.address);

      // Queue reconfiguration
      const tx = heirly
        .connect(owner)
        .queueVaultReconfiguration(vaultId, guardian1.address, 0);

      await expect(tx).to.emit(heirly, "VaultReconfigurationQueued");
    });

    it("should revert if non-guardian attempts to queue reconfiguration", async function () {
      await heirly
        .connect(owner)
        .proposeGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(owner)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian2)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian3)
        .approveGuardianRemoval(vaultId, guardian1.address);

      await expect(
        heirly
          .connect(beneficiary)
          .queueVaultReconfiguration(vaultId, guardian1.address, 0)
      ).to.be.revertedWithCustomError(heirly, "OnlyGuardian");
    });

    it("should revert if queueing already-queued proposal", async function () {
      await heirly
        .connect(owner)
        .proposeGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(owner)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian2)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian3)
        .approveGuardianRemoval(vaultId, guardian1.address);

      await heirly
        .connect(owner)
        .queueVaultReconfiguration(vaultId, guardian1.address, 0);

      await expect(
        heirly
          .connect(owner)
          .queueVaultReconfiguration(vaultId, guardian1.address, 0)
      ).to.be.revertedWithCustomError(heirly, "ProposalAlreadyQueued");
    });
  });

  describe("Timelock Delay & Execution", function () {
    it("should revert execution if proposal was never queued", async function () {
      await heirly
        .connect(owner)
        .proposeGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(owner)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian2)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian3)
        .approveGuardianRemoval(vaultId, guardian1.address);

      // Attempt to execute directly without queueing
      await expect(
        heirly
          .connect(owner)
          .executeVaultReconfiguration(vaultId, guardian1.address, 3)
      ).to.be.revertedWithCustomError(heirly, "ProposalNotQueued");
    });

    it("should revert execution if 24-hour timelock has not elapsed", async function () {
      await heirly
        .connect(owner)
        .proposeGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(owner)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian2)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian3)
        .approveGuardianRemoval(vaultId, guardian1.address);

      await heirly
        .connect(owner)
        .queueVaultReconfiguration(vaultId, guardian1.address, 0);

      // Fast forward 12 hours (less than 24 hours)
      await time.increase(12 * 60 * 60);

      await expect(
        heirly
          .connect(owner)
          .executeVaultReconfiguration(vaultId, guardian1.address, 3)
      ).to.be.revertedWithCustomError(heirly, "TimelockNotElapsed");
    });

    it("should execute guardian removal after 24-hour timelock delay has elapsed", async function () {
      await heirly
        .connect(owner)
        .proposeGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(owner)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian2)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian3)
        .approveGuardianRemoval(vaultId, guardian1.address);

      await heirly
        .connect(owner)
        .queueVaultReconfiguration(vaultId, guardian1.address, 0);

      // Fast forward 24 hours
      await time.increase(24 * 60 * 60);

      const tx = heirly
        .connect(owner)
        .executeVaultReconfiguration(vaultId, guardian1.address, 3);

      await expect(tx)
        .to.emit(heirly, "VaultReconfigurationExecuted")
        .to.emit(heirly, "GuardianRemoved")
        .withArgs(vaultId, guardian1.address);

      expect(await heirly.isGuardian(vaultId, guardian1.address)).to.equal(
        false
      );
    });

    it("should execute threshold update after 24-hour timelock delay has elapsed", async function () {
      const newThreshold = 2;
      await heirly
        .connect(owner)
        .proposeThresholdUpdate(vaultId, newThreshold);
      await heirly
        .connect(owner)
        .approveThresholdUpdate(vaultId, newThreshold);
      await heirly
        .connect(guardian2)
        .approveThresholdUpdate(vaultId, newThreshold);
      await heirly
        .connect(guardian3)
        .approveThresholdUpdate(vaultId, newThreshold);

      await heirly
        .connect(owner)
        .queueVaultReconfiguration(vaultId, ethers.ZeroAddress, newThreshold);

      // Fast forward 24 hours
      await time.increase(24 * 60 * 60);

      const tx = heirly
        .connect(owner)
        .executeVaultReconfiguration(
          vaultId,
          ethers.ZeroAddress,
          newThreshold
        );

      await expect(tx).to.emit(heirly, "VaultReconfigurationExecuted");

      const vault = await heirly.vaults(vaultId);
      expect(vault.approvalThreshold).to.equal(newThreshold);
    });
  });

  describe("Emergency Cancel / Veto by Vault Creator", function () {
    it("should allow vault creator to veto malicious reconfiguration proposal during timelock", async function () {
      await heirly
        .connect(guardian1)
        .proposeGuardianRemoval(vaultId, owner.address);
      await heirly
        .connect(guardian1)
        .approveGuardianRemoval(vaultId, owner.address);
      await heirly
        .connect(guardian2)
        .approveGuardianRemoval(vaultId, owner.address);
      await heirly
        .connect(guardian3)
        .approveGuardianRemoval(vaultId, owner.address);

      await heirly
        .connect(guardian1)
        .queueVaultReconfiguration(vaultId, owner.address, 0);

      // Creator vetoes during timelock
      const tx = heirly
        .connect(owner)
        .cancelVaultReconfiguration(vaultId, owner.address, 0);

      await expect(tx)
        .to.emit(heirly, "VaultReconfigurationCanceled")
        .withArgs(vaultId, owner.address, 0, owner.address);

      // Fast forward past timelock
      await time.increase(24 * 60 * 60);

      // Execution attempt must revert
      await expect(
        heirly
          .connect(guardian1)
          .executeVaultReconfiguration(vaultId, owner.address, 3)
      ).to.be.revertedWithCustomError(heirly, "ProposalVetoed");
    });

    it("should revert if non-creator attempts to cancel/veto proposal", async function () {
      await heirly
        .connect(owner)
        .proposeGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(owner)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian2)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian3)
        .approveGuardianRemoval(vaultId, guardian1.address);

      await heirly
        .connect(owner)
        .queueVaultReconfiguration(vaultId, guardian1.address, 0);

      await expect(
        heirly
          .connect(guardian1)
          .cancelVaultReconfiguration(vaultId, guardian1.address, 0)
      ).to.be.revertedWithCustomError(heirly, "OnlyVaultCreator");
    });
  });

  describe("Atomic Reconfiguration", function () {
    it("should execute both removal and threshold update atomically through timelock", async function () {
      const newThreshold = 2;

      // Propose both changes
      await heirly
        .connect(owner)
        .proposeGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(owner)
        .proposeThresholdUpdate(vaultId, newThreshold);

      // Approve removal (need 3 out of 4)
      await heirly
        .connect(owner)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian2)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian3)
        .approveGuardianRemoval(vaultId, guardian1.address);

      // Approve threshold (need 3 out of 4)
      await heirly
        .connect(owner)
        .approveThresholdUpdate(vaultId, newThreshold);
      await heirly
        .connect(guardian2)
        .approveThresholdUpdate(vaultId, newThreshold);
      await heirly
        .connect(guardian3)
        .approveThresholdUpdate(vaultId, newThreshold);

      // Queue both changes
      await heirly
        .connect(owner)
        .queueVaultReconfiguration(vaultId, guardian1.address, newThreshold);

      // Fast forward past timelock
      await time.increase(24 * 60 * 60);

      // Execute both
      const tx = heirly
        .connect(owner)
        .executeVaultReconfiguration(vaultId, guardian1.address, newThreshold);

      await expect(tx).to.emit(heirly, "VaultReconfigurationExecuted");

      // Verify both changes applied
      const vault = await heirly.vaults(vaultId);
      expect(vault.approvalThreshold).to.equal(newThreshold);
      expect(await heirly.isGuardian(vaultId, guardian1.address)).to.equal(
        false
      );
    });

    it("should revert if new threshold exceeds remaining guardians after removal", async function () {
      await heirly
        .connect(owner)
        .proposeGuardianRemoval(vaultId, guardian1.address);
      await heirly.connect(owner).proposeThresholdUpdate(vaultId, 4);

      // Approve removal
      await heirly
        .connect(owner)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian2)
        .approveGuardianRemoval(vaultId, guardian1.address);
      await heirly
        .connect(guardian3)
        .approveGuardianRemoval(vaultId, guardian1.address);

      // Approve threshold
      await heirly.connect(owner).approveThresholdUpdate(vaultId, 4);
      await heirly.connect(guardian2).approveThresholdUpdate(vaultId, 4);
      await heirly.connect(guardian3).approveThresholdUpdate(vaultId, 4);

      // Queue both
      await heirly
        .connect(owner)
        .queueVaultReconfiguration(vaultId, guardian1.address, 4);

      // Fast forward past timelock
      await time.increase(24 * 60 * 60);

      // Execution should fail due to invalid threshold
      await expect(
        heirly
          .connect(owner)
          .executeVaultReconfiguration(vaultId, guardian1.address, 4)
      ).to.be.revertedWithCustomError(heirly, "InvalidNewThreshold");
    });
  });

  describe("Access Control", function () {
    it("should prevent non-guardian from proposing removal", async function () {
      await expect(
        heirly
          .connect(beneficiary)
          .proposeGuardianRemoval(vaultId, guardian1.address)
      ).to.be.revertedWithCustomError(heirly, "OnlyGuardian");
    });

    it("should prevent non-guardian from approving removal", async function () {
      await heirly
        .connect(owner)
        .proposeGuardianRemoval(vaultId, guardian1.address);
      await expect(
        heirly
          .connect(beneficiary)
          .approveGuardianRemoval(vaultId, guardian1.address)
      ).to.be.revertedWithCustomError(heirly, "OnlyGuardian");
    });

    it("should prevent non-guardian from proposing threshold update", async function () {
      await expect(
        heirly.connect(beneficiary).proposeThresholdUpdate(vaultId, 2)
      ).to.be.revertedWithCustomError(heirly, "OnlyGuardian");
    });

    it("should prevent non-guardian from approving threshold update", async function () {
      await heirly.connect(owner).proposeThresholdUpdate(vaultId, 2);
      await expect(
        heirly.connect(beneficiary).approveThresholdUpdate(vaultId, 2)
      ).to.be.revertedWithCustomError(heirly, "OnlyGuardian");
    });
  });
});
