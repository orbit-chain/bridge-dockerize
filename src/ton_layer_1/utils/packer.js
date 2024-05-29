exports.packSwapDataA = function(data) {
    let result = [];

    result.push({t: 'address', v: data.hubContract});
    result.push({t: 'bytes32', v: data.fromChainId});
    result.push({t: 'bytes32', v: data.toChainId});
    result.push({t: 'bytes', v: toHexBuffer(data.fromAddr)});

    return result;
}

exports.packSwapDataB = function(data) {
    let result = [];

    result.push({t: 'bytes', v: toHexBuffer(data.toAddr)});
    result.push({t: 'bytes', v: toHexBuffer(data.token)});
    result.push({t: 'bytes32[]', v: data.bytes32s});

    return result;
}

exports.packSwapDataC = function(data) {
    let result = [];

    result.push({t: 'uint[]', v: data.uints});

    return result;
}

exports.packSwapDataD = function(data) {
    let result = [];

    result.push({t: 'bytes', v: toHexBuffer(data.data)});

    return result;
}

exports.packSigHash = function(data) {
    let result = [];

    result.push({t: 'bytes32', v:data.hash1});
    result.push({t: 'bytes32', v:data.hash2});

    return result;
}

exports.packLimitationData = function(data) {
    let result = [];

    result.push({t: 'string', v: "GateKeeper"});
    result.push({t: 'string', v: data.fromChain});
    result.push({t: 'string', v: data.toChain});
    result.push({t: 'bytes', v: toHexBuffer(data.token)});
    result.push({t: 'bytes32[]', v: data.bytes32s});
    result.push({t: 'uint[]', v: data.uints});

    return result;
}

exports.packTagHash = function(data) {
    let result = [];

    result.push({t: 'string', v: 'TON'});
    result.push({t: 'string', v: 'AddressBook'});
    result.push({t: 'uint256', v: data.version});
    result.push({t: 'string', v: data.toChain});
    result.push({t: 'bytes', v: toHexBuffer(data.toAddress)});
    result.push({t: 'bytes', v: toHexBuffer(data.transfortData)});

    return result;
}

function toHexBuffer(str) {
    return Buffer.from(str.replace('0x', ""), 'hex');
}
