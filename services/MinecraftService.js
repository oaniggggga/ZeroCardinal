const mineflayer = require('mineflayer');
const EventEmitter = require('events');
const Logger = require('../utils/Logger');
const config = require('../config/default.json');
// Dynamic import for bot config (since it might be in config.json in root if not fully migrated, but I'll use the one I created or load from root if needed.
// For now, I'll assume config/default.json has the structure, but wait, I didn't put the credentials there to avoid hardcoding secrets in potential git artifacts if this was a real repo.
// I should load the root config.json for credentials.
const rootConfig = require('../config.json');

class MinecraftService extends EventEmitter {
    constructor() {
        super();
        this.bot = null;
        this.reconnectTimeout = null;

        // Humanizer state
        this.jitterInterval = null;
        this.actionInterval = null;
        this.flyingInterval = null;
        this.mimicTimeouts = [];

        this.ready = false;
    }

    createBot() {
        this.ready = false;
        Logger.info('Connecting to server...');
        this.bot = mineflayer.createBot({
            host: rootConfig.bot.host,
            port: rootConfig.bot.port,
            username: rootConfig.bot.username,
            version: rootConfig.bot.version,
            password: rootConfig.bot.password, // Added password here just in case it's needed for auth immediately or via plugins
            hideErrors: true
        });

        this._bindEvents();
    }

    _bindEvents() {
        this.bot.on('login', () => {
            Logger.info(`Bot ${this.bot.username} logged in.`);
            this.emit('login');
            // this.startHumanizer(); // Moved to auth success to avoid moving in lobby/verification
        });

        this.bot.on('spawn', () => {
            Logger.info('Bot spawned.');
            this.ready = true;
            this.emit('spawn');
            // _emulateLookAround removed to prevent kicks on join
        });

        this.bot.on('error', (err) => {
            Logger.error(`Bot error: ${err.message || err}`);
            if (err.code === 'ECONNRESET') {
                Logger.warn('Connection reset. Reconnecting...');
            }
        });

        this.bot.on('kicked', (reason) => {
            this.ready = false;
            Logger.warn(`Bot kicked: ${reason}`);
            this.emit('kicked', reason);
        });

        this.bot.on('end', () => {
            this.ready = false;
            Logger.warn('Connection closed.');
            this.stopHumanizer();
            this.emit('end');

            // Auto reconnect
            setTimeout(() => {
                Logger.info('Reconnecting...');
                this.createBot();
            }, config.bot.reconnectInterval || 20000);
        });

        this.bot.on('message', (msg) => {
            const text = msg.toString().trim();
            if (!text) return;
            Logger.log('CHAT', text);
            this._handleAuth(text);
            this.emit('chat', text, msg);
        });
    }

    _handleAuth(text) {
        const lower = text.toLowerCase();
        if (lower.includes('/login') || lower.includes('/l ') || (lower.includes('авторизуйтесь') && lower.includes('пароль'))) {
            Logger.info('Auth required. Sending password...');
            this.chat(`/login ${rootConfig.bot.password}`);
        } else if (lower.includes('/register') || lower.includes('/reg ')) {
            Logger.info('Registration required. Registering...');
            this.chat(`/register ${rootConfig.bot.password} ${rootConfig.bot.password}`);
        }

        if ((text.includes('Успешная авторизация') || text.includes('Приятной игры'))) {
            Logger.info('Auth successful. Joining Anarchy 401...');
            setTimeout(() => this.chat(config.bot.serverJoinCommand || '/an401'), 2000);
            this.startHumanizer(); // Start here, not on login
        }

        if (text.includes('Идёт проверка') || text.includes('проверка, пожалуйста, подождите')) {
            Logger.warn('Verification in progress. Pausing humanizer...');
            this.stopHumanizer(); // MUST pause to avoid kick
        }

        if (text.includes('Вы провалили проверку')) {
            Logger.error('FAILED VERIFICATION! Bot was kicked.');
        }
    }

    chat(message) {
        if (this.bot && this.bot._client && !this.bot._client.ended) {
            this.bot.chat(message);
        }
    }

    async getBalance() {
        // Cache balance for 10 seconds to prevent spam
        if (this._balanceCache && (Date.now() - this._balanceLastUpdate < 10000)) {
            return this._balanceCache;
        }

        return new Promise((resolve) => {
            if (!this.bot || !this.ready) return resolve(0);
            const balanceCommand = config.bot.balanceCommand || '/bal';
            try {
                this.chat(balanceCommand);
            } catch (e) {
                return resolve(0);
            }

            const balanceHandler = (msg) => {
                const text = msg.toString();
                const moneyRegex = /(?:balance|баланс|деньги|средства|money|баксов):\s*\$?\s*([\d,.]+)/i;
                const match = text.match(moneyRegex);

                if (match) {
                    let balance = parseFloat(match[1].replace(/,/g, ''));
                    // balance = Math.floor(balance / 1000000) * 1000000; // Removed rounding as it might be confusing

                    this._balanceCache = balance;
                    this._balanceLastUpdate = Date.now();

                    this.bot.removeListener('message', balanceHandler);
                    resolve(balance);
                }
            };

            this.bot.on('message', balanceHandler);
            setTimeout(() => {
                this.bot.removeListener('message', balanceHandler);
                // Return cached value if available, or 0
                resolve(this._balanceCache || 0);
            }, 5000);
        });
    }

    // --- Humanizer ---

