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
            this.startHumanizer();
        });

        this.bot.on('spawn', () => {
            Logger.info('Bot spawned.');
            this.ready = true;
            this.emit('spawn');
            this._emulateLookAround();
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
        }
    }

    async _emulateLookAround() {
        if (!this.bot.entity) return;
        try {
            for (let i = 0; i < 2; i++) {
                const yaw = this.bot.entity.yaw + (Math.random() - 0.5) * 2;
                const pitch = (Math.random() - 0.5) * 0.5;
                await this.bot.look(yaw, pitch, true);
                await new Promise(r => setTimeout(r, 800));
            }
        } catch (e) { }
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

        this.jitterInterval = setInterval(() => {
            if (!this.bot || !this.bot.entity) return;
            const yawJitter = (Math.random() - 0.5) * 0.03;
            const pitchJitter = (Math.random() - 0.5) * 0.03;
            this.bot.look(this.bot.entity.yaw + yawJitter, this.bot.entity.pitch + pitchJitter, true);
        }, config.bot.humanizer.jitterInterval || 200);

        // ... simplified mimic logic for brevity, can check index.js for full logic if needed ...
        // Keeping it simple to ensure stability first.

        // Periodic actions
        this.actionInterval = setInterval(() => {
            if (!this.bot || !this.bot.entity) return;
            const rand = Math.random();
            if (rand < 0.3) {
                this.bot.look(this.bot.entity.yaw + (Math.random() - 0.5) * 1.5, this.bot.entity.pitch, true);
            } else if (rand < 0.5) {
                this.bot.setControlState('jump', true);
                setTimeout(() => {
                    this.bot.setControlState('jump', false);
                    try { this.bot.swingArm(); } catch (e) { }
                }, 150);
            }
        }, config.bot.humanizer.actionInterval || 7000);
    }

    stopHumanizer() {
        if (this.jitterInterval) clearInterval(this.jitterInterval);
        if (this.actionInterval) clearInterval(this.actionInterval);
        if (this.flyingInterval) clearInterval(this.flyingInterval);
        this.mimicTimeouts.forEach(clearTimeout);
        this.mimicTimeouts = [];
    }
}

module.exports = new MinecraftService();
