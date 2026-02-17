const path = require('path');
const MinecraftService = require('../services/MinecraftService');
const DatabaseManager = require('../managers/DatabaseManager');
const Logger = require('../utils/Logger');
const { Order, OrderQueue } = require('../managers/Order');
const MinecraftValidator = require('../utils/MinecraftValidator');
const config = require('../config/default.json');
const rootConfig = require('../config.json');
const SocketService = require('../services/SocketService');

class OrderManager {
    // ... constructor ...
    constructor() {
        this.orderQueue = new OrderQueue();
        this.dialogStates = new Map();
        this.guestWelcomeSent = new Set();
        this.isProcessing = false;
        this.isPolling = false; // Prevents overlapping poll loops
        this.isCheckingMessages = false; // Locking for message processing
        this.isCheckingOrders = false; // Locking for order processing
        this.pollInterval = null;
    }

    getStats() {
        return this.orderQueue.getStats();
    }

    async start() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        Logger.info('OrderManager started (DB Mode + Socket)');

        DatabaseManager.init();
        await this.loadState();

        // Start polling loop (backup)
        this.pollInterval = setInterval(() => this.pollLoop(), config.orders.pollInterval || 2000);

        // Listen for Socket signals
        SocketService.on('order', () => {
            Logger.info('Socket Signal: New Order');
            this.checkNewOrders();
        });

