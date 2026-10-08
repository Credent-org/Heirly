const { ethers } = require("hardhat");

/**
 * Deploy Heirly with EmergencyVrfLogic linked. External library
 * functions are DELEGATECALL'd so the vault stays under EIP-170.
 */
async function deployHeirly(signer) {
  const libFactory = signer
    ? await ethers.getContractFactory("EmergencyVrfLogic", signer)
    : await ethers.getContractFactory("EmergencyVrfLogic");
  const lib = await libFactory.deploy();
  await lib.waitForDeployment();

  const adminFactory = signer
    ? await ethers.getContractFactory("HeirlyAdminLogic", signer)
    : await ethers.getContractFactory("HeirlyAdminLogic");
  const admin = await adminFactory.deploy();
  await admin.waitForDeployment();

  const factoryOptions = {
    libraries: {
      EmergencyVrfLogic: await lib.getAddress(),
      HeirlyAdminLogic: await admin.getAddress(),
    },
  };
  if (signer) {
    factoryOptions.signer = signer;
  }
  const factory = await ethers.getContractFactory("Heirly", factoryOptions);
  const vault = await factory.deploy();
  await vault.waitForDeployment();
  return vault;
}

module.exports = { deployHeirly };
