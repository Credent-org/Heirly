const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployHeirly } = require("./helpers/deployHeirly.cjs");

describe("Heirly Cross-Contract Access Delegation (IHeirly / ERC-165)", function () {
  let heirly;
  let consumer;
  let owner;
  let guardian1;
  let beneficiary;

  // Standard ERC-165 and ERC-721 interface identifiers.
  const ERC165_INTERFACE_ID = "0x01ffc9a7";
  const ERC721_INTERFACE_ID = "0x80ac58cd";

  beforeEach(async function () {
    [owner, guardian1, beneficiary] = await ethers.getSigners();

    heirly = await deployHeirly();

    const HeirlyConsumer = await ethers.getContractFactory(
      "HeirlyConsumer"
    );
    consumer = await HeirlyConsumer.deploy();
    await consumer.waitForDeployment();
  });

  describe("ERC-165 interface discovery", function () {
    it("exposes a non-zero IHeirly interface id", async function () {
      const id = await consumer.HEIRLY_INTERFACE_ID();
      expect(id).to.not.equal("0x00000000");
    });

    it("Heirly reports support for IHeirly via supportsInterface", async function () {
      const id = await consumer.HEIRLY_INTERFACE_ID();
      expect(await heirly.supportsInterface(id)).to.equal(true);
    });

    it("Heirly still supports the base ERC-165 and ERC-721 interfaces", async function () {
      expect(await heirly.supportsInterface(ERC165_INTERFACE_ID)).to.equal(
        true
      );
      expect(await heirly.supportsInterface(ERC721_INTERFACE_ID)).to.equal(
        true
      );
    });

    it("third-party consumer detects Heirly through isHeirly()", async function () {
      expect(await consumer.isHeirly(await heirly.getAddress())).to.equal(
        true
      );
    });

    it("isHeirly() returns false for an EOA / non-Heirly address", async function () {
      const eoa = beneficiary.address; // an EOA, not a Heirly deployment
      expect(await consumer.isHeirly(eoa)).to.equal(false);
    });
  });

  describe("Standardized checkAccess hook", function () {
    beforeEach(async function () {
      const guardians = [guardian1.address];
      await heirly
        .connect(owner)
        .createVault("Delegation Vault", "Desc", guardians, 1);
      await heirly.connect(owner).addDocument(1, "meta", "QmTestHash", 0);
    });

    it("returns 2 (ACCESS_GRANTED) for a guardian/owner", async function () {
      expect(await heirly.checkAccess(1, owner.address)).to.equal(2);
      expect(
        await consumer.delegatedAccessCheck(
          await heirly.getAddress(),
          1,
          owner.address
        )
      ).to.equal(2);
    });

    it("returns 1 (ACCESS_DENIED) for a user with no access", async function () {
      expect(await heirly.checkAccess(1, beneficiary.address)).to.equal(1);
      expect(
        await consumer.delegatedAccessCheck(
          await heirly.getAddress(),
          1,
          beneficiary.address
        )
      ).to.equal(1);
    });

    it("returns 0 (DOCUMENT_NOT_FOUND) for a non-existent document", async function () {
      expect(await heirly.checkAccess(999, owner.address)).to.equal(0);
      expect(
        await consumer.delegatedAccessCheck(
          await heirly.getAddress(),
          999,
          owner.address
        )
      ).to.equal(0);
    });

    it("hasActiveAccess agrees with checkAccess()", async function () {
      expect(await heirly.hasActiveAccess(1, owner.address)).to.equal(true);
      expect(await heirly.hasActiveAccess(1, beneficiary.address)).to.equal(
        false
      );
    });
  });

  describe("Consumer delegation helpers", function () {
    beforeEach(async function () {
      const guardians = [guardian1.address];
      await heirly
        .connect(owner)
        .createVault("Delegation Vault", "Desc", guardians, 1);
    });

    it("isGuardianOf reflects guardian membership", async function () {
      expect(
        await consumer.isGuardianOf(
          await heirly.getAddress(),
          1,
          owner.address
        )
      ).to.equal(true);
      expect(
        await consumer.isGuardianOf(
          await heirly.getAddress(),
          1,
          beneficiary.address
        )
      ).to.equal(false);
    });

    it("resolveVaultCreator returns the vault creator", async function () {
      expect(
        await consumer.resolveVaultCreator(await heirly.getAddress(), 1)
      ).to.equal(owner.address);
    });

    it("getVaultCreator / getApprovalThreshold are callable directly", async function () {
      expect(await heirly.getVaultCreator(1)).to.equal(owner.address);
      expect(await heirly.getApprovalThreshold(1)).to.equal(1);
    });
  });
});
