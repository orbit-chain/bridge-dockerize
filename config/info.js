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

    let CHAIN_ID = ENDPOINT.chain_id;
    let GAS_PRICE = ENDPOINT.gas_price;

    obj[chain] = { ENDPOINT, CONTRACT_ADDRESS, CHAIN_ID, GAS_PRICE };

    if(key === "eth") obj[chain].ETH_TERMINAL_TOTAL_DIFFICULTY = ENDPOINT.terminal_total_difficulty || "58750000000000000000000";
}
obj.ADDRESS_BOOK = settings.silicon
module.exports = Object.assign({}, obj);
