const settings = require("./settings");

module.exports = {
    host: settings.Endpoints.Terra && settings.Endpoints.Terra.lcd,
    chainId: settings.Endpoints.Terra && settings.Endpoints.Terra.networkId,
    gasPrices: settings.Endpoints.Terra && settings.Endpoints.Terra.gasPrices,
    threshold: settings.Endpoints.Terra && settings.BridgeAddress.Governance.Threshold,
    pubkeys: settings.Endpoints.Terra && settings.BridgeAddress.Governance.Pubkeys,
    TxFee: settings.Endpoints.Terra && settings.BridgeAddress.Governance.TxFee,
    TxFeeHolder: settings.Endpoints.Terra && settings.BridgeAddress.Governance.TxFeeHolder,
};
