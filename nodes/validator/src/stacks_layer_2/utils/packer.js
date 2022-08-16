exports.packSwapData = function(data) {
    let result = [];

    if(data.toChain === "STACKS"){
        result.push({t: 'address', v: data.hubContract});
        result.push({t: 'string', v: data.fromChain});
        result.push({t: 'string', v: data.toChain});
        result.push({t: 'bytes', v: toHexBuffer(data.fromAddr)});
        result.push({t: 'bytes', v: toHexBuffer(data.token)});
        result.push({t: 'bytes32', v: data.bytes32s[0]});
        result.push({t: 'bytes32', v: data.bytes32s[1]});
        result.push({t: 'uint', v: data.uints[1]});
        result.push({t: 'uint', v: data.uints[2]});
        result.push({t: 'uint', v: data.uints[3]});
    }
    else{
        result.push({t: 'address', v: data.hubContract});
        result.push({t: 'string', v: data.fromChain});
        result.push({t: 'string', v: data.toChain});
        result.push({t: 'bytes', v: toHexBuffer(data.fromAddr)});
        result.push({t: 'bytes', v: toHexBuffer(data.toAddr)});
        result.push({t: 'bytes', v: toHexBuffer(data.token)});
        result.push({t: 'bytes32[]', v: data.bytes32s});
        result.push({t: 'uint[]', v: data.uints});
        result.push({t: 'bytes', v: toHexBuffer(data.data)});
    }

    return result;
};

exports.packDataHash = function(data) {
    let result = [];

    result.push({t: 'address', v: data.hubContract});
    result.push({t: 'string', v: data.fromChain});
    result.push({t: 'string', v: data.toChain});
    result.push({t: 'bytes', v: toHexBuffer(data.fromAddr)});
    result.push({t: 'bytes', v: toHexBuffer(data.token)});
    result.push({t: 'bytes32[]', v: data.bytes32s});
    result.push({t: 'uint', v: data.uints[1]});
    result.push({t: 'uint', v: data.uints[2]});

    return result;
}

exports.packSuggestHash = function(data) {
    let result = [];

    result.push({t: 'address', v: data.contract});
    result.push({t: 'bytes32', v: data.govId});
    result.push({t: 'uint', v: data.suggestIndex.toString()});
    result.push({t: 'uint', v: data.swapIndex.toString()});
    result.push({t: 'uint', v: data.fee.toString()});
    result.push({t: 'uint', v: data.seq.toString()});

    return result;
};

exports.packSigningHash = function(data) {
    let result = [];

    result.push({t: 'address', v: data.contract});
    result.push({t: 'bytes32', v: data.govId});
    result.push({t: 'uint', v: data.selectionIndex});
    result.push({t: 'address[]', v: data.vaList});

    return result;
};

exports.packStacksTagHash = function(data) {
    let result = [];

    result.push({t: 'string', v: data.toChain});
    result.push({t: 'bytes', v: toHexBuffer(data.toAddress)});
    result.push({t: 'bytes', v: toHexBuffer(data.transfortData)});

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

function toHexBuffer(str) {
    return Buffer.from(str.replace('0x', ""), 'hex');
}
