const fs = require('fs')
const Web3 = require('web3')
const web3 = new Web3(process.env.INFURA)

const StakeLPToken = require('../abis/StakeLPToken.json')
const DUSD = require('../abis/DUSD.json')
const UniswapV2Pair = require('../abis/UniswapV2Pair.json')
const BPool = require('../abis/BPool.json')

const toWei = web3.utils.toWei
const toBN = web3.utils.toBN
const ZEROAddress = '0x0000000000000000000000000000000000000000'

const contractIgnoreList = [
    '0x8ccd68af5e35fe01c56ad40cd2ed27cbd7767fb1'.toLowerCase(), // DUSD <> ETH Uni pool
    '0xed5ad5f258eef6a9745042bde7d46e8a5254c183'.toLowerCase(), // DUSD <> USDC Bal pool
    '0xb275966ced444a7190ccff68369825a578efe124'.toLowerCase(), // DUSD <> USDC Uni pool
    '0x3de74999ff62edeb1d998badae59c803cc557bb3'.toLowerCase()
]

const score = {}
const until = 11152000 // Retroactive mining until this block

async function execute() {
    await mintAndStakeRewards(
        10733824, // DUSD contract was deployed
        10796000, // Sep-04-2020 04:40 PM UTC - TVL cap was raised
        10913290, // Sep-22-2020 04:10 PM UTC
        '0x5BC25f649fc4e26069dDF4cF4010F9f706c23831'.toLowerCase(),
        '0xb47638956e3D95f591D0a38F6F47EA6cAFee78B6'.toLowerCase()
    )

    await mintAndStakeRewards(
        10799555, // swDUSD contract was deployed
        10799555, // swDUSD contract was deployed
        11009540, // Oct-07-2020 4:10 PM +UTC
        '0x72a0c7ce0d5a09dd77d0bb972ddab2c3aa865b24'.toLowerCase(),
        '0x3a0d2277591d8ee9e822952db5019cd7b212d541'.toLowerCase()
    )


    await poolRewards(
        10867372, // DUSD <> USDC BPool was spawned
        10913291, // Sep-22-2020 04:10 PM +UTC
        until,
        100, // 1 BPT is worth ~$100
        '0xed5ad5f258eef6a9745042bde7d46e8a5254c183' /* BPool */
    )

    await poolRewards(
        10782192, // Uni ETH <> DUSD pool was spawned
        11009540, // Oct-07-2020 4:10 PM +UTC
        until,
        48, // 1 uni pool token is worth ~$40. Multiply that by 1.2 to give 20% extra rewards = 48
        '0x8ccd68af5e35fe01c56ad40cd2ed27cbd7767fb1' /* Uni pool */
    )

    let rewardTokens = toBN(15e5) // 1.5 million or 1.5% token supply
    const res = {}

    const txs = {}
    let notEligibleTrade = 0
    const uniswapPair = new web3.eth.Contract(UniswapV2Pair, '0x8ccd68af5e35fe01c56ad40cd2ed27cbd7767fb1')
    const bPool = new web3.eth.Contract(BPool, '0xed5ad5f258eef6a9745042bde7d46e8a5254c183')
    let events = (await uniswapPair.getPastEvents('Swap', { fromBlock: 10782192, toBlock: until }))
        .concat(await bPool.getPastEvents('LOG_SWAP', { fromBlock: 10867372, toBlock: until }))
    for (let i = 0; i < events.length; i++) {
        const event = events[i]
        if (isTradeEligible(event)) {
            txs[events[i].transactionHash.toLowerCase()] = true
        } else {
            notEligibleTrade++
        }
    }
    // console.log('not eligible', notEligibleTrade)

    const _txs = Object.keys(txs)
    for (let i = 0; i < _txs.length; i++) {
        // user who made the tx
        const from = (await web3.eth.getTransaction(_txs[i])).from.toLowerCase()
        if (!res[from]) {
            res[from] = 500 // 500 token reward for an account that performed an eligible swap
            rewardTokens = rewardTokens.sub(toBN(500))
        }
    }

    // Process scores
    let totalScore = toBN(0)
    const accounts = Object.keys(score)
    for (let i = 0; i < accounts.length; i++) {
        const s = accounts[i]
        const isContract = (await web3.eth.getCode(s)).length > 2 ? true : false
        // const isContract = contractIgnoreList.includes(s) // hack
        if (isContract) {
            if (!contractIgnoreList.includes(s) && score[s].toString() != '0') {
                console.log(s, score[s].toString())
                throw new Error(`Unexpected contract address ${s} was found`)
            }
            delete score[s]
        } else {
            totalScore = totalScore.add(score[s])
        }
    }

    Object.keys(score)
    .sort((a, b) => score[a].lt(score[b]) ? -1 : 1)
    .forEach(s => {
        if (score[s].toString() == '0') return
        const toAssign = score[s].mul(rewardTokens).div(totalScore).toNumber()
        if (res[s] == 500) {
            res[s] += toAssign
            rewardTokens = rewardTokens.sub(toBN(toAssign))
        } else {
            res[s] = Math.max(toAssign, 500)
            rewardTokens = rewardTokens.sub(toBN(res[s]))
        }
        totalScore = totalScore.sub(score[s])
    })

    const rewards = {}
    let t = 0
    Object.keys(res)
    .sort((a, b) => res[a] - res[b])
    .forEach(s => {
        rewards[s] = res[s]
        t += rewards[s]
    })
    // console.log(rewards, Object.keys(rewards).length, t)
    fs.writeFileSync(
        `${process.cwd()}/dfd/DFD_retroactive_liquidity_mining.json`,
        JSON.stringify(rewards, null, 2)
    )
}

