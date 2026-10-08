const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployHeirly } = require("./helpers/deployHeirly.cjs");

describe("Heirly Key Rotation & Emergency Revocation (issue #156)", function () {
  let heirly;
  let owner;
  let guardian1;
  let guardian2;
  let beneficiary;

  const OLD_KEY = "OLD_COMPROMISED_B64_PUBLIC_KEY";
  const NEW_KEY = "NEW_ROTATED_B64_PUBLIC_KEY";

  beforeEach(async function () {
    [owner, guardian1, guardian2, beneficiary] = await ethers.getSigners();

    heirly = await deployHeirly();

    await heirly.connect(beneficiary).registerPublicKey(OLD_KEY);
  });

  describe("revokeKey", function () {
    it("should rotate to the new key and blacklist the old one", async function () {
      await expect(heirly.connect(beneficiary).revokeKey(OLD_KEY, NEW_KEY))
        .to.emit(heirly, "KeyRevoked")
        .withArgs(beneficiary.address, OLD_KEY, NEW_KEY, 1);

      expect(await heirly.userPublicKeys(beneficiary.address)).to.equal(NEW_KEY);
      expect(await heirly.isKeyRevoked(OLD_KEY)).to.equal(true);
      expect(await heirly.isKeyRevoked(NEW_KEY)).to.equal(false);
      expect(await heirly.keyRotationCount(beneficiary.address)).to.equal(1);
    });

    it("should increment the rotation counter across successive rotations", async function () {
      const THIRD_KEY = "THIRD_B64_PUBLIC_KEY";
      await heirly.connect(beneficiary).revokeKey(OLD_KEY, NEW_KEY);
      await heirly.connect(beneficiary).revokeKey(NEW_KEY, THIRD_KEY);

      expect(await heirly.userPublicKeys(beneficiary.address)).to.equal(THIRD_KEY);
      expect(await heirly.keyRotationCount(beneficiary.address)).to.equal(2);
      expect(await heirly.isKeyRevoked(NEW_KEY)).to.equal(true);
    });

    it("should reject revocation by an account that does not own the old key", async function () {
      await expect(
        heirly.connect(guardian1).revokeKey(OLD_KEY, NEW_KEY)
      ).to.be.revertedWithCustomError(heirly, "KeyOwnershipProofFailed");

      // The key was not revoked or rotated.
      expect(await heirly.isKeyRevoked(OLD_KEY)).to.equal(false);
      expect(await heirly.userPublicKeys(beneficiary.address)).to.equal(OLD_KEY);
    });

    it("should reject revocation when the caller has no registered key", async function () {
      await expect(
        heirly.connect(guardian2).revokeKey("UNREGISTERED_KEY", NEW_KEY)
      ).to.be.revertedWithCustomError(heirly, "KeyOwnershipProofFailed");
    });

    it("should reject rotating to an empty or identical key", async function () {
      await expect(
        heirly.connect(beneficiary).revokeKey(OLD_KEY, "")
      ).to.be.revertedWithCustomError(heirly, "InvalidNewPublicKey");

      await expect(
        heirly.connect(beneficiary).revokeKey(OLD_KEY, OLD_KEY)
      ).to.be.revertedWithCustomError(heirly, "InvalidNewPublicKey");
    });

    it("should reject rotating to a previously revoked key", async function () {
      const THIRD_KEY = "THIRD_B64_PUBLIC_KEY";
      await heirly.connect(beneficiary).revokeKey(OLD_KEY, NEW_KEY);

      await expect(
        heirly.connect(beneficiary).revokeKey(NEW_KEY, OLD_KEY)
      ).to.be.revertedWithCustomError(heirly, "RevokedPublicKey");
    });
  });

  describe("Blacklist enforcement", function () {
    it("should refuse to re-register a revoked key", async function () {
      await heirly.connect(beneficiary).revokeKey(OLD_KEY, NEW_KEY);

      await expect(
        heirly.connect(beneficiary).registerPublicKey(OLD_KEY)
      ).to.be.revertedWithCustomError(heirly, "RevokedPublicKey");

      // A different account cannot adopt the compromised key either.
      await expect(
        heirly.connect(guardian1).registerPublicKey(OLD_KEY)
      ).to.be.revertedWithCustomError(heirly, "RevokedPublicKey");
    });

    it("should allow registering a fresh non-revoked key after rotation", async function () {
      await heirly.connect(beneficiary).revokeKey(OLD_KEY, NEW_KEY);

      const FOURTH_KEY = "FOURTH_B64_PUBLIC_KEY";
      await expect(heirly.connect(beneficiary).registerPublicKey(FOURTH_KEY))
        .to.emit(heirly, "PublicKeyRegistered")
        .withArgs(beneficiary.address, FOURTH_KEY);
    });

    it("should keep guardian approval flows working after a key rotation", async function () {
      // Minimal vault setup so guardian1 can approve an access request.
      await heirly
        .connect(owner)
        .createVault("KV", "rotation test vault", [guardian1.address], 1);
      await heirly.connect(guardian1).acceptGuardianInvite(1);
      await heirly
        .connect(owner)
        .addDocument(1, "encrypted-metadata", "QmTestHash", 0);

      // Beneficiary needs an access token for the vault before requesting access.
      await heirly
        .connect(owner)
        .mintAccessToken(1, beneficiary.address, "https://token.uri");
      await heirly.connect(beneficiary).requestAccess(1);
      const requestId = await heirly.latestRequestId(1, beneficiary.address);

      // Guardian rotates their compromised key before submitting the share.
      const GUARDIAN_OLD_KEY = "GUARDIAN_OLD_B64_KEY";
      await heirly.connect(guardian1).registerPublicKey(GUARDIAN_OLD_KEY);
      await heirly.connect(guardian1).revokeKey(GUARDIAN_OLD_KEY, "GUARDIAN_NEW_B64_KEY");
      expect(await heirly.isKeyRevoked(GUARDIAN_OLD_KEY)).to.equal(true);

      // The rotated (non-revoked) guardian can still submit beneficiary shares.
      await expect(
        heirly
          .connect(guardian1)
          ["approveAccess(uint256,string)"](requestId, "ENVELOPE_FOR_NEW_GUARDIAN_KEY")
      ).to.emit(heirly, "ShareSubmittedForBeneficiary");

      const share = await heirly.getBeneficiaryKeyShare(requestId, guardian1.address);
      expect(share).to.equal("ENVELOPE_FOR_NEW_GUARDIAN_KEY");
    });
  });

  describe("isKeyRevoked view", function () {
    it("should report unknown keys as not revoked", async function () {
      expect(await heirly.isKeyRevoked("NEVER_SEEN_KEY")).to.equal(false);
    });
  });
});
