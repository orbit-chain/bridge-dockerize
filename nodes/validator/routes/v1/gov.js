const express = require("express");
const router = express.Router();
let govInstance;

//  http://host/v1/gov/
router.get("/", function (req, res, next) {
    res.send("gov");
});

router.get("/getTransaction/:chain/:migAddr/:transactionId", async function (req, res, next) {
    const chain = req.body && req.body.chain || req.params && req.params.chain;
    const mig = req.body && req.body.migAddr || req.params && req.params.migAddr;
    const tid = req.body && req.body.transactionId || req.params && req.params.transactionId;
    return res.json(await govInstance.getPendingTransaction(chain, mig, tid));
})

router.get("/confirm/:chain/:migAddr/:transactionId", async function (req, res, next) {
    const chain = req.body && req.body.chain || req.params && req.params.chain;
    const mig = req.body && req.body.migAddr || req.params && req.params.migAddr;
    const tid = req.body && req.body.transactionId || req.params && req.params.transactionId;
    return res.json(await govInstance.confirmTransaction(chain, mig, tid));
})

router.get("/validate/:chain/:migAddr/:sigHash", async function (req, res, next) {
    const chain = req.body && req.body.chain || req.params && req.params.chain;
    const mig = req.body && req.body.migAddr || req.params && req.params.migAddr;
    const sigHash = req.body && req.body.sigHash || req.params && req.params.sigHash;
    return res.json(await govInstance.validateSigHash(chain, mig, sigHash));
});

function setGovInstance(instance) {
    govInstance = instance;
    return router;
}

module.exports = {
    setGovInstance,
}