const MIN_TRADE = toBN(toWei('10')) // atleast a $10 trade to prevent sybil
function isTradeEligible(event) {
    if (event.event == 'LOG_SWAP') { // Balancer trade
        return toBN(event.returnValues.tokenAmountIn).gte(MIN_TRADE) || toBN(event.returnValues.tokenAmountOut).gte(MIN_TRADE)
    }
    // Uniswap trade
    return toBN(event.returnValues.amount0In).gte(MIN_TRADE) || toBN(event.returnValues.amount1In).gte(MIN_TRADE)
}

async function mintAndStakeRewards(genesis, fromBlock, toBlock, dusdAddress, stakeLPTokenAddress) {
    const state = {}
    const dusd = new web3.eth.Contract(DUSD, dusdAddress)
    let events = await dusd.getPastEvents('Transfer', { fromBlock: genesis, toBlock })

    const stakeLPToken = new web3.eth.Contract(StakeLPToken, stakeLPTokenAddress)
    events = events
        .concat(await stakeLPToken.getPastEvents('RewardPaid', { fromBlock: genesis, toBlock }))
        .sort((a, b) => a.blockNumber - b.blockNumber)

    for (let i = 0; i < events.length; i++) {
        const event = events[i]
        // RewardPaid is equivalent to minting
        if (event.event == 'RewardPaid') {
            event.returnValues = {
                from: ZEROAddress,
                to: event.returnValues.user,
                value: event.returnValues.reward
            }
        }

        let { from, to, value } = event.returnValues
        from = from.toLowerCase()
        to = to.toLowerCase()
        // console.log(from, to, value)

        // ignore staked events
        if (to == stakeLPTokenAddress) {
            continue
        }

        if (from == stakeLPTokenAddress) {
            if (to == ZEROAddress) { // equivalent to user burning their tokens
                // user who made the tx
                from = (await web3.eth.getTransaction(event.transactionHash)).from.toLowerCase()
            } else {
                // ignore unstake events, because staked events were also ignored
                continue
            }
        }
        updateState(state, from, to, toBN(value), fromBlock, event.blockNumber)
    }
}

async function poolRewards(genesis, rewardApplicableFrom, toBlock, multiplier, poolAddress) {
    const state = {}
    const bpt = new web3.eth.Contract(DUSD, poolAddress)
    let events = (await bpt.getPastEvents('Transfer', { fromBlock: genesis, toBlock }))
        .sort((a, b) => a.blockNumber - b.blockNumber)
    for (let i = 0; i < events.length; i++) {
        const event = events[i]
        // console.log(event)
        let { from, to, value } = event.returnValues
        updateState(state, from.toLowerCase(), to.toLowerCase(), toBN(value).mul(toBN(multiplier)), rewardApplicableFrom, event.blockNumber)
    }
    // Conclude i.e. account for current liquidity providers
    Object.keys(state).forEach(account => {
        updateState(state, account, ZEROAddress, state[account].balance, rewardApplicableFrom, toBlock)
    })
}

function updateState(state, from, to, value, _rewardApplicableFrom, blockNumber) {
    if (from != ZEROAddress) {
        if (!state[from]) {
            state[from] = { balance: toBN(0), blockNumber: 0 }
        }

        let rewardApplicableFrom = Math.max(state[from].blockNumber, _rewardApplicableFrom)

        // 1. Increment score for sender
        if (blockNumber > rewardApplicableFrom) {
            score[from] = (score[from] || toBN(0))
                .add(state[from].balance
                        .mul(toBN(safeSub(blockNumber, rewardApplicableFrom))))
        }

        // 2. Update state for sender
        state[from] = { balance: safeSubBN(state[from].balance, value), blockNumber: blockNumber }
    }

    if (to != ZEROAddress) {
        if (!state[to]) {
            state[to] = { balance: toBN(0), blockNumber: 0 }
        }
        // 3. Increment score for receiver
        let rewardApplicableFrom = Math.max(state[to].blockNumber, _rewardApplicableFrom)
        if (blockNumber > rewardApplicableFrom) {
            score[to] = (score[to] || toBN(0))
                .add(state[to].balance
                    .mul(toBN(safeSub(blockNumber, rewardApplicableFrom))))
        }

        // 4. Update state for receiver
        state[to] = { balance: state[to].balance.add(value), blockNumber: blockNumber }
    }
}

function safeSubBN(a, b) {
    a = toBN(a)
    b = toBN(b)
    if (a.lt(b)) throw new Error(`a < b: ${a.toString()} < ${b.toString()}`)
    return a.sub(b)
}

function safeSub(a, b) {
    if (a < b) throw new Error(`a < b: ${a} < ${b}`)
    return a-b
}

execute().then()
