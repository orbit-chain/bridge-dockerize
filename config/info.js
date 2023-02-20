const settings = require(`./${process.env.PROFILE}/${process.env.CHAIN}`);
const { endpoints } = require(`./${process.env.PROFILE}/endpoints.js`);

let obj = {};
for(let chain of settings.chain_list){
    chain = chain.toLowerCase();

    let key = "";
    if(chain.includes("-v2")) {
        chain = chain.split("-")[0];
        key = chain;
    }
    else if(chain.includes("_layer")) key = chain.split("_")[0];
    else key = chain;

    let ENDPOINT = endpoints[key];
    let CONTRACT_ADDRESS = settings.bridge_address[key] || {};
    CONTRACT_ADDRESS["OrbitHubContract"] = settings.bridge_address.orbit_hub;
    CONTRACT_ADDRESS["OrbitHubMultiSigWallet"] = settings.bridge_address.multisig.hub;
    CONTRACT_ADDRESS["BridgeContract"] = settings.bridge_address[`${key}_bridge`];
    CONTRACT_ADDRESS["BridgeMultiSigWallet"] = settings.bridge_address.multisig[key];
    CONTRACT_ADDRESS["AddressBook"] = settings.bridge_address[`${key}_address_book`];

    let CHAIN_ID = ENDPOINT.chain_id;
    let GAS_PRICE = ENDPOINT.gas_price;

    obj[chain] = { ENDPOINT, CONTRACT_ADDRESS, CHAIN_ID, GAS_PRICE };

    if(key === "eth") obj[chain].ETH_TERMINAL_TOTAL_DIFFICULTY = settings.ETH_TERMINAL_TOTAL_DIFFICULTY || "58750000000000000000000";
}

module.exports = Object.assign({}, obj);
