const fs = require('fs')
const Web3 = require('web3')
const HDWalletProvider = require('@truffle/hdwallet-provider')

const web3 = new Web3(new HDWalletProvider(process.env.MNEMONIC, process.env.INFURA))

const disperseABI = require('./abis/Disperse.json')
const DUSD = require('./abis/DUSD.json')
const disperseApp = '0xD152f549545093347A162Dce210e7293f1452150'

const balAddress = '0xba100000625a3754423978a60c9317c58a424e3d'
const from = process.env.FROM

const toWei = web3.utils.toWei
const toBN = web3.utils.toBN

async function execute() {
    const data = JSON.parse(fs.readFileSync('./bal/until_week_26_11158542-11356700.json').toString())
    const recipients = []
    const values = []
    let total = toBN(0)
    Object.keys(data).forEach(r => {
        recipients.push(r)
        const value = toWei(data[r].toString())
        total = total.add(toBN(value))
        values.push(value)
    })
    console.log(total.toString())
    const disperse = new web3.eth.Contract(disperseABI, disperseApp)
    const bal = new web3.eth.Contract(DUSD, balAddress)
    await bal.methods.approve(disperseApp, total).send({ from, gasPrice: '59000000000' })

    const transfer = disperse.methods.disperseToken(balAddress, recipients, values)
    console.log(transfer.encodeABI())
    await transfer.send({ from, gas: 6000000, gasPrice: '59000000000' })
}


execute()
