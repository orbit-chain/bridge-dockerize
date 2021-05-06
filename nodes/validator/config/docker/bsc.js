const settings = require("./settings");

let obj = {};
if (settings.chainList.includes('bsc')) {
    obj.BSC_RPC = settings.Endpoints.Bsc.rpc;
    obj.BSC_WS = settings.Endpoints.Bsc.socket;
}

module.exports = Object.assign({}, obj);