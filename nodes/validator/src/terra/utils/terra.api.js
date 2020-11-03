const request = require('request');
const config = require(ROOT + '/config');

exports.getAccountInfo = (address) => {
    return new Promise((resolve, reject) => {
        request(`${config.terra.host}/auth/accounts/${address}`, {json: true}, (err, res) => {
            if (err)
                return reject(err);
            if (res.statusCode !== 200)
                return reject(new Error(res.statusMessage));
            if (res.body.error)
                return reject(new Error(res.error));

            resolve(res.body);
        });
    });
};

exports.getTaxInfo = (denom) => {
    if (!denom)
        throw 'denom is not defined.';

    return new Promise((resolve, reject) => {
        let taxRate, taxCap;
        request(`${config.terra.host}/treasury/tax_rate`, {json: true}, (err, res) => {
            taxRate = res.body.hasOwnProperty('result') ? res.body['result'] : null;

            if(!taxRate)
                return reject(new Error('tax_rate: ' + res.body));

            request(`${config.terra.host}/treasury/tax_cap/${denom}`, {json: true}, (err, res) => {
                if (err)
                    reject(err);

                taxCap = res.body.hasOwnProperty('result') ? res.body['result'] : null;

                if(!taxRate)
                    return reject(new Error('tax_cap: ' + res.body));

                resolve({denom, taxRate, taxCap});
            });
        });
    });
};


exports.getRewards = (multisigAddr) => {
    return new Promise((resolve, reject) => {
        request(`${config.terra.host}/distribution/delegators/${multisigAddr}/rewards`, {json:true}, (err, res) => {
            if (err) {
                reject(err);
            }
            const rewardInfo = res.body.hasOwnProperty('result') ? res.body['result'] : null;
            if (!rewardInfo) {
                return reject(new Error('reward: ' + res.body));
            }
            resolve(rewardInfo);
        });
    });
};

exports.combineSignature = (multisigAddr, stdTxValue, sequence, signatures, pubkeys) => {
    let tx = {
        tx: stdTxValue,
        signatures: signatures,
        chain_id: config.terra.chainId,
        sequence_number: sequence.toString(),
        signature_only: true
    };

    if(pubkeys)
        tx.pubkey = pubkeys;

    return new Promise((resolve, reject) => {
        let options = {
            method: 'POST',
            json: true,
            body: tx
        };

        request(`${config.terra.host}/auth/accounts/${multisigAddr}/multisign`, options, (err, res) => {
            if (err)
                return reject(err);
            if (res.statusCode !== 200)
                return reject({message: res.statusMessage, body: res.body});
            if (res.body.error)
                return reject({message: res.error, body: res.body});

            resolve(res.body);
        })
    })
};

exports.getTransaction = (txhash) => {
    if (!txhash)
        throw new Error('txhash parameter not set.');

    txhash = txhash.replace('0x', '').toUpperCase();

    return new Promise((resolve, reject) => {
        let options = {
            method: 'GET',
            json: true,
        };

        request(`${config.terra.host}/txs/${txhash}`, options, (err, res) => {
            if (err)
                return reject(err);
            if (res.statusCode !== 200)
                return reject({message: res.statusMessage, body: res.body});
            if (res.body.error)
                return reject({message: res.error, body: res.body});

            resolve(res.body);
        })
    })
};

exports.broadcast = (signedStdTx, mode) => {
    let tx = {tx: signedStdTx.value, mode: mode || 'sync'};

    return new Promise((resolve, reject) => {
        let options = {
            method: 'POST',
            json: true,
            body: tx
        };

        request(`${config.terra.host}/txs`, options, (err, res) => {
            if (err)
                return reject(err);
            if (res.statusCode !== 200)
                return reject({message: res.statusMessage, body: res.body});
            if (res.body.error)
                return reject({message: res.error, body: res.body});

            resolve(res.body);
        })
    })
};