        SocketService.on('message', () => {
            Logger.info('Socket Signal: New Message');
            this.checkMessages();
        });

    }

    async pollLoop() {
        if (this.isPolling) return; // Skip if previous loop hasn't finished
        this.isPolling = true;
        try {
            await this.syncLegacyOrders();
            await this.checkNewOrders();
            await this.checkMessages();
        } catch (e) {
            Logger.error('Error in poll loop:', e);
        } finally {
            this.isPolling = false;
        }
    }

    async syncLegacyOrders() {
        const fs = require('fs');
        const ordersPath = path.join(__dirname, '..', config.paths.sharedDir, 'orders.json');
        if (!fs.existsSync(ordersPath)) return;

        try {
            const data = fs.readFileSync(ordersPath, 'utf8');
            const orders = JSON.parse(data);
            for (const order of orders) {
                if (!DatabaseManager.getOrder(order.id)) {
                    Logger.info(`Syncing legacy/manual order: #${order.id}`);
                    DatabaseManager.createOrder({
                        id: order.id,
                        username: order.username,
                        amount: order.amount,
                        description: order.description,
                        status: order.status || 'pending',
                        createdAt: order.timestamp * 1000 || Date.now(),
                        updatedAt: Date.now()
                    });
                } else {
                    // Update existing order if details changed in JSON (for manual adjustments)
                    DatabaseManager.updateOrder(order.id, {
                        username: order.username,
                        amount: order.amount,
                        description: order.description,
                        status: order.status
                    });
                }
            }
        } catch (e) {
            Logger.error('Error syncing orders.json:', e);
        }
    }

    async loadState() {
        const dialogs = DatabaseManager.getAllDialogs();
        for (const d of dialogs) {
            const orderData = d.data;
            const order = new Order(orderData.id, orderData.username, orderData.amount, orderData.description);
            Object.assign(order, orderData);
            this.dialogStates.set(d.order_id, { step: d.step, order });

            // Restore to queue
            if (!this.orderQueue.findOrder(order.id)) {
                this.orderQueue.add(order);
            }

            // Proactively remind the user that the bot is back and waiting
            const reminder = `👋 Я снова в сети! Ваш заказ #${order.id} в обработке.\n\n📍 Напоминаю: вы должны быть на режиме "Anarchy 401".\n${order.nickname ? `Выдаем на ник: **${order.nickname}**? (Да/Нет)` : 'Пожалуйста, введите ваш ник в Minecraft:'}`;
            this.sendFunPayMessage(order.username, reminder, order.id);
        }

        const pendingOrders = DatabaseManager.getPendingOrders();
        for (const row of pendingOrders) {
            if (!this.dialogStates.has(row.id) && !this.orderQueue.findOrder(row.id)) {
                const order = new Order(row.id, row.username, row.amount, row.description);
                order.status = row.status;
                order.nickname = row.nickname;
                order.createdAt = row.created_at;
                this.orderQueue.add(order);
            }
        }

        Logger.info(`Loaded ${this.dialogStates.size} dialogs and ${this.orderQueue.queue.length + (this.orderQueue.current ? 1 : 0)} pending orders`);

        // Resolve deadlock: If there is a current order in queue but no dialog state, start it.
        const current = this.orderQueue.getCurrent();
        if (current && !this.dialogStates.has(current.id)) {
            Logger.info(`Starting dialog for current order #${current.id} found after loadState`);
            this.startOrderDialog(current);
        }
    }

    formatMessage(template, vars) {
        return template.replace(/\$\{(\w+)\}/g, (_, key) => vars[key] !== undefined ? vars[key] : _);
    }

    async checkNewOrders() {
        if (this.isCheckingOrders) return;
        this.isCheckingOrders = true;
        try {
            const pendingOrders = DatabaseManager.getPendingOrders();
            for (const row of pendingOrders) {
                const existingInDialog = this.dialogStates.get(row.id);
                const existingInQueue = this.orderQueue.findOrder(row.id);

                if (existingInDialog) {
                    if (existingInDialog.order.username !== row.username) {
                        Logger.info(`Order #${row.id} username changed in DB: ${existingInDialog.order.username} -> ${row.username}. Updating in-memory state and notifying.`);
                        existingInDialog.order.username = row.username;

                        // Notify user about the name change recognition
                        const msg = `✅ Имя покупателя обновлено: **${row.username}**.\n\n📍 Напоминаю: для выдачи вы должны быть на режиме "Anarchy 401".\nЕсли всё верно, напишите "Да" или новый ник.`;
                        this.sendFunPayMessage(row.username, msg, row.id);
                    }
                    continue;
                }

                if (existingInQueue) {
                    if (existingInQueue.username !== row.username) {
                        Logger.info(`Order #${row.id} username changed in DB: ${existingInQueue.username} -> ${row.username}. Updating queue.`);
                        existingInQueue.username = row.username;
                    }

                    // Resolve deadlock: If order is in queue and is CURRENT but has no dialog, start it.
                    const current = this.orderQueue.getCurrent();
                    if (current && current.id === row.id && !this.dialogStates.has(row.id)) {
                        Logger.info(`Order #${row.id} is current in queue but has no dialog state. Starting now.`);
                        await this.startOrderDialog(current);
                    }
                    continue;
                }

                Logger.info(`New order detected: #${row.id}`);
                const order = new Order(row.id, row.username, row.amount, row.description);
                order.status = row.status;
                order.createdAt = row.created_at;

                const position = this.orderQueue.add(order);

                if (position === 0) {
                    await this.startOrderDialog(order);
                } else {
                    await this.notifyQueuePosition(order, position);
                }
            }
        } finally {
            this.isCheckingOrders = false;
        }
    }

    async startOrderDialog(order) {
        Logger.info(`Starting dialog for order #${order.id}. Status: ${order.status}`);

        if (order.nickname) {
            if (order.status !== 'confirming') {
                order.status = 'confirming';
                DatabaseManager.updateOrder(order.id, { status: 'confirming', nickname: order.nickname });

                const confirmMsg = this.formatMessage(config.messages.dialog.confirm, {
                    id: order.id,
                    amount: MinecraftValidator.formatAmount(order.amount * 1000000),
                    nickname: order.nickname
                });
                this.sendFunPayMessage(order.username, confirmMsg, order.id);
            }
            this.setDialogState(order.id, 'waiting_confirmation', order);
        } else if (!order.status || order.status === 'pending' || order.status === 'processing') {
            order.status = 'contacted';
            DatabaseManager.updateOrder(order.id, { status: 'contacted' });

            let welcomeMsg = this.formatMessage(config.messages.dialog.welcome, { id: order.id });
            if (Date.now() - order.createdAt > config.orders.queueNotifyThreshold) {
                welcomeMsg = this.formatMessage(config.messages.dialog.welcomeQueue, { id: order.id });
            }
            this.sendFunPayMessage(order.username, welcomeMsg, order.id);
            this.setDialogState(order.id, 'waiting_nickname', order);
        } else if (order.status === 'contacted') {
            this.setDialogState(order.id, 'waiting_nickname', order);
        }

        this.resetOrderTimeout(order);
    }

    resetOrderTimeout(order) {
        if (order.timeoutId) clearTimeout(order.timeoutId);
        order.timeoutId = setTimeout(() => this.handleOrderTimeout(order), config.orders.dialogTimeout);
    }

    setDialogState(orderId, step, order) {
        this.dialogStates.set(orderId, { step, order });
        const orderCopy = { ...order };
        delete orderCopy.timeoutId;
        DatabaseManager.saveDialog(orderId, step, orderCopy);
    }

    async handleOrderTimeout(order) {
        if (!this.dialogStates.has(order.id)) return;

        // Skip timeout if this is the only order
        if (this.orderQueue.getQueueSize() === 0) {
            Logger.info(`Order #${order.id} is the only one. Postponing timeout by ${config.orders.dialogTimeout / 1000}s.`);
            this.resetOrderTimeout(order);
            return;
        }

        Logger.info(`Timeout for order #${order.id}`);
        const timeoutMessage = this.formatMessage(config.messages.dialog.timeout, { id: order.id });
        this.sendFunPayMessage(order.username, timeoutMessage, order.id);

        const nextOrder = this.orderQueue.moveCurrentToEnd();

        order.status = 'pending';
        DatabaseManager.updateOrder(order.id, { status: 'pending' });

        this.dialogStates.delete(order.id);
        DatabaseManager.deleteDialog(order.id);

        if (nextOrder) await this.startOrderDialog(nextOrder);

        const position = this.orderQueue.getPosition(order.id);
        if (position > 0) this.notifyQueuePosition(order, position);
    }

    async notifyQueuePosition(order, position) {
        const msg = this.formatMessage(config.messages.dialog.queuePosition, { id: order.id, position });
        this.sendFunPayMessage(order.username, msg, order.id);
    }

    async checkMessages() {
        if (this.isCheckingMessages) return;
        this.isCheckingMessages = true;
        try {
            const messages = DatabaseManager.getUnprocessedMessages();
            if (messages.length > 0) {
                Logger.info(`Processing ${messages.length} new messages from FunPay`);
            }
            for (const msg of messages) {
                if (DatabaseManager.claimMessage(msg.id)) {
                    await this.handleFunPayMessage(msg);
                }
            }
        } catch (e) {
            Logger.error('Error in checkMessages:', e);
        } finally {
            this.isCheckingMessages = false;
        }
    }

    async handleFunPayMessage(msg) {
        Logger.info(`Processing message from ${msg.username}: ${msg.message}`);
        let targetOrderId = null;
        for (const [orderId, state] of this.dialogStates.entries()) {
            if (state.order.username.toLowerCase() === msg.username.toLowerCase()) {
                targetOrderId = orderId;
                break;
            }
        }

        if (targetOrderId) {
            await this.handleUserMessage(targetOrderId, msg.username, msg.message);
        } else {
            const isCommand = await this.processCommand(msg.username, msg.message);
            if (!isCommand) {
                Logger.chat(`[${msg.username}] ${msg.message}`);

                const activeOrder = DatabaseManager.getActiveOrderForUser(msg.username);
                if (activeOrder) {
                    Logger.info(`Found active order for ${msg.username}. Triggering checkNewOrders.`);
                    await this.checkNewOrders();

                    // 1. Re-check if we now have a dialog state for this user (after checkNewOrders sync)
                    for (const [orderId, state] of this.dialogStates.entries()) {
                        if (state.order.username.toLowerCase() === msg.username.toLowerCase()) {
                            await this.handleUserMessage(orderId, msg.username, msg.message);
                            return;
                        }
                    }

                    // 2. If not in dialogStates but activeOrder exists, they must be in the queue
                    const pos = this.orderQueue.getPositionByUsername(msg.username);
                    if (pos > 0) {
                        const msgText = this.formatMessage(config.messages.dialog.queueStatus, { position: pos, ahead: pos - 1 });
                        this.sendFunPayMessage(msg.username, msgText);
                    } else if (pos === 0) {
                        // Edge case: position 0 but no dialog state (unlikely after sync, but safety first)
                        const current = this.orderQueue.getCurrent();
                        if (current) await this.startOrderDialog(current);
                    }
                } else {
                    // No active order, send greeting if not sent recently
                    this.sendGuestWelcome(msg.username);
                }
            }
        }
    }

    async handleUserMessage(orderId, username, message) {
        Logger.chat(`[${username}] ${message}`); // Log incoming message

        const state = this.dialogStates.get(orderId);
        if (state) this.resetOrderTimeout(state.order);

        // Global commands that should interrupt anything (like payment attempts)
        const cmd = message.trim().toLowerCase();
        const interruptCmds = ['!change', '!сменить', 'нет', 'no', 'отмена'];

        if (interruptCmds.includes(cmd)) {
            if (state) {
                const order = state.order;
                order.interruptAttempts = true; // Signal processOrder to stop
                this.sendFunPayMessage(order.username, config.messages.dialog.changeNickname, order.id);
                order.status = 'contacted';
                DatabaseManager.updateOrder(order.id, { status: 'contacted', nickname: null });
                this.setDialogState(order.id, 'waiting_nickname', order);
                state.isPaying = false; // Release lock if it was held
                return;
            }
        }

        // Admin commands check (BEFORE dialog handling)
        const admins = require('../config.json').admins || [];
        if (admins.includes(username)) {
            const isCommand = await this.processCommand(username, message);
            if (isCommand) return;
        }

        if (!state) return;

        if (state.step === 'waiting_nickname') {
            await this.handleNicknameInput(state.order, message);
        } else if (state.step === 'waiting_confirmation') {
            await this.handleConfirmation(state.order, message);
        }
    }

    async handleNicknameInput(order, nickname) {
        const text = nickname.trim().toLowerCase();

        // If user says "no" while we wait for nickname, they might be talking about a previous order or just confused.
        // But more likely, if we ALREADY had a nickname (from DB) and are asking "Zeroanal? (Yes/No)", 
        // the first message "нет" might hit handleNicknameInput if the state wasn't 'waiting_confirmation' yet.
        const response = nickname.trim().toLowerCase().replace(/[?!.,]/g, '');
        if (['да', 'yes', 'da', '+'].includes(response)) {
            if (this.orderQueue.getCurrent()?.id !== order.id) {
                const pos = this.orderQueue.getPosition(order.id);
                this.sendFunPayMessage(order.username, `⏳ Пожалуйста, подождите своей очереди. Перед вами еще ${pos} заказ(ов). Я сообщу, когда настанет ваш черед!`, order.id);
                return;
            }

            if (order.nickname) {
                order.confirmed = true;
                const state = this.dialogStates.get(order.id);
                if (state) state.isPaying = true;
                await this.processOrder(order);
                if (state) state.isPaying = false;
                return;
            } else {
                this.sendFunPayMessage(order.username, "📝 Пожалуйста, сначала введите ваш ник в Minecraft:", order.id);
                return;
            }
        }

        if (['нет', 'no', 'отмена'].includes(response)) {
            this.sendFunPayMessage(order.username, config.messages.dialog.cancel, order.id);
            order.status = 'contacted';
            DatabaseManager.updateOrder(order.id, { status: 'contacted', nickname: null });
            this.setDialogState(order.id, 'waiting_nickname', order);
            return;
        }

        if (config.messages.stopWords.some(w => text.includes(w)) && text.length > 3) {
            this.sendFunPayMessage(order.username, "🤖 Вижу, что вам, возможно, не нужна выдача. Я позвал администратора.", order.id);
            this.sendAlert(this.formatMessage(config.messages.dialog.adminAlert, { id: order.id, text: text }));
            this.dialogStates.delete(order.id);
            DatabaseManager.deleteDialog(order.id);
            return;
        }

        const validation = MinecraftValidator.isValidUsername(nickname);
        if (!validation.valid) {
            order.attempts = (order.attempts || 0) + 1;
            if (order.attempts >= 3) {
                this.sendFunPayMessage(order.username, config.messages.dialog.unknownNickname, order.id);
                this.sendAlert(`⚠️ Не валидный ник (3 попытки) Order #${order.id}: ${text}`);
                this.dialogStates.delete(order.id);
                DatabaseManager.deleteDialog(order.id);
                return;
            }
            this.sendFunPayMessage(order.username, this.formatMessage(config.messages.dialog.retryNickname, { error: MinecraftValidator.getErrorMessage(validation) }), order.id);
            return;
        }

        order.attempts = 0;
        order.nickname = validation.username;
        order.status = 'confirming';
        DatabaseManager.updateOrder(order.id, { status: 'confirming', nickname: order.nickname });

        const confirmMsg = this.formatMessage(config.messages.dialog.confirmNickname, {
            nickname: order.nickname,
            amount: MinecraftValidator.formatAmount(order.amount * 1000000)
        });
        this.sendFunPayMessage(order.username, confirmMsg, order.id);

        this.setDialogState(order.id, 'waiting_confirmation', order);
    }

    async handleConfirmation(order, message) {
        const state = this.dialogStates.get(order.id);
        if (state && state.isPaying) {
            Logger.info(`Order #${order.id} is already paying. Ignoring confirmation.`);
            return;
        }

        const response = message.toLowerCase().trim().replace(/[?!.,]/g, '');
        if (['да', 'yes', '+', 'da'].includes(response)) {
            if (this.orderQueue.getCurrent()?.id !== order.id) {
                const pos = this.orderQueue.getPosition(order.id);
                this.sendFunPayMessage(order.username, `⏳ Пожалуйста, подождите своей очереди. Перед вами еще ${pos} заказ(ов). Я сообщу, когда настанет ваш черед!`, order.id);
                return;
            }

            order.confirmed = true;
            if (state) state.isPaying = true; // Lock
            await this.processOrder(order);
            if (state) state.isPaying = false;
        } else if (['нет', 'no', '-', 'отмена'].includes(response)) {
            // ... rest same
            this.sendFunPayMessage(order.username, config.messages.dialog.cancel, order.id);
            order.status = 'contacted';
            DatabaseManager.updateOrder(order.id, { status: 'contacted', nickname: null });
            this.setDialogState(order.id, 'waiting_nickname', order);
        } else {
            this.sendFunPayMessage(order.username, config.messages.dialog.askYesNo, order.id);
        }
    }

    async processOrder(order) {
        Logger.info(`Processing order #${order.id}`);
        order.interruptAttempts = false; // Reset the interrupt flag at start

        // 1. Wait for bot readiness (max 30s)
        if (!MinecraftService.ready) {
            Logger.info(`Waiting for MinecraftService to be ready for order #${order.id}...`);
            const readinessStart = Date.now();
            while (!MinecraftService.ready && Date.now() - readinessStart < 30000) {
                if (order._abort || order.interruptAttempts) return;
                await new Promise(r => setTimeout(r, 1000));
            }
            if (!MinecraftService.ready) {
                Logger.error(`MinecraftService not ready after 30s for order #${order.id}. Aborting.`);
                this.sendFunPayMessage(order.username, "❌ К сожалению, бот сейчас не подключен к серверу Minecraft. Пожалуйста, попробуйте позже.", order.id);
                // Optionally, mark order as failed or return to contacted state
                DatabaseManager.updateOrder(order.id, { status: 'contacted' });
                this.dialogStates.delete(order.id);
                DatabaseManager.deleteDialog(order.id);
                return;
            }
        }

        try {
            DatabaseManager.updateOrder(order.id, { status: 'delivering' });

            const amount = order.amount * 1000000;
            const payCommand = `/pay ${order.nickname} ${amount}`;

            // 2. Proactive balance check
            if (MinecraftService.ready) {
                Logger.info(`Checking balance before payment for order #${order.id}`);
                const balance = await MinecraftService.getBalance();
                // If balance is 0 and we need more, or if balance is less than needed
                if (balance < amount) {
                    // Only stop if we actually got a balance response (balance > 0 or explicit 0)
                    // If balance returned is a result of a timeout (often 0), we might want to try once anyway?
                    // But usually, if balance is 0, we can't pay.
                    Logger.error(`Proactive check: Insufficient funds (${balance} < ${amount})`);
                    const alertMsg = `🆘 **АЛЯРМ!** Недостаточно средств для заказа #${order.id} по результатам проверки /balance.\nНужно: ${MinecraftValidator.formatAmount(amount)}\nБаланс: ${MinecraftValidator.formatAmount(balance)}`;
                    this.sendAlert(alertMsg);

                    const userMsg = "❌ К сожалению, у меня временно закончились средства для выдачи вашего заказа.\n\nЯ уже уведомил администратора, он скоро пополнит мой баланс. Пожалуйста, не закрывайте заказ, мы выдадим его при первой возможности!";
                    this.sendFunPayMessage(order.username, userMsg, order.id);

                    order.status = 'paused';
                    DatabaseManager.updateOrder(order.id, { status: 'paused' });
                    this.dialogStates.delete(order.id);
                    DatabaseManager.deleteDialog(order.id);
                    return;
                }
            }

            let attempts = 0;
            const maxAttempts = 5;
            let success = false;

            while (attempts < maxAttempts && !success) {
                if (order._abort || order.interruptAttempts) {
                    Logger.info(`Order #${order.id} payment loop interrupted.`);
                    return;
                }

                attempts++;
                Logger.info(`Payment attempt ${attempts}/${maxAttempts} for order #${order.id}`);

                // Verification Promise
                const result = await new Promise((resolve) => {
                    if (!MinecraftService.bot) return resolve({ success: false, error: "Bot not connected" });

                    let resolved = false;
                    const messageHandler = (msg) => {
                        const text = msg.toString().toLowerCase();
                        // Success patterns
                        if (text.includes('вы успешно отправили') ||
                            text.includes('вы успешно перевели') ||
                            text.includes('вы перевели') ||
                            text.includes('успешно переведено') ||
                            (text.includes('успешно!') && text.includes('отправлено'))) {

                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timeout);
                                MinecraftService.bot.removeListener('message', messageHandler);
                                resolve({ success: true });
                            }
                        }
                        // Failure patterns
                        else if (text.includes('недостаточно денег') || text.includes('недостаточно средств')) {
                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timeout);
                                MinecraftService.bot.removeListener('message', messageHandler);
                                resolve({ success: false, error: "insufficient_funds" });
                            }
                        }
                        else if (text.includes('игрок не найден') || text.includes('не найден')) {
                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timeout);
                                MinecraftService.bot.removeListener('message', messageHandler);
                                resolve({ success: false, error: "not_found" });
                            }
                        }
                        // Confirmation pattern
                        else if (text.includes('введите команду повторно') || text.includes('[⟲]')) {
                            Logger.info(`Server asked for confirmation. Resending pay command for order #${order.id}`);
                            clearTimeout(timeout);
                            timeout = setTimeout(() => {
                                if (!resolved) {
                                    resolved = true;
                                    MinecraftService.bot.removeListener('message', messageHandler);
                                    resolve({ success: false, error: "timeout_after_confirm" });
                                }
                            }, 5000);
                            MinecraftService.chat(payCommand);
                        }
                    };

                    let timeout = setTimeout(() => {
                        if (!resolved) {
                            resolved = true;
                            MinecraftService.bot.removeListener('message', messageHandler);
                            resolve({ success: false, error: "timeout" });
                        }
                    }, 5000);

                    // ATTACH LISTENER FIRST, THEN SEND CHAT
                    MinecraftService.bot.on('message', messageHandler);
                    MinecraftService.chat(payCommand);
                });

                // Immediate check if we were interrupted while waiting for the promise
                if (order._abort || order.interruptAttempts) {
                    Logger.info(`Order #${order.id} interrupted after payment attempt.`);
                    return;
                }

                if (result.success) {
                    success = true;
                    Logger.info(`Payment successful for order #${order.id}`);
                    const successMsg = this.formatMessage(config.messages.dialog.success, { amount: MinecraftValidator.formatAmount(amount) });
                    if (this.dialogStates.has(order.id)) {
                        this.sendFunPayMessage(order.username, successMsg, order.id);
                    }
                    DatabaseManager.updateOrder(order.id, { status: 'completed' });
                    this.orderQueue.completeCurrent(true);
                    this.dialogStates.delete(order.id);
                    DatabaseManager.deleteDialog(order.id);

                    const next = this.orderQueue.getCurrent();
                    if (next) await this.startOrderDialog(next);
                    return; // Exit function
                } else if (result.error === 'insufficient_funds') {
                    Logger.error(`Payment failed: Insufficient funds for order #${order.id}`);
                    const alertMsg = `🆘 **АЛЯРМ!** У бота закончились деньги на балансе!\nЗаказ #${order.id} на сумму ${MinecraftValidator.formatAmount(amount)} не может быть выдан.`;
                    this.sendAlert(alertMsg);

                    const userMsg = "❌ К сожалению, у меня временно закончились средства для выдачи вашего заказа.\n\nЯ уже уведомил администратора, он скоро пополнит мой баланс. Пожалуйста, не закрывайте заказ, мы выдадим его при первой возможности!";
                    this.sendFunPayMessage(order.username, userMsg, order.id);

                    // Set status to paused so it doesn't loop
                    order.status = 'paused';
                    DatabaseManager.updateOrder(order.id, { status: 'paused' });
                    this.dialogStates.delete(order.id);
                    DatabaseManager.deleteDialog(order.id);
                    return;
                } else {
                    Logger.warn(`Payment attempt ${attempts} failed: ${result.error}`);
                    if (attempts < maxAttempts) {
                        let waitMsg;
                        if (result.error === 'timeout' || result.error === 'timeout_after_confirm') {
                            waitMsg = `⏳ Сервер задерживается с ответом. Попытка ${attempts}/${maxAttempts}. Пожалуйста, подождите...`;
                        } else {
                            waitMsg = this.formatMessage(config.messages.dialog.notFound, { attempts, maxAttempts });
                        }

                        this.sendFunPayMessage(order.username, waitMsg, order.id);

                        // Interruptible sleep: check for abort every 500ms
                        const sleepStart = Date.now();
                        while (Date.now() - sleepStart < 20000) {
                            if (order._abort || order.interruptAttempts) return;
                            await new Promise(r => setTimeout(r, 500));
                        }
                    }
                }
            }

            // If we are here, all attempts failed
            Logger.warn(`All payment attempts failed for order #${order.id}`);
            const errorMsg = "❌ К сожалению, за 5 попыток мне не удалось найти вас на сервере.\n\nПожалуйста, убедитесь, что вы зашли именно на Anarchy 401 и ввели правильный ник. Я временно вернул вас на этап ввода ника, чтобы вы могли его проверить или изменить.";
            this.sendFunPayMessage(order.username, errorMsg, order.id);

            // Reset to nickname step
            order.status = 'contacted';
            DatabaseManager.updateOrder(order.id, { status: 'contacted', nickname: null });
            this.setDialogState(order.id, 'waiting_nickname', order);

        } catch (e) {
            Logger.error(`Error processing order #${order.id}: ${e.message}`);
        }
    }

    sendGuestWelcome(username) {
        const lowerUser = username.toLowerCase();
        if (this.guestWelcomeSent.has(lowerUser)) return;

        Logger.info(`Sending guest welcome to ${username}`);
        this.sendFunPayMessage(username, config.messages.dialog.guestWelcome);
        this.guestWelcomeSent.add(lowerUser);

        // Reset welcome flag after 24h
        setTimeout(() => this.guestWelcomeSent.delete(lowerUser), config.orders.guestWelcomeTimeout || 86400000);
    }

    async processCommand(username, text) {
        const cmd = text.trim().toLowerCase();
        if (cmd === '!status' || cmd === '!статус') {
            const stats = this.orderQueue.getStats();
            this.sendFunPayMessage(username, this.formatMessage(config.messages.dialog.stats, { completed: stats.completed, queued: stats.queued }));
            return true;
        } else if (cmd === '!queue' || cmd === '!очередь') {
            const position = this.orderQueue.getPositionByUsername(username);
            if (position > 0) {
                const msg = this.formatMessage(config.messages.dialog.queueStatus, { position: position, ahead: position - 1 });
                this.sendFunPayMessage(username, msg);
            } else if (position === 0) {
                // Check if it's the current one being processed
                const current = this.orderQueue.getCurrent();
                if (current && current.username === username) {
                    this.sendFunPayMessage(username, "⏳ Ваш заказ выполняется прямо сейчас!");
                } else {
                    this.sendFunPayMessage(username, config.messages.dialog.notInQueue);
                }
            } else {
                this.sendFunPayMessage(username, config.messages.dialog.notInQueue);
            }
            return true;
        } else if (cmd === '!help' || cmd === '!помощь') {
            this.sendFunPayMessage(username, config.messages.dialog.help);
            return true;
        } else if (cmd === '!skip') {
            // Check admin
            const isAdmin = rootConfig.admins && rootConfig.admins.includes(username);
            if (isAdmin) {
                const currentOrder = this.orderQueue.getCurrent();
                if (currentOrder) {
                    Logger.info(`Admin ${username} skipped order #${currentOrder.id} (Status: ${currentOrder.status})`);
                    currentOrder._abort = true; // Signal to abort loop if in delivering
                    currentOrder.interruptAttempts = true; // Signal to abort loop if in delivering

                    this.sendFunPayMessage(username, this.formatMessage(config.messages.dialog.skipSuccess, { id: currentOrder.id }));

                    DatabaseManager.updateOrder(currentOrder.id, { status: 'skipped' });
                    this.orderQueue.completeCurrent(false); // Remove from queue
                    this.dialogStates.delete(currentOrder.id);
                    DatabaseManager.deleteDialog(currentOrder.id);

                    // Trigger next
                    setTimeout(async () => {
                        const next = this.orderQueue.getCurrent();
                        if (next) await this.startOrderDialog(next);
                    }, 1000);

                } else {
                    this.sendFunPayMessage(username, "⛔ Сейчас нет активного заказа для пропуска.");
                }
            } else {
                this.sendFunPayMessage(username, config.messages.dialog.adminOnly);
            }
            return true;
        } else if (cmd === '!balance' || cmd === '!баланс') {
            const balance = await MinecraftService.getBalance();
            const msg = this.formatMessage(config.messages.dialog.balance || "💰 Текущий баланс: {balance} монет.", { balance: balance.toLocaleString() });
            this.sendFunPayMessage(username, msg);
            return true;
        } else if (cmd === '!refund') {
            this.sendFunPayMessage(username, "Для возврата средств, пожалуйста, обратитесь к администратору или создайте тикет на FunPay.");
            return true;
        } else if (cmd.startsWith('!start')) {
            const parts = text.trim().split(/\s+/);
            const idArg = parts.length > 1 ? parts[1] : null;
            const isAdmin = rootConfig.admins && rootConfig.admins.includes(username);

            // Manual creation (Admin only): !start ID AMOUNT USERNAME
            if (isAdmin && parts.length >= 4) {
                const id = parts[1];
                const amount = parseFloat(parts[2].replace(',', '.'));
                const targetUser = parts[3];

                if (isNaN(amount)) {
                    this.sendFunPayMessage(username, "❌ Неверный формат суммы. Пример: !start TEST1 100 User123");
                    return true;
                }

                Logger.info(`Admin ${username} creating manual order #${id} for ${targetUser} (${amount})`);

                // We use replace to ensure it's "created or updated" for testing
                const stmt = DatabaseManager.db.prepare(`
                    INSERT INTO orders (id, username, amount, description, status, created_at, updated_at, is_manual)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                    ON CONFLICT(id) DO UPDATE SET 
                        username=excluded.username, 
                        amount=excluded.amount, 
                        status=excluded.status, 
                        updated_at=excluded.updated_at
                `);

                stmt.run(id, targetUser, amount, "Ручной заказ (Admin)", "pending", Date.now(), Date.now());

                this.sendFunPayMessage(username, `✅ Ручной заказ #${id} для **${targetUser}** (${amount} кк) запущен!`);

                // Trigger a check to pick it up immediately
                this.checkNewOrders();
                return true;
            }

            let orderToStart = null;

            if (idArg) {
                // Find specific order by ID
                const orderRow = DatabaseManager.getOrder(idArg);
                if (!orderRow) {
                    this.sendFunPayMessage(username, `❌ Заказ #${idArg} не найден в базе данных.`);
                    return true;
                }

                if (!isAdmin && orderRow.username !== username) {
                    this.sendFunPayMessage(username, "⛔ Вы можете запускать только свои заказы.");
                    return true;
                }
                orderToStart = orderRow;
            } else {
                // Find current user's active order
                orderToStart = DatabaseManager.getActiveOrderForUser(username);
                // Also check for paused orders specifically
                if (!orderToStart) {
                    const pausedOrder = DatabaseManager.db.prepare("SELECT * FROM orders WHERE username = ? AND status = 'paused' LIMIT 1").get(username);
                    if (pausedOrder) orderToStart = pausedOrder;
                }

                if (!orderToStart) {
                    this.sendFunPayMessage(username, "❌ У вас нет активных или приостановленных заказов.");
                    return true;
                }
            }

            // If found and paused/pending, reset to pending and check
            if (['pending', 'paused', 'contacted', 'skipped'].includes(orderToStart.status)) {
                Logger.info(`Manual start requested for order #${orderToStart.id} by ${username}`);
                DatabaseManager.updateOrder(orderToStart.id, { status: 'pending' });
                this.sendFunPayMessage(username, `🚀 Запуск обработки заказа #${orderToStart.id}...`);

                // Manually trigger a check
                this.checkNewOrders();
            } else if (orderToStart.status === 'completed') {
                this.sendFunPayMessage(username, "✅ Этот заказ уже успешно выполнен.");
            } else {
                this.sendFunPayMessage(username, `⏳ Заказ #${orderToStart.id} уже находится в процессе (${orderToStart.status}).`);
            }
            return true;
        }
        return false;
    }

    sendFunPayMessage(username, message, orderId = null) {
        let nodeId = null;
        if (orderId) {
            // Try to look up node_id from active dialog state
            const state = this.dialogStates.get(orderId);
            if (state && state.order && state.order.node_id) {
                nodeId = state.order.node_id;
            } else {
                // Try from DB
                const order = DatabaseManager.getOrder(orderId);
                if (order && order.node_id) {
                    nodeId = order.node_id;
                }
            }
        }

        const payload = {
            type: 'message',
            username: username,
            message: message,
            order_id: orderId,
            node_id: nodeId, // Pass node_id to SocketService
            timestamp: Date.now()
        };
        // Save to DB first as backup/audit
        DatabaseManager.addRequest('message', payload);

        Logger.chat(`[Bot -> ${username}] ${message}`); // Log outgoing message
        Logger.info(`[Bot -> ${username}] ${message}`); // Visible in console

        // Send via Socket for instant delivery
        SocketService.sendFunPayMessage(username, message, orderId, nodeId);
    }

    sendAlert(message) {
        const payload = { message, timestamp: Date.now() };
        DatabaseManager.addRequest('alert', payload);
        SocketService.send({ type: 'alert', message });
    }
}

module.exports = new OrderManager();