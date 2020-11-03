exports.packSwapData = function(data) {
    let result = [];

    result.push({t: 'address', v: data.hubContract});
    result.push({t: 'string', v: data.fromChain});
    result.push({t: 'string', v: data.toChain});
    result.push({t: 'bytes', v: toHexBuffer(data.fromAddr)});
    result.push({t: 'bytes', v: toHexBuffer(data.toAddr)});
    result.push({t: 'bytes', v: toHexBuffer(data.token)});
    result.push({t: 'bytes32[]', v: data.bytes32s});
    result.push({t: 'uint[]', v: data.uints});

    return result;
};

exports.packSuggestHash = function(data) {
    let result = [];

    result.push({t: 'address', v: data.bridgeContract});
    result.push({t: 'bytes32', v: data.govId});
    result.push({t: 'uint', v: data.suggestIndex});
    result.push({t: 'uint[]', v: data.uints});
    result.push({t: 'bytes32', v: data.signatureHash});

    return result;
};

function toHexBuffer(str) {
    return Buffer.from(str.replace('0x', ""), 'hex');
}
