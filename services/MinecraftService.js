const mineflayer = require('mineflayer');
const EventEmitter = require('events');
const Logger = require('../utils/Logger');
const config = require('../config/default.json');
// Dynamic import for bot config (since it might be in config.json in root if not fully migrated, but I'll use the one I created or load from root if needed.
// For now, I'll assume config/default.json has the structure, but wait, I didn't put the credentials there to avoid hardcoding secrets in potential git artifacts if this was a real repo.
// I should load the root config.json for credentials.
const rootConfig = require('../config.json');
const AntiBotBypass = require('../utils/AntiBotBypass');

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
            password: rootConfig.bot.password,
            auth: 'offline',
            brand: 'vanilla',
            viewDistance: 'normal',
            enableTextFiltering: true,
            hideErrors: false // Changed to false to help troubleshooting
        });

        this._bindEvents();
        AntiBotBypass.bind(this.bot);
    }

    _bindEvents() {
        this.bot.on('login', () => {
            Logger.info(`Bot ${this.bot.username} logged in.`);
            this.emit('login');
            // this.startHumanizer(); // Moved to auth success to avoid moving in lobby/verification
        });

        // on 'spawn' moved below to merge with jitter logic
        // this.bot.on('spawn', ... );

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

        this.bot.on('forcedMove', () => {
            // ACK Strategy: Server turned -> We MUST respond with look packet in next tick
            // Vanilla behavior: Accept pos/look, then sending look packet with tiny jitter
            Logger.info('Server forced rotation. ACKing with micro-jitter.');

            // We don't need to do anything manually if we are sending look packets every tick via jitter loop.
            // But to be safe, we can force an update to internal state.
            // Mineflayer handles the 'forcedMove' packet by updating bot.entity.yaw/pitch automatically.
            // We just need to ensure our jitter loop picks it up.
        });

        this.bot.on('spawn', () => {
            Logger.info('Bot spawned.');
            this.ready = true;
            this.bot.physicsEnabled = true; // User request: Physics ALWAYS on
            this.emit('spawn');

            // Start Always-On Micro-Jitter (The "Noisy Client")
            // this._startMicroJitter();
            // Start Dumb Actions in background
            // this._startDumbVerification();
        });

        this.bot.on('end', () => {
            this.ready = false;
            Logger.warn('Connection closed.');
            // this._stopDumbVerification();
            // this._stopMicroJitter();
            this.verificationStrafeDone = false;
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
            Logger.chat(text); // Dedicated chat log file
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

            // Stop Mimic
            if (this.bot.__mimicEnabled) {
                this.bot.__mimicEnabled = false;
                this.bot.mimic?.stop?.();
                Logger.info('[Mimic] Stopped on successful auth.');
            }

            // Stop Mouse Playback
            // this._stopDumbVerification();
            // this._stopMicroJitter();
            this.verificationStrafeDone = false; // Reset for next time

            setTimeout(() => this.chat(config.bot.serverJoinCommand || '/an401'), 2000);
        }

        if (text.includes('Идёт проверка') || text.includes('проверка, пожалуйста, подождите')) {
            Logger.info('Verification: PASSIVE (Jitter + Dumb Actions running)...');
            // Logic is already running since spawn
        }

        if (text.includes('Вы провалили проверку')) {
            Logger.error('FAILED VERIFICATION! Bot was kicked.');
            Logger.error('FAILED VERIFICATION! Bot was kicked.');
            // this._stopDumbVerification();
            // this._stopMicroJitter();
        }
    }

    _startMicroJitter() {
        if (this.jitterInterval) return;
        Logger.info('Starting Micro-Jitter (Always-On Noise)...');

        this.jitterInterval = setInterval(() => {
            if (!this.bot || !this.bot.entity) return;

            // Get current rotation
            const currentYaw = this.bot.entity.yaw;
            const currentPitch = this.bot.entity.pitch;

            // Add tiny noise (floating point error simulation)
            // Magnitude: 0.0001 - 0.0005 rad
            const yawNoise = (Math.random() - 0.5) * 0.0005;
            const pitchNoise = (Math.random() - 0.5) * 0.0005;

            // Send look packet
            // force=true guarantees packet sending even if difference is small
            this.bot.look(currentYaw + yawNoise, currentPitch + pitchNoise, true);

        }, 50); // Every tick
    }

    _stopMicroJitter() {
        if (this.jitterInterval) {
            clearInterval(this.jitterInterval);
            this.jitterInterval = null;
        }
    }

    _startDumbVerification() {
        if (this.dumbVerificationTimeout) return;
        Logger.info('Starting "Dumb" Verification Mode (Rare Inputs + Long Pauses)...');

        const performDumbAction = () => {
            if (!this.bot) return;

            // Random Interval: 5s - 12s (5000 - 12000 ms)
            let nextDelay = 5000 + Math.random() * 7000;

            const rand = Math.random();

            try {
                if (rand < 0.1) {
                    // 10% Chance: Long Pause (15-25s) "Human Idle"
                    Logger.info('[Dumb] Doing nothing for 15-25s...');
                    nextDelay = 15000 + Math.random() * 10000;
                } else if (rand < 0.2) {
                    // 10% Chance: "Human Fail" (Double action?) - actually user said "sometimes 2 actions with 50ms pause"
                    // Let's keep it simple: Just swing (or sneak) twice?
                    // Implementing: Short Sneak
                    this.bot.setControlState('sneak', true);
                    setTimeout(() => { if (this.bot) this.bot.setControlState('sneak', false); }, 80 + Math.random() * 60);
                } else if (rand < 0.6) {
                    // 40% Chance: Single Swing
                    this.bot.swingArm();
                } else {
                    // 40% Chance: Short Sneak (80-140ms)
                    this.bot.setControlState('sneak', true);
                    setTimeout(() => { if (this.bot) this.bot.setControlState('sneak', false); }, 80 + Math.random() * 60);
                }
            } catch (e) { }

            this.dumbVerificationTimeout = setTimeout(performDumbAction, nextDelay);
        };

        // Start first action after initial delay
        this.dumbVerificationTimeout = setTimeout(performDumbAction, 2000 + Math.random() * 3000);
    }

    _stopDumbVerification() {
        if (this.dumbVerificationTimeout) {
            clearTimeout(this.dumbVerificationTimeout);
            this.dumbVerificationTimeout = null;
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
                // More robust regex for balance
                const moneyRegex = /(?:balance|баланс|деньги|средства|money|баксов|На счету|Счет|Ваш баланс):\s*\$?\s*([\d,.]+)/i;
                const match = text.match(moneyRegex);

                if (match) {
                    let balance = parseFloat(match[1].replace(/,/g, ''));
                    Logger.info(`Parsed balance: ${balance} from "${text}"`);

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

    // --- Packet-Level Humanizer (Exact User Copy) ---
    // _attachVanillaMimic removed in favor of utils/AntiBotBypass.js
}

module.exports = new MinecraftService();
