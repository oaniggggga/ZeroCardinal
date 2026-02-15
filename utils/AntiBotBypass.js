
let flyingTicker = null
let mimicTimeouts = []
let mimicActive = false
let botReference = null // To hold the bot instance

function stopVanillaMimicTimers() {
    for (const t of mimicTimeouts) clearTimeout(t)
    mimicTimeouts = []
    if (flyingTicker !== null) {
        clearInterval(flyingTicker)
        flyingTicker = null
    }
    mimicActive = false
}

function startVanillaMimicTimers() {
    if (mimicActive) return
    stopVanillaMimicTimers()
    mimicActive = true

    const bot = botReference
    // const swingDelay = 430 + Math.floor(Math.random() * 70) // unused in user code logic but present in var decl
    const jitter = Math.floor(Math.random() * 30)
    const schedule = (fn, delay) => {
        const t = setTimeout(() => {
            mimicTimeouts = mimicTimeouts.filter((id) => id !== t)
            fn()
        }, delay)
        mimicTimeouts.push(t)
    }

    const sendArm = (hand) => {
        if (!bot?._client || bot._client.ended) return
        try {
            console.log(`[bot] vanilla-mimic arm -> ${hand}`)
            bot._client.write('arm_animation', { hand })
        } catch (err) {
            console.log('[bot] vanilla-mimic arm error', err)
        }
    }

    const sendFlying = () => {
        if (!bot?._client || bot._client.ended) return
        const onGround = !!bot.entity?.onGround
        try {
            console.log('[bot] vanilla-mimic flying ->', onGround)
            bot._client.write('flying', { onGround })
        } catch (err) {
            console.log('[bot] vanilla-mimic flying error', err)
        }
    }

    schedule(() => sendArm(0), 280 + jitter)
    schedule(() => sendArm(1), 320 + jitter)

    schedule(sendFlying, 420 + jitter)
    schedule(sendFlying, 480 + jitter)
    schedule(sendFlying, 540 + jitter)

    const flyingInterval = 760 + Math.floor(Math.random() * 80)
    flyingTicker = setInterval(sendFlying, flyingInterval)
}

function bind(bot) {
    botReference = bot

    bot.on('login', () => {
        console.log(`[bot] login ok`)
        setTimeout(() => {
            if (!mimicActive) startVanillaMimicTimers()
        }, 200)
    })

    bot.on('spawn', () => {
        console.log(`[bot] spawn`)
        startVanillaMimicTimers()
    })

    // Preserving original logging but maybe we should use the project's Logger? 
    // For "fully copy", I'll stick to console.log or map it to Logger if I can, but user asked to COPY.
    // I will use console.log as requested, or maybe redirect to the Logger in the service file if I want to be cleaner.
    // However, I'll stick to the logic flow.

    bot.on('kicked', (reason) => {
        console.log(`[bot] kicked: ${reason}`)
        stopVanillaMimicTimers()
    })

    bot.on('end', (reason) => {
        console.log(`[bot] end: ${reason}`)
        stopVanillaMimicTimers()
    })
}

module.exports = {
    bind
}
