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
            Logger.info('Verification in progress. Keeping smooth humanizer active...');
            // Do NOT stop humanizer. Movement is required.
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

    // --- Smooth Look Logic ---
    async smoothLook(targetYaw, targetPitch, duration = 600) {
        if (!this.bot || !this.bot.entity) return;

        const startYaw = this.bot.entity.yaw;
        const startPitch = this.bot.entity.pitch;

        // Handle Yaw wrap-around (shortest path)
        let deltaYaw = targetYaw - startYaw;
        while (deltaYaw < -Math.PI) deltaYaw += 2 * Math.PI;
        while (deltaYaw > Math.PI) deltaYaw -= 2 * Math.PI;

        const startTime = Date.now();

        return new Promise((resolve) => {
            const step = () => {
                if (!this.bot || !this.bot.entity) {
                    resolve();
                    return;
                }

                const elapsed = Date.now() - startTime;
                if (elapsed >= duration) {
                    this.bot.look(startYaw + deltaYaw, targetPitch, true).catch(() => { });
                    resolve();
                    return;
                }

                // Easing function (Quadratic Ease-Out for natural feel)
                const t = elapsed / duration;
                const ease = t * (2 - t);

                const newYaw = startYaw + (deltaYaw * ease);
                const newPitch = startPitch + ((targetPitch - startPitch) * ease);

                this.bot.look(newYaw, newPitch, true).catch(() => { });
                setTimeout(step, 50); // ~20 ticks per second updates
            };
            step();
        });
    }

    // --- Humanizer ---

    startHumanizer() {
        if (!config.bot.humanizer.enabled) return;
        this.stopHumanizer();

        Logger.info('Starting Advanced Humanizer (Smooth Mode)...');

        // 1. Micro Jitter (Kept but smoother)
        /*
        if (config.bot.humanizer.microJitter && config.bot.humanizer.microJitter.enabled) {
             // ... kept same or reduced? 
             // Actually, micro-jitter is better handled by just adding noise to smooth looks.
             // But for idle, let's keep a very slow drift instead of "jitter".
        }
        */

        // 2. Breathing (DISABLED for stability)
        /*
        if (config.bot.humanizer.breathing && config.bot.humanizer.breathing.enabled) {
            let breathDir = 1;
            const breathTask = () => {
                if (!this.bot || !this.bot.entity) return;

                const amount = config.bot.humanizer.breathing.amount;
                const newPitch = this.bot.entity.pitch + (amount * breathDir);
                
                this.bot.look(this.bot.entity.yaw, newPitch, true).catch(() => {});
                
                breathDir *= -1; // Inhale/Exhale
                
            this.flyingInterval = setTimeout(breathTask, config.bot.humanizer.breathing.interval);
            };
            breathTask();
        }
        */

        // 3. Realistic Actions (RESTORED but using smoothLook)
        const actionTask = async () => {
            if (!this.bot || !this.bot.entity) return;
            const rand = Math.random();

            // Dynamic intervals 
            let nextActionDelay = config.bot.humanizer.actionInterval * (0.8 + Math.random() * 1.5);

            if (rand < 0.6) {
                // 60% - Casual Look Around
                const yawChange = (Math.random() - 0.5) * (Math.PI / 1.5); // ~60 degrees
                const pitchChange = (Math.random() - 0.5) * (Math.PI / 3); // ~30 degrees

                const targetYaw = this.bot.entity.yaw + yawChange;
                const targetPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.bot.entity.pitch + pitchChange));

                // Look takes 0.5 - 1.5 seconds
                await this.smoothLook(targetYaw, targetPitch, 500 + Math.random() * 1000);
            }
            else if (rand < 0.8) {
                // 20% - Arm Swing
                const swings = Math.floor(Math.random() * 2) + 1;
                const swingInternal = () => {
                    try { this.bot.swingArm(); } catch (e) { }
                };
                for (let i = 0; i < swings; i++) {
                    setTimeout(swingInternal, i * (150 + Math.random() * 100));
                }
                nextActionDelay = 1000;
            }
            else {
                // 20% - Inventory/Bored Check (Look slightly down)
                const targetPitch = (Math.random() * 0.3) + 0.2; // Look down 0.2-0.5 rads
                await this.smoothLook(this.bot.entity.yaw, targetPitch, 800);
            }

            // Schedule next
            this.actionInterval = setTimeout(actionTask, nextActionDelay);
        };
        actionTask();
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
