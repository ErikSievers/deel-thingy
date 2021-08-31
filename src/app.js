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


module.exports = app;
