const settings = require("./settings");

module.exports = {
    ETH_MAINNET_MINTER: settings.BridgeAddress.Eth && settings.BridgeAddress.Eth.EthMinterContract,
    ETH_MULTISIG_CONTRACT: settings.BridgeAddress.Eth && settings.BridgeAddress.Eth.MessageMultiSigWallet,
    KLAYTN_MAINNET_MINTER: settings.BridgeAddress.Klay && settings.BridgeAddress.Klay.KlaytnMinterContract,
    KLAYTN_MULTISIG_CONTRACT: settings.BridgeAddress.Klay && settings.BridgeAddress.Klay.MessageMultiSigWallet,
    ICON_MAINNET_MINTER: settings.BridgeAddress.Icon && settings.BridgeAddress.Icon.IconMinterContract,
    ICON_MULTISIG_CONTRACT: settings.BridgeAddress.Icon && settings.BridgeAddress.Icon.MessageMultiSigWallet,
    ORBIT_MAINNET_MINTER: settings.BridgeAddress.Orbit && settings.BridgeAddress.Orbit.OrbitMinterContract,
    ORBIT_MULTISIG_CONTRACT: settings.BridgeAddress.Orbit && settings.BridgeAddress.Orbit.MessageMultiSigWallet,
    ORBIT_HUB_CONTRACT: settings.BridgeAddress.OrbitHubContract,
    ORBIT_HUB_MULTISIG: settings.BridgeAddress.MessageMultiSigWallet.Hub,
    ETH_BRIDGE_CONTRACT: settings.BridgeAddress.EthBridgeContract,
    ETH_BRIDGE_MULTISIG: settings.BridgeAddress.MessageMultiSigWallet.Eth,
    TERRA_BRIDGE_CONTRACT: settings.BridgeAddress.TerraBridgeContract,
    TERRA_BRIDGE_MULTISIG: settings.BridgeAddress.MessageMultiSigWallet.Terra,
    KLAYTN_BRIDGE_CONTRACT: settings.BridgeAddress.KlaytnBridgeContract,
    KLAYTN_BRIDGE_MULTISIG: settings.BridgeAddress.MessageMultiSigWallet.Klaytn,
    ICON_BRIDGE_CONTRACT: settings.BridgeAddress.IconBridgeContract,
    ICON_BRIDGE_MULTISIG: settings.BridgeAddress.MessageMultiSigWallet.Icon,
    ORBIT_BRIDGE_CONTRACT: settings.BridgeAddress.OrbitBridgeContract,
    ORBIT_BRIDGE_MULTISIG: settings.BridgeAddress.MessageMultiSigWallet.Orbit,
    XRP_BRIDGE_CONTRACT: settings.BridgeAddress.XrpBridgeContract,
    XRP_BRIDGE_MULTISIG: settings.BridgeAddress.MessageMultiSigWallet.Xrp,
    XRP_ADDRESS_BOOK: settings.BridgeAddress.XrpAddressBook,
};

