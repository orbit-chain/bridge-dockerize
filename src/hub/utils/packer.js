exports.packRelayedData = function(data) {
    let result = [];

    result.push({t: 'string', v: data.fromChain});
    result.push({t: 'bytes32[]', v: data.bytes32s});
    result.push({t: 'uint[]', v: data.uints});

    return result;
}

exports.packChainId = function (data) {
    let result = [];

    result.push({t: 'address', v: data.hubContract});
    result.push({t: 'string', v:data.chain});

    return result;
}
