const express = require("express");
const router = express.Router();
let govInstance;

//  http://host/v1/gov/
router.get("/", function (req, res, next) {
    res.send("gov");
});

router.get("/getAddress/:chain", async function (req, res, next) {
    const chain = req.body && req.body.chain || req.params && req.params.chain;
    return res.json(await govInstance.getAddress(chain));
})

router.get("/getTransaction/:chain/:transactionId", async function (req, res, next) {
    const chain = req.body && req.body.chain || req.params && req.params.chain;
    const tid = req.body && req.body.transactionId || req.params && req.params.transactionId;
    return res.json(await govInstance.getTransaction(chain, tid));
})

router.get("/confirm/:chain/:transactionId/:gasPrice/:chainId", async function (req, res, next) {
    const chain = req.body && req.body.chain || req.params && req.params.chain;
    const tid = req.body && req.body.transactionId || req.params && req.params.transactionId;
    const gasPrice = req.body && req.body.gasPrice || req.params && req.params.gasPrice;
    const chainId = req.body && req.body.chainId || req.params && req.params.chainId;
    return res.json(await govInstance.confirmTransaction(chain, tid, gasPrice, chainId));
})

router.get("/confirmRange/:chain/:start/:end/:gasPrice/:chainId", async function (req, res, next) {
    const chain = req.body && req.body.chain || req.params && req.params.chain;
    const start = req.body && req.body.start || req.params && req.params.start;
    const end = req.body && req.body.end || req.params && req.params.end;
    const gasPrice = req.body && req.body.gasPrice || req.params && req.params.gasPrice;
    const chainId = req.body && req.body.chainId || req.params && req.params.chainId;
    return res.send(await govInstance.confirmTransactionByRange(chain, start, end, gasPrice, chainId));
})

router.get("/validate/:sigHash", async function (req, res, next) {
    const sigHash = req.body && req.body.sigHash || req.params && req.params.sigHash;
    return res.json(await govInstance.validateSigHash(sigHash));
});

// deprecated
/*
router.get("/validateEd25519/:sigHash", async function (req, res, next) {
    const sigHash = req.body && req.body.sigHash || req.params && req.params.sigHash;
    return res.json(await govInstance.validateEd25519SigHash(sigHash));
});
*/

function setGovInstance(instance) {
    govInstance = instance;
    return router;
}

module.exports = {
    setGovInstance,
}
