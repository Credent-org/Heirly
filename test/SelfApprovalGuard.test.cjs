const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployHeirly } = require("./helpers/deployHeirly.cjs");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const ONE_DAY = 24 * 60 * 60;
const REQUEST_TTL = 3 * ONE_DAY;

describe("Heirly Self-Approval Guard", function () {
  let heirly;
  let owner;
  let guardian1;
  let guardian2;
  let beneficiary;
  let outsider;

  beforeEach(async function () {
    [owner, guardian1, guardian2, beneficiary, outsider] =
      await ethers.getSigners();

    heirly = await deployHeirly();
  });

  async function createVault(threshold, guardians) {
    const tx = await heirly
      .connect(owner)
      .createVault(
        "Self-Approval Test Vault",
        "Multi-custody vault",
        guardians,
        threshold
      );
    await tx.wait();
    return 1;
  }

  async function acceptInvites(vaultId, guardians) {
    for (const guardian of guardians) {
      await heirly.connect(guardian).acceptGuardianInvite(vaultId);
    }
  }

  async function addDocument(vaultId) {
    return heirly.connect(owner).addDocument(
      vaultId,
      "encrypted-metadata",
      "QmTestHash",
      0 // AccessLevel.READ
    );
  }

  async function mintToken(vaultId, to) {
    const tx = await heirly
      .connect(owner)
      .mintAccessToken(vaultId, to, "https://token.uri");
    const receipt = await tx.wait();
    const evt = receipt.logs
      .map((log) => {
        try {
          return heirly.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed && parsed.name === "NFTMinted");
    return evt.args.tokenId;
  }

  async function requestAndWaitForRequest(documentId, requester) {
    const tx = await heirly.connect(requester).requestAccess(documentId);
    const receipt = await tx.wait();
    const evt = receipt.logs
      .map((log) => {
        try {
          return heirly.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed && parsed.name === "AccessRequested");
    return evt.args.requestId;
  }

  describe("Exploit Prevention", function () {
    it("blocks the pre-acceptance self-approval exploit (threshold=1)", async function () {
      // Attack window: file the request while NOT yet a guardian, accept the
      // invite, then self-approve. Without the guard this releases the document.
      const vaultId = await createVault(1, [guardian1.address]);
      await addDocument(vaultId);
      await mintToken(vaultId, guardian1.address);

      // guardian1 is not a guardian yet, so the request is allowed
      const requestId = await requestAndWaitForRequest(1, guardian1);

      // guardian1 becomes a guardian and tries to approve their own request
      await heirly.connect(guardian1).acceptGuardianInvite(vaultId);

      await expect(
        heirly.connect(guardian1).approveAccess(requestId)
      ).to.be.revertedWithCustomError(heirly, "CannotSelfApproveAccess");

      const request = await heirly.accessRequests(requestId);
      expect(request[3]).to.equal(0); // RequestStatus.PENDING
      expect(await heirly.hasActiveAccess(1, guardian1.address)).to.equal(
        true
      ); // guardian blanket access
    });

    it("blocks self-approval via the share-submission overload", async function () {
      const vaultId = await createVault(1, [guardian1.address]);
      await addDocument(vaultId);
      await mintToken(vaultId, guardian1.address);

      const requestId = await requestAndWaitForRequest(1, guardian1);
      await heirly.connect(guardian1).acceptGuardianInvite(vaultId);

      await expect(
        heirly
          .connect(guardian1)
          ["approveAccess(uint256,string)"](
            requestId,
            "encrypted-share-for-self"
          )
      ).to.be.revertedWithCustomError(heirly, "CannotSelfApproveAccess");

      expect(
        await heirly.getBeneficiaryKeyShare(requestId, guardian1.address)
      ).to.equal("");
    });

    it("requires quorum from approvals distinct from the requester (threshold=2)", async function () {
      const vaultId = await createVault(2, [
        guardian1.address,
        guardian2.address,
      ]);
      await addDocument(vaultId);
      await mintToken(vaultId, guardian1.address);

      const requestId = await requestAndWaitForRequest(1, guardian1);
      await heirly.connect(guardian1).acceptGuardianInvite(vaultId);
      await heirly.connect(guardian2).acceptGuardianInvite(vaultId);

      // A single external approval cannot reach the threshold of 2
      await heirly.connect(owner).approveAccess(requestId);
      let request = await heirly.accessRequests(requestId);
      expect(request[3]).to.equal(0); // still PENDING
      expect(
        await heirly.hasApprovedRequest(requestId, owner.address)
      ).to.equal(true);

      // Second distinct approval (guardian2) reaches quorum: both != requester
      await expect(heirly.connect(guardian2).approveAccess(requestId))
        .to.emit(heirly, "AccessGranted")
        .withArgs(requestId, 1, guardian1.address);

      request = await heirly.accessRequests(requestId);
      expect(request[3]).to.equal(1); // RequestStatus.APPROVED
      expect(
        await heirly.hasApprovedRequest(requestId, owner.address)
      ).to.equal(true);
      expect(
        await heirly.hasApprovedRequest(requestId, guardian2.address)
      ).to.equal(true);
      // The requester's self-vote never counted toward quorum
      expect(
        await heirly.hasApprovedRequest(requestId, guardian1.address)
      ).to.equal(false);
      expect(await heirly.hasActiveAccess(1, guardian1.address)).to.equal(
        true
      );
    });
  });

  describe("Legitimate Approval Flows", function () {
    it("lets an accepted external guardian approve a beneficiary (threshold=1)", async function () {
      const vaultId = await createVault(1, [guardian1.address]);
      await acceptInvites(vaultId, [guardian1]);
      await addDocument(vaultId);
      await mintToken(vaultId, beneficiary.address);

      const requestId = await requestAndWaitForRequest(1, beneficiary);

      await expect(heirly.connect(guardian1).approveAccess(requestId))
        .to.emit(heirly, "AccessApproved")
        .withArgs(requestId, guardian1.address)
        .to.emit(heirly, "AccessGranted")
        .withArgs(requestId, 1, beneficiary.address);

      const request = await heirly.accessRequests(requestId);
      expect(request[3]).to.equal(1); // RequestStatus.APPROVED
      expect(await heirly.hasActiveAccess(1, beneficiary.address)).to.equal(
        true
      );
    });

    it("lets the creator approve another user's request (ban is self-only)", async function () {
      const vaultId = await createVault(1, [guardian1.address]);
      await addDocument(vaultId);
      await mintToken(vaultId, beneficiary.address);

      const requestId = await requestAndWaitForRequest(1, beneficiary);

      await expect(heirly.connect(owner).approveAccess(requestId))
        .to.emit(heirly, "AccessGranted")
        .withArgs(requestId, 1, beneficiary.address);
    });

    it("stores and emits the beneficiary key share on valid approval", async function () {
      const vaultId = await createVault(1, [guardian1.address]);
      await acceptInvites(vaultId, [guardian1]);
      await addDocument(vaultId);
      await mintToken(vaultId, beneficiary.address);

      const requestId = await requestAndWaitForRequest(1, beneficiary);
      const share = "ecies-encrypted-share-payload";

      await expect(
        heirly
          .connect(guardian1)
          ["approveAccess(uint256,string)"](requestId, share)
      )
        .to.emit(heirly, "ShareSubmittedForBeneficiary")
        .withArgs(requestId, guardian1.address, share);

      expect(
        await heirly.getBeneficiaryKeyShare(requestId, guardian1.address)
      ).to.equal(share);
    });
  });

  describe("Approval Integrity Regressions", function () {
    it("reverts when the same guardian approves twice", async function () {
      const vaultId = await createVault(2, [
        guardian1.address,
        guardian2.address,
      ]);
      await acceptInvites(vaultId, [guardian1, guardian2]);
      await addDocument(vaultId);
      await mintToken(vaultId, beneficiary.address);

      const requestId = await requestAndWaitForRequest(1, beneficiary);
      await heirly.connect(guardian1).approveAccess(requestId);

      await expect(
        heirly.connect(guardian1).approveAccess(requestId)
      ).to.be.revertedWithCustomError(heirly, "AlreadyApproved");
    });

    it("reverts when a non-guardian approves", async function () {
      const vaultId = await createVault(1, [guardian1.address]);
      await addDocument(vaultId);
      await mintToken(vaultId, beneficiary.address);

      const requestId = await requestAndWaitForRequest(1, beneficiary);

      await expect(
        heirly.connect(outsider).approveAccess(requestId)
      ).to.be.revertedWithCustomError(heirly, "OnlyGuardian");
    });

    it("reverts for a non-existent request", async function () {
      await createVault(1, [guardian1.address]);

      await expect(
        heirly.connect(guardian1).approveAccess(999)
      ).to.be.revertedWithCustomError(heirly, "RequestNotExist");
    });

    it("reverts when approving an already-finalized request", async function () {
      const vaultId = await createVault(1, [guardian1.address]);
      await acceptInvites(vaultId, [guardian1]);
      await addDocument(vaultId);
      await mintToken(vaultId, beneficiary.address);

      const requestId = await requestAndWaitForRequest(1, beneficiary);
      await heirly.connect(guardian1).approveAccess(requestId);

      // A different guardian hits the status check, not AlreadyApproved
      await expect(
        heirly.connect(owner).approveAccess(requestId)
      ).to.be.revertedWithCustomError(heirly, "RequestNotPending");
    });

    it("reverts when approving an expired request", async function () {
      const vaultId = await createVault(1, [guardian1.address]);
      await acceptInvites(vaultId, [guardian1]);
      await addDocument(vaultId);
      await mintToken(vaultId, beneficiary.address);

      const requestId = await requestAndWaitForRequest(1, beneficiary);
      await time.increase(REQUEST_TTL + 1);

      await expect(
        heirly.connect(guardian1).approveAccess(requestId)
      ).to.be.revertedWithCustomError(heirly, "RequestExpired");
    });

    it("rejects the request if the requester dropped their NFT before quorum", async function () {
      const vaultId = await createVault(1, [guardian1.address]);
      await acceptInvites(vaultId, [guardian1]);
      await addDocument(vaultId);
      const tokenId = await mintToken(vaultId, beneficiary.address);

      const requestId = await requestAndWaitForRequest(1, beneficiary);
      await heirly.connect(beneficiary).burnAccessToken(tokenId);

      await heirly.connect(guardian1).approveAccess(requestId);

      const request = await heirly.accessRequests(requestId);
      expect(request[3]).to.equal(2); // RequestStatus.REJECTED
      expect(await heirly.hasActiveAccess(1, beneficiary.address)).to.equal(
        false
      );
    });

    it("prevents guardians from filing requests (blanket guardian access)", async function () {
      const vaultId = await createVault(1, [guardian1.address]);
      await acceptInvites(vaultId, [guardian1]);
      await addDocument(vaultId);

      await expect(
        heirly.connect(guardian1).requestAccess(1)
      ).to.be.revertedWithCustomError(heirly, "AlreadyHasAccess");
    });
  });
});
