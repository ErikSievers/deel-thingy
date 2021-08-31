const express = require('express');
const bodyParser = require('body-parser');
const { sequelize } = require('./model')
const { Op } = require('sequelize');
const { getProfile } = require('./middleware/getProfile')
const app = express();

app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models')
    const { id } = req.params
    const contract = await Contract.findOne({
        where: {
            [Op.and]: [
                { id },
                {
                    [Op.or]: [
                        { ContractorId: req.profile.id },
                        { ClientId: req.profile.id }
                    ]
                }
            ]

        }
    })
    if (!contract) return res.status(404).end()
    res.json(contract)
})

/**
 * @returns all non-terminated contracts for a user
 */
app.get('/contracts', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models')
    const contracts = await Contract.findAll({
        where: {
            [Op.and]: [
                {
                    [Op.not]: {
                        status: 'terminated'
                    }
                },
                {
                    [Op.or]: [
                        { ContractorId: req.profile.id },
                        { ClientId: req.profile.id }
                    ]
                }
            ]

        }
    })
    res.json(contracts)
})

/**
 * @returns all unpaid jobs for a user's active (non-terminated) contracts
 */
app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models')
    const jobs = await Job.findAll({
        where: {
            [Op.or]: [{ paid: { [Op.is]: null } }, { paid: { [Op.not]: true } }]
        },
        include: {
            model: Contract,
            required: true,
            where: {
                [Op.and]: [{
                    [Op.not]: {
                        status: 'terminated'
                    }
                },
                {
                    [Op.or]: [
                        { ClientId: req.profile.id },
                        { ContractorId: req.profile.id }
                    ]
                }]
            }
        },
    })
    res.json(jobs)
})

/**
 * Let's a client pay for a job
 * Job needs to be unpaid and part of a non-terminated contract
 * @returns true if successful
 * @throws 400 insufficient funds if the balance of a client is insufficient
 */
app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models')
    const t = await sequelize.transaction();
    try {
        const jobPromise = Job.findOne({
            where: {
                [Op.or]: [{ paid: { [Op.is]: null } }, { paid: { [Op.not]: true } }]
            },
            include: {
                model: Contract,
                required: true,
                where: {
                    [Op.and]: [{
                        [Op.not]: {
                            status: 'terminated'
                        }
                    },
                    {
                        ClientId: req.profile.id
                    }
                    ]
                }
            },
            transaction: t,
        });
        // Can't rely on the previous middleware here since we need the database operations to be part of the same transaction
        // Possible optimisation: remove the getProfile middleware
        const clientPromise = Profile.findOne({
            where: {
                Id: req.profile.id
            },
            transaction: t
        });
        const client = await clientPromise;
        const job = await jobPromise;
        if (!job) {
            res.sendStatus(404);
            throw "Job not found"
        }
        if (client.balance < job.price) {
            res.status(400).send("Insufficient funds");
            throw "Insufficient funds"
        }
        const contractor = await Profile.findOne({
            where: {
                Id: job.Contract.ContractorId
            },
            transaction: t
        });
        const contractorBalancePromise = Profile.update({ balance: contractor.balance + job.price }, {
            where: {
                id: contractor.id
            },
            transaction: t
        });
        const clientBalancePromise = Profile.update({ balance: client.balance - job.price }, {
            where: {
                id: client.id
            },
            transaction: t
        });
        const jobPaidPromise = Job.update({ paid: true }, {
            where: { id: job.id },
            transaction: t
        });
        await Promise.all([contractorBalancePromise, clientBalancePromise, jobPaidPromise]);
        await t.commit();
        return res.sendStatus(200);
    } catch (e) {
        await t.rollback();
        if (!res.headersSent) {
            console.log(e);
            res.sendStatus(500);
        }
    }
    // Get the job, client and contractor
})


module.exports = app;
