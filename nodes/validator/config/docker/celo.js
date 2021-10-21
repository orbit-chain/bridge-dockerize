const settings = require("./settings");

let obj = {};
if (settings.chainList.includes('celo')) {
    obj.CELO_RPC = settings.Endpoints.Celo.rpc;
    obj.CELO_WS = settings.Endpoints.Celo.socket;
}

module.exports = Object.assign({}, obj);
