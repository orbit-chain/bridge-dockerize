const settings = require('./settings');

module.exports = {
    ETH_MAINNET_MINTER: settings.BridgeAddress.Eth.EthMinterContract,
    ETH_MULTISIG_CONTRACT: settings.BridgeAddress.Eth.MessageMultiSigWallet,
    KLAYTN_MAINNET_MINTER: settings.BridgeAddress.Klay.KlaytnMinterContract,
    KLAYTN_MULTISIG_CONTRACT: settings.BridgeAddress.Klay.MessageMultiSigWallet,
    ORBIT_HUB_CONTRACT: settings.BridgeAddress.OrbitHubContract,
    ORBIT_HUB_MULTISIG: settings.BridgeAddress.MessageMultiSigWallet.Hub,
    ETH_BRIDGE_CONTRACT: settings.BridgeAddress.EthBridgeContract,
    ETH_BRIDGE_MULTISIG: settings.BridgeAddress.MessageMultiSigWallet.Eth,
    TERRA_BRIDGE_CONTRACT: settings.BridgeAddress.TerraBridgeContract,
    TERRA_BRIDGE_MULTISIG: settings.BridgeAddress.MessageMultiSigWallet.Terra,
    KLAYTN_BRIDGE_CONTRACT: settings.BridgeAddress.KlaytnBridgeContract,
    KLAYTN_BRIDGE_MULTISIG: settings.BridgeAddress.MessageMultiSigWallet.Klaytn,
};
