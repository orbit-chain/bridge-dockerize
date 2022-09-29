const settings = require("./settings");

let obj = {};
for(let chain of settings.chainList){
    chain = chain.toLowerCase();

    let key = "";
    if(chain.includes("-v2")) {
        chain = chain.split("-")[0];
        key = chain;
    }
    else if(chain.includes("_layer")) key = chain.split("_")[0];
    else key = chain;

    const chainCamel = key.charAt(0).toUpperCase() + key.slice(1);
    let ENDPOINT = settings.Endpoints[chainCamel];
    let CONTRACT_ADDRESS = settings.BridgeAddress[chainCamel === "Klaytn" ? "Klay" : chainCamel] || {};
    CONTRACT_ADDRESS["OrbitHubContract"] = settings.BridgeAddress.OrbitHubContract;
    CONTRACT_ADDRESS["OrbitHubMultiSigWallet"] = settings.BridgeAddress.MessageMultiSigWallet.Hub;
    CONTRACT_ADDRESS["BridgeContract"] = settings.BridgeAddress[`${chainCamel}BridgeContract`];
    CONTRACT_ADDRESS["BridgeMultiSigWallet"] = settings.BridgeAddress.MessageMultiSigWallet[chainCamel];
    CONTRACT_ADDRESS["AddressBook"] = settings.BridgeAddress[`${chainCamel}AddressBook`];

    const chainUpper = chain.toUpperCase();
    let CHAIN_ID = settings[`${chain.toUpperCase()}_CHAIN_ID`];
    let GAS_PRICE = settings[`${chain.toUpperCase()}_GAS_PRICE`];

    obj[chain] = { ENDPOINT, CONTRACT_ADDRESS, CHAIN_ID, GAS_PRICE };

    if(key === "eth") obj[chain].ETH_TERMINAL_TOTAL_DIFFICULTY = settings.ETH_TERMINAL_TOTAL_DIFFICULTY || "58750000000000000000000";
}

module.exports = Object.assign({}, obj);