    startHumanizer() {
        if (!config.bot.humanizer.enabled) return;
        this.stopHumanizer();

        Logger.info('Starting Humanizer with Jitter...');

        // 1. Micro Jitter (Simulates hand trembling / mouse micro-movements)
        if (config.bot.humanizer.microJitter && config.bot.humanizer.microJitter.enabled) {
            const jitterTask = () => {
                if (!this.bot || !this.bot.entity) return;

                // Randomize interval slightly (+- 20%)
                const interval = config.bot.humanizer.microJitter.interval * (0.8 + Math.random() * 0.4);

                const amount = config.bot.humanizer.microJitter.amount;
                const yawJitter = (Math.random() - 0.5) * amount;
                const pitchJitter = (Math.random() - 0.5) * amount;

                // Smoothly apply or just set? Set is fine for micro jitter.
                const newYaw = this.bot.entity.yaw + yawJitter;
                const newPitch = this.bot.entity.pitch + pitchJitter;

                this.bot.look(newYaw, newPitch, true).catch(() => { });

                this.jitterInterval = setTimeout(jitterTask, interval);
            };
            jitterTask();
        }

        // 2. Breathing (Slow, rhythmic pitch movement)
        if (config.bot.humanizer.breathing && config.bot.humanizer.breathing.enabled) {
            let breathDir = 1;
            const breathTask = () => {
                if (!this.bot || !this.bot.entity) return;

                const amount = config.bot.humanizer.breathing.amount;
                // Slowly change pitch up and down
                const newPitch = this.bot.entity.pitch + (amount * breathDir);

                // Reverse direction occasionally or based on limit? 
                // Simple version: just oscillate small amount around "center" - but we don't know center.
                // Just add small drift, but user corrects it. 
                // Let's just do random very slow drift.

                this.bot.look(this.bot.entity.yaw, newPitch, true).catch(() => { });

                breathDir *= -1; // Inhale/Exhale

                this.flyingInterval = setTimeout(breathTask, config.bot.humanizer.breathing.interval);
            };
            breathTask();
        }

        // 3. Realistic Actions (No jumping, emphasizes arm/head)
        const actionTask = () => {
            if (!this.bot || !this.bot.entity) return;
            const rand = Math.random();

            // Dynamic intervals for unpredictability
            let nextActionDelay = config.bot.humanizer.actionInterval * (0.5 + Math.random() * 1.5);

            if (rand < 0.4) {
                // 40% - Casual Look Around (Simulate checking environment)
                // Smoothly look at a new target within 30-60 degrees yaw, 10-20 degrees pitch
                const yawChange = (Math.random() - 0.5) * (Math.PI / 2);
                const pitchChange = (Math.random() - 0.5) * (Math.PI / 4);

                this.bot.look(this.bot.entity.yaw + yawChange, this.bot.entity.pitch + pitchChange, true).catch(() => { });
            }
            else if (rand < 0.7) {
                // 30% - Arm Swing (Punching air / clicking)
                // Sometimes click once, sometimes spam 2-3 times (like hitting a block or player)
                const swings = Math.floor(Math.random() * 3) + 1;
                const swingInternal = () => {
                    try { this.bot.swingArm(); } catch (e) { }
                };

                for (let i = 0; i < swings; i++) {
                    setTimeout(swingInternal, i * (150 + Math.random() * 100)); // ~5-7 CPS speed simulation
                }
                nextActionDelay = 1000; // Reset quicker after swinging
            }
            else if (rand < 0.85) {
                // 15% - "Bored" / Inventory check (Look down at feet/chest)
                const currentYaw = this.bot.entity.yaw;
                const lookDownPitch = -Math.PI / 6; // slightly down, not fully
                this.bot.look(currentYaw, lookDownPitch, true).catch(() => { });
            }
            else {
                // 15% - Head Shake / Nod (Communicating "No" or "Yes" or just fidgeting)
                // Let's do a quick small shake
                const startYaw = this.bot.entity.yaw;
                const startPitch = this.bot.entity.pitch;

                const shakeAmount = 0.2;
                const isNod = Math.random() > 0.5;

                let step = 0;
                const shakeInterval = setInterval(() => {
                    step++;
                    if (step > 4) {
                        clearInterval(shakeInterval);
                        // Return roughly to start or stay? Stay is more human (distracted)
                        return;
                    }

                    if (isNod) {
                        // Pitch up/down
                        const dir = step % 2 === 0 ? 1 : -1;
                        this.bot.look(startYaw, startPitch + (shakeAmount * dir), true).catch(() => { });
                    } else {
                        // Yaw left/right
                        const dir = step % 2 === 0 ? 1 : -1;
                        this.bot.look(startYaw + (shakeAmount * dir), startPitch, true).catch(() => { });
                    }
                }, 80); // Fast shake

                nextActionDelay = 2000;
            }

            // Schedule next action
            this.actionInterval = setTimeout(actionTask, nextActionDelay);
        };
        actionTask(); // Start action loop
    }

    stopHumanizer() {
        if (this.jitterInterval) clearTimeout(this.jitterInterval); // Now it's a timeout
        if (this.actionInterval) clearTimeout(this.actionInterval); // Now it's a timeout
        if (this.flyingInterval) clearTimeout(this.flyingInterval);
        this.mimicTimeouts.forEach(clearTimeout);
        this.mimicTimeouts = [];
        this.jitterInterval = null;
        this.actionInterval = null;
        this.flyingInterval = null;
    }
}

module.exports = new MinecraftService();
