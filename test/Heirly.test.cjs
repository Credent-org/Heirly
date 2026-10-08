const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployHeirly } = require("./helpers/deployHeirly.cjs");

describe("Heirly EVM Contract Unit Tests", function () {
  let heirly;
  let owner;
  let guardian1;
  let guardian2;
  let beneficiary;

  beforeEach(async function () {
    [owner, guardian1, guardian2, beneficiary] = await ethers.getSigners();

    heirly = await deployHeirly();
  });

  describe("Public Key Registry", function () {
    it("should allow a user to register an X25519 public key", async function () {
      const pubKey = "B64_PUBLIC_KEY_TEST_STRING_12345";
      await expect(heirly.connect(beneficiary).registerPublicKey(pubKey))
        .to.emit(heirly, "PublicKeyRegistered")
        .withArgs(beneficiary.address, pubKey);

      const registeredKey = await heirly.userPublicKeys(beneficiary.address);
      expect(registeredKey).to.equal(pubKey);
    });
  });

  describe("Vault Creation & Guardian Thresholds", function () {
    it("should create a vault with valid threshold and guardian invite list", async function () {
      const guardians = [guardian1.address, guardian2.address];
      const threshold = 2; // threshold out of owner + 2 guardians = 3 total

      const tx = await heirly
        .connect(owner)
        .createVault(
          "Executive Vault",
          "Confidential legal documents",
          guardians,
          threshold
        );

      await expect(tx).to.emit(heirly, "VaultCreated");

      const vault = await heirly.vaults(1);
      expect(vault.name).to.equal("Executive Vault");
      expect(vault.creator).to.equal(owner.address);
      expect(vault.approvalThreshold).to.equal(threshold);
      expect(vault.isActive).to.equal(true);
    });

    it("should revert vault creation if no external guardians are provided", async function () {
      await expect(
        heirly.connect(owner).createVault("Single Vault", "Desc", [], 1)
      ).to.be.revertedWithCustomError(heirly, "AtLeastOneGuardian");
    });

    it("should revert if approval threshold is zero or exceeds total guardian count", async function () {
      const guardians = [guardian1.address];
      await expect(
        heirly
          .connect(owner)
          .createVault("Invalid Threshold Vault", "Desc", guardians, 0)
      ).to.be.revertedWithCustomError(heirly, "InvalidApprovalThreshold");

      await expect(
        heirly
          .connect(owner)
          .createVault("Over Threshold Vault", "Desc", guardians, 5)
      ).to.be.revertedWithCustomError(heirly, "InvalidApprovalThreshold");
    });
  });

  describe("Vault Release State & Proof of Life", function () {
    it("should allow vault creator to record proof of life", async function () {
      const guardians = [guardian1.address];
      await heirly
        .connect(owner)
        .createVault("Inheritance Vault", "Desc", guardians, 1);

      await expect(heirly.connect(owner).proveLife(1)).to.emit(
        heirly,
        "ProofOfLifeRecorded"
      );
    });

    it("should allow vault creator to toggle emergency mode", async function () {
      const guardians = [guardian1.address];
      await heirly
        .connect(owner)
        .createVault("Emergency Vault", "Desc", guardians, 1);

      await expect(heirly.connect(owner).setEmergencyMode(1, true))
        .to.emit(heirly, "EmergencyModeUpdated")
        .withArgs(1, true);
    });
  });

  describe("Beneficiary Registry", function () {
    beforeEach(async function () {
      await heirly.connect(owner).createVault("Beneficiary Vault", "Desc", [guardian1.address], 1);
    });

    it("should allow the vault creator to set a beneficiary", async function () {
      await expect(heirly.connect(owner).setBeneficiary(1, beneficiary.address))
        .to.emit(heirly, "BeneficiarySet")
        .withArgs(1, beneficiary.address);

      expect(await heirly.getBeneficiary(1)).to.equal(beneficiary.address);
    });

    it("should default to the zero address when no beneficiary is set", async function () {
      expect(await heirly.getBeneficiary(1)).to.equal(ethers.ZeroAddress);
    });

    it("should revert when setting a zero-address beneficiary", async function () {
      await expect(
        heirly.connect(owner).setBeneficiary(1, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(heirly, "ZeroAddressBeneficiary");
    });

    it("should revert when a non-creator tries to set the beneficiary", async function () {
      await expect(
        heirly.connect(guardian1).setBeneficiary(1, beneficiary.address)
      ).to.be.revertedWithCustomError(heirly, "OnlyVaultCreator");
    });

    it("should revert when the beneficiary is already set", async function () {
      await heirly.connect(owner).setBeneficiary(1, beneficiary.address);

      await expect(
        heirly.connect(owner).setBeneficiary(1, guardian2.address)
      ).to.be.revertedWithCustomError(heirly, "BeneficiaryAlreadySet");
    });
  });

  describe("NFT Transfer Access Revocation", function () {
    let userA;
    let userB;

    beforeEach(async function () {
      const signers = await ethers.getSigners();
      userA = signers[4];
      userB = signers[5];

      await heirly
        .connect(owner)
        .createVault("Access Vault", "Desc", [guardian1.address], 1);
      await heirly.connect(guardian1).acceptGuardianInvite(1);
    });

    async function grantAccessToUserA() {
      await heirly
        .connect(guardian1)
        .mintAccessToken(1, userA.address, "uri");
      await heirly.connect(guardian1).addDocument(1, "meta", "ipfs-hash", 0);
      await heirly.connect(userA).requestAccess(1);
      await heirly.connect(guardian1).approveAccess(1);
    }

    it("should revoke all past document access grants when sender transfers their last NFT pass", async function () {
      await grantAccessToUserA();
      expect(await heirly.hasActiveAccess(1, userA.address)).to.equal(true);

      await heirly
        .connect(userA)
        .transferFrom(userA.address, userB.address, 1);

      expect(await heirly.hasActiveAccess(1, userA.address)).to.equal(false);
      expect(await heirly.hasVaultToken(userA.address, 1)).to.equal(false);
    });

    it("should not let the transfer recipient inherit the sender's document grants", async function () {
      await grantAccessToUserA();

      await heirly
        .connect(userA)
        .transferFrom(userA.address, userB.address, 1);

      expect(await heirly.hasActiveAccess(1, userB.address)).to.equal(false);
    });

    it("should require fresh guardian approval before re-acquired passes restore access", async function () {
      await grantAccessToUserA();
      await heirly
        .connect(userA)
        .transferFrom(userA.address, userB.address, 1);

      await heirly
        .connect(guardian1)
        .mintAccessToken(1, userA.address, "uri-2");
      expect(await heirly.hasActiveAccess(1, userA.address)).to.equal(false);

      await expect(heirly.connect(userA).requestAccess(1))
        .to.emit(heirly, "AccessRequested")
        .withArgs(2, 1, userA.address);

      await expect(heirly.connect(guardian1).approveAccess(2))
        .to.emit(heirly, "AccessGranted")
        .withArgs(2, 1, userA.address);

      expect(await heirly.hasActiveAccess(1, userA.address)).to.equal(true);
    });

    it("should preserve active grants on partial transfer while any pass remains", async function () {
      await heirly
        .connect(guardian1)
        .mintAccessToken(1, userA.address, "uri-1");
      await heirly
        .connect(guardian1)
        .mintAccessToken(1, userA.address, "uri-2");
      await heirly.connect(guardian1).addDocument(1, "meta", "ipfs-hash", 0);
      await heirly.connect(userA).requestAccess(1);
      await heirly.connect(guardian1).approveAccess(1);

      await heirly
        .connect(userA)
        .transferFrom(userA.address, userB.address, 1);

      expect(await heirly.hasActiveAccess(1, userA.address)).to.equal(true);
      expect(await heirly.hasVaultToken(userA.address, 1)).to.equal(true);
    });

    it("should not revoke access on self-transfer", async function () {
      await grantAccessToUserA();

      await heirly
        .connect(userA)
        .transferFrom(userA.address, userA.address, 1);

      expect(await heirly.hasActiveAccess(1, userA.address)).to.equal(true);
    });

    it("should revoke access on burn and require fresh approval after re-mint", async function () {
      await grantAccessToUserA();

      await expect(heirly.connect(userA).burnAccessToken(1)).to.emit(
        heirly,
        "NFTBurned"
      );
      expect(await heirly.hasActiveAccess(1, userA.address)).to.equal(false);

      await heirly
        .connect(guardian1)
        .mintAccessToken(1, userA.address, "uri-2");
      expect(await heirly.hasActiveAccess(1, userA.address)).to.equal(false);

      await heirly.connect(userA).requestAccess(1);
      await heirly.connect(guardian1).approveAccess(2);
      expect(await heirly.hasActiveAccess(1, userA.address)).to.equal(true);
    });
  });

  describe("Cross-Chain Revocation Broadcast", function () {
    let userA;

    beforeEach(async function () {
      const signers = await ethers.getSigners();
      userA = signers[4];

      await heirly.connect(owner).createVault("Broadcast Vault", "Desc", [guardian1.address], 1);
      await heirly.connect(guardian1).acceptGuardianInvite(1);
      await heirly.connect(guardian1).mintAccessToken(1, userA.address, "uri");
      await heirly.connect(guardian1).addDocument(1, "meta", "ipfs-hash", 0);
      await heirly.connect(userA).requestAccess(1);
      await heirly.connect(guardian1).approveAccess(1);
    });

    it("computes vaultGID from this contract's address and the vault id", async function () {
      const expected = ethers.solidityPackedKeccak256(
        ["address", "uint256"],
        [await heirly.getAddress(), 1]
      );
      expect(await heirly.vaultGID(1)).to.equal(expected);
    });

    it("differs per vault since vaultGID incorporates the vault id", async function () {
      await heirly.connect(owner).createVault("Second Vault", "Desc", [guardian2.address], 1);
      const gid1 = await heirly.vaultGID(1);
      const gid2 = await heirly.vaultGID(2);
      expect(gid1).to.not.equal(gid2);
    });

    it("still clears on-chain access and emits AccessRevoked alongside the broadcast", async function () {
      expect(await heirly.hasActiveAccess(1, userA.address)).to.equal(true);

      await expect(heirly.connect(guardian1).revokeAccess(1, userA.address))
        .to.emit(heirly, "AccessRevoked")
        .withArgs(1, userA.address);

      expect(await heirly.hasActiveAccess(1, userA.address)).to.equal(false);
    });

    it("is disabled by default and does not emit a broadcast or touch the nonce", async function () {
      expect(await heirly.crossChainRevocationEnabled(1)).to.equal(false);

      await expect(heirly.connect(guardian1).revokeAccess(1, userA.address))
        .to.not.emit(heirly, "CrossChainRevocationBroadcast");
      expect(await heirly.documentRevocationNonce(1, userA.address)).to.equal(0);
    });

    it("only the vault creator can enable cross-chain revocation broadcasting", async function () {
      await expect(
        heirly.connect(guardian1).setCrossChainRevocationEnabled(1, true)
      ).to.be.revertedWithCustomError(heirly, "OnlyVaultCreator");
    });

    it("emits CrossChainRevocationBroadcast and RevokeAccess with a strictly increasing nonce once enabled, bumping vaultAccessVersion", async function () {
      await heirly.connect(owner).setCrossChainRevocationEnabled(1, true);
      const gid = await heirly.vaultGID(1);
      const initialVer = await heirly.getVaultAccessVersion(1, userA.address);

      await expect(heirly.connect(guardian1).revokeAccess(1, userA.address))
        .to.emit(heirly, "CrossChainRevocationBroadcast")
        .withArgs(gid, 1, userA.address, 1)
        .and.to.emit(heirly, "RevokeAccess")
        .withArgs(gid, 1, userA.address, 1);
      expect(await heirly.documentRevocationNonce(1, userA.address)).to.equal(1);
      expect(await heirly.getVaultAccessVersion(1, userA.address)).to.equal(initialVer + 1n);

      // A relayed message for a Soroban-side relay_revoke_access call must
      // never be replayable, so the nonce keeps increasing even across
      // repeated revokes of the same document/user pair.
      await expect(heirly.connect(guardian1).revokeAccess(1, userA.address))
        .to.emit(heirly, "CrossChainRevocationBroadcast")
        .withArgs(gid, 1, userA.address, 2)
        .and.to.emit(heirly, "RevokeAccess")
        .withArgs(gid, 1, userA.address, 2);
      expect(await heirly.documentRevocationNonce(1, userA.address)).to.equal(2);
      expect(await heirly.getVaultAccessVersion(1, userA.address)).to.equal(initialVer + 2n);
    });
  });
});
