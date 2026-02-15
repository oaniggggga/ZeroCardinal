const mineflayer = require('mineflayer');
const EventEmitter = require('events');
const Logger = require('../utils/Logger');
const config = require('../config/default.json');
const MouseRecorder = require('../utils/MouseRecorder');
const SpookyRotation = require('../utils/SpookyRotation');
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
            this.bot.physicsEnabled = true; // User request: Physics ALWAYS on
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

        this.bot.on('forcedMove', () => {
            Logger.info('Server forced rotation. Yielding control for 2s...');

            // Pause custom rotation to respect server authority
            this.rotationPaused = true;
            if (this.rotationPauseTimeout) clearTimeout(this.rotationPauseTimeout);
            this.rotationPauseTimeout = setTimeout(() => {
                this.rotationPaused = false;
                Logger.info('Resuming Spookytime rotation.');
            }, 2000);

            // Sync SpookyRotation state to accept server's authority
            if (this.bot.entity) {
                const yawDeg = (this.bot.entity.yaw * 180) / Math.PI;
                const pitchDeg = (this.bot.entity.pitch * 180) / Math.PI;
                SpookyRotation.rotate.x = yawDeg;
                SpookyRotation.rotate.y = pitchDeg;
                SpookyRotation.lastYaw = 0;
                SpookyRotation.lastPitch = 0;
            }

            if (MouseRecorder.isPlaying(this.bot)) {
                Logger.info('Stopping Mouse Recorder to comply.');
                MouseRecorder.stop(this.bot);
            }
        });

        this.bot.on('end', () => {
            this.ready = false;
            Logger.warn('Connection closed.');
            // Mimic stops itself on 'end'
            MouseRecorder.stop(this.bot);
            this._stopVerificationActionRandomizer();
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
            MouseRecorder.stop(this.bot);
            this._stopVerificationActionRandomizer();
            this.verificationStrafeDone = false; // Reset for next time

            setTimeout(() => this.chat(config.bot.serverJoinCommand || '/an401'), 2000);
        }

        if (text.includes('Идёт проверка') || text.includes('проверка, пожалуйста, подождите')) {
            Logger.info('Verification: PHYSICS ONLY + SLOT RANDOMIZER...');
            this.bot.physicsEnabled = true;
            if (this.bot.mimic) this.bot.mimic.stop();
            MouseRecorder.stop(this.bot); // Ensure recorder is stopped
            this._startVerificationActionRandomizer();
        }

        if (text.includes('Вы провалили проверку')) {
            Logger.error('FAILED VERIFICATION! Bot was kicked.');
            this._stopVerificationActionRandomizer();
        }
    }

    _startVerificationActionRandomizer() {
        if (this.actionRandomizerInterval) return;
        Logger.info('Starting Spookytime Humanizer (Rotation + Actions)...');

        // 1. Rotation Loop (Every 50ms / 1 tick)
        this.rotationInterval = setInterval(() => {
            if (!this.bot || !this.bot.entity) return;

            // Virtual Target: Look down and slightly forward (to check landing)
            // Offset: x=0.5, y=-2.0, z=0.5 (Ground in front)
            const targetPos = this.bot.entity.position.offset(0.5, -3.0, 0.5);

            // Calculate Next Rotation using Spooky Logic
            const nextRot = SpookyRotation.getNextRotation(this.bot, targetPos);

            if (nextRot) {
                // Apply rotation
                this.bot.look(nextRot.yaw, nextRot.pitch, true); // Force = true to snap (since we calculated steps)
            }
        }, 50);

        // 2. Action Loop (Random delays)
        const performRandomAction = () => {
            if (!this.bot) return;

            const rand = Math.random();
            const delay = 300 + Math.random() * 1200; // 0.3s - 1.5s

            // Action Weights:
            // 0.0 - 0.3: Switch Slot (30%)
            // 0.3 - 0.6: Swing Arm (30%)
            // 0.6 - 0.7: Open Inventory (10%)
            // 0.7 - 0.8: Sneak (10%)
            // 0.8 - 1.0: Idle (20%)

            try {
                if (rand < 0.3) {
                    // Switch Slot
                    const slot = Math.floor(Math.random() * 9);
                    this.bot.setQuickBarSlot(slot);
                } else if (rand < 0.6) {
                    // Swing Arm
                    this.bot.swingArm();
                } else if (rand < 0.7) {
                    // Open Inventory Packet (Client Command 1)
                    this.bot._client.write('client_command', { actionId: 1 });
                } else if (rand < 0.8) {
                    // Sneak
                    this.bot.setControlState('sneak', true);
                    setTimeout(() => { if (this.bot) this.bot.setControlState('sneak', false); }, 100 + Math.random() * 100);
                }
            } catch (e) { }

            this.actionRandomizerInterval = setTimeout(performRandomAction, delay);
        };

        performRandomAction();
    }

    _stopVerificationActionRandomizer() {
        if (this.rotationInterval) {
            clearInterval(this.rotationInterval);
            this.rotationInterval = null;
        }
        if (this.actionRandomizerInterval) {
            clearTimeout(this.actionRandomizerInterval);
            this.actionRandomizerInterval = null;
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

    // --- Packet-Level Humanizer (Exact User Copy) ---
    _attachVanillaMimic() {
        const bot = this.bot;
        if (bot.mimic) return;

        const state = { timeouts: [], flyingTicker: null, active: false };

        function stop() {
            for (const t of state.timeouts) clearTimeout(t);
            state.timeouts.length = 0;
            if (state.flyingTicker) { clearInterval(state.flyingTicker); state.flyingTicker = null; }
            state.active = false;
        }

        function schedule(fn, delay) {
            const t = setTimeout(() => {
                const idx = state.timeouts.indexOf(t);
                if (idx !== -1) state.timeouts.splice(idx, 1);
                try { fn(); } catch { }
            }, delay);
            state.timeouts.push(t);
        }

        function sendArm(hand) {
            if (!bot?._client || bot._client.ended) return;
            try { bot._client.write('arm_animation', { hand }); } catch { }
        }

        function sendFlying() {
            if (!bot?._client || bot._client.ended) return;
            const onGround = !!bot.entity?.onGround;
            try { bot._client.write('flying', { onGround }); } catch { }
        }

        function start() {
            if (state.active) return;
            stop();
            state.active = true;

            const jitter = Math.floor(Math.random() * 30);
            schedule(() => sendArm(0), 280 + jitter);
            schedule(() => sendArm(1), 320 + jitter);
            schedule(sendFlying, 420 + jitter);
            schedule(sendFlying, 480 + jitter);
            schedule(sendFlying, 540 + jitter);

            const flyingInterval = 760 + Math.floor(Math.random() * 80);
            state.flyingTicker = setInterval(sendFlying, flyingInterval);

            Logger.info('[Mimic] Started packet-level emulation.');
        }

        function hover() {
            // Stop arm animations but KEEP flying packets (Heartbeat)
            for (const t of state.timeouts) clearTimeout(t);
            state.timeouts.length = 0;

            if (!state.flyingTicker) {
                const flyingInterval = 760 + Math.floor(Math.random() * 80);
                state.flyingTicker = setInterval(sendFlying, flyingInterval);
            }
            Logger.info('[Mimic] Hover mode: Keeping connection alive.');
        }

        bot.mimic = { start, stop, hover };

        bot.__mimicEnabled = true;

        bot.on('login', () => setTimeout(() => { try { if (bot.__mimicEnabled) bot.mimic?.start(); } catch { } }, 200));
        bot.on('spawn', () => { try { if (bot.__mimicEnabled) bot.mimic?.start(); } catch { } });
        bot.on('kicked', () => { try { bot.mimic?.stop(); } catch { } });
        bot.on('end', () => { try { bot.mimic?.stop(); } catch { } });
    }
}

module.exports = new MinecraftService();
