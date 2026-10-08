const { ethers } = require("hardhat");

async function main() {
  const [owner, guardian1, guardian2, guardian3, beneficiary] = await ethers.getSigners();
  const Heirly = await ethers.getContractFactory("Heirly");
  const heirly = await Heirly.deploy();
  await heirly.waitForDeployment();

  const vaultTx = await heirly.createVault(
    "FHE Benchmark Vault",
    "Gas benchmarking for FHE on-chain operations",
    [guardian1.address, guardian2.address, guardian3.address],
    2
  );
  await vaultTx.wait();

  // Accept invites
  await heirly.connect(guardian1).acceptGuardianInvite(1);
  await heirly.connect(guardian2).acceptGuardianInvite(1);
  await heirly.connect(guardian3).acceptGuardianInvite(1);

  // Mint access token
  await heirly.mintAccessToken(1, beneficiary.address, "ipfs://nft-pass-uri");

  const docTx = await heirly.addDocument(
    1,
    "encrypted-meta",
    "QmTestIPFS",
    0 // Read
  );
  await docTx.wait();

  // Create 128-byte ciphertexts (dimension = 2)
  const ct1 = "0x" + "0".repeat(62) + "02" + "0".repeat(62) + "0a" + "0".repeat(62) + "14" + "0".repeat(62) + "64";
  const ct2 = "0x" + "0".repeat(62) + "02" + "0".repeat(62) + "0b" + "0".repeat(62) + "15" + "0".repeat(62) + "c8";

  // 1. Benchmark saveGuardianSharesFHE (3 guardians)
  const saveTx = await heirly.saveGuardianSharesFHE(
    1,
    [guardian1.address, guardian2.address, guardian3.address],
    [ct1, ct2, ct2]
  );
  const saveReceipt = await saveTx.wait();
  console.log("saveGuardianSharesFHE (3 guardians, 128B each):", saveReceipt.gasUsed.toString(), "gas");

  // 2. Benchmark requestAccess
  const reqTx = await heirly.connect(beneficiary).requestAccess(1);
  await reqTx.wait();

  // 3. Benchmark approveAccessFHE (First approval - initializes accumulator)
  const approve1Tx = await heirly.connect(guardian1).approveAccessFHE(1, ct1);
  const approve1Receipt = await approve1Tx.wait();
  console.log("approveAccessFHE (1st approval - init accumulator):", approve1Receipt.gasUsed.toString(), "gas");

  // 4. Benchmark approveAccessFHE (Second approval - homomorphic addition + threshold reached)
  const approve2Tx = await heirly.connect(guardian2).approveAccessFHE(1, ct2);
  const approve2Receipt = await approve2Tx.wait();
  console.log("approveAccessFHE (2nd approval - homomorphic add + threshold grant):", approve2Receipt.gasUsed.toString(), "gas");
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
