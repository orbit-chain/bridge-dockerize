const settings = require("./settings");

let obj = {};
if (settings.chainList.includes('matic')) {
    obj.MATIC_RPC = settings.Endpoints.Matic.rpc;
    obj.MATIC_WS = settings.Endpoints.Matic.socket;
}

module.exports = Object.assign({}, obj);
