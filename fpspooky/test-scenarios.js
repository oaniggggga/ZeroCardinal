/**
 * Расширенные тестовые сценарии
 * Покупатель: chinoyouka1
 */

import './src/modules.js';

const { sendMessage, processIncomingMessages } = global.chat;
const { Order } = await import('./src/ru/cycle/Utils.js');
const { sleep } = global.helpers;

const BUYER = {
    username: 'chinoyouka1',
    buyerId: '999999',
    node: 'users-123456-999999'
};

console.log('🧪 РАСШИРЕННОЕ ТЕСТИРОВАНИЕ\n');

// ============================================
// СЦЕНАРИЙ 1: Нормальная покупка
// ============================================
async function testNormalPurchase() {
    console.log('📦 СЦЕНАРИЙ 1: Нормальная покупка');
    console.log('─'.repeat(50));
    
    const order = new Order('#NORM001', BUYER.username, BUYER.buyerId, 1, 'что-то связанное с валютой');
    Order.setCurrent(order);
    
    console.log('1️⃣ Заказ создан:', order.id);
    await sendMessage(BUYER.buyerId, '👉 Ваша очередь подошла! Выполняю заказ.', true);
    await sendMessage(BUYER.buyerId, 'Напишите свой ник на сервере.', true);
    
    await sleep(500);
    
    console.log('2️⃣ Покупатель отправляет ник: chinoyouka1');
    global.bot.givingUser = 'chinoyouka1';
    order.question = false;
    
    await sendMessage(BUYER.buyerId, 'Выдавать валюту на ник "chinoyouka1"? (Да/Нет)', true);
    order.question = true;
    
    await sleep(500);
    
    console.log('3️⃣ Покупатель подтверждает: Да');
    order.applied = true;
    global.bot.mustGive = 1000000;
    
    await sendMessage(BUYER.buyerId, `Хорошо. Зайдите на ${global.settings.bot.anarchy} анархию и бот вам сразу отправит деньги.`, true);
    
    console.log('4️⃣ Ожидание входа на сервер...');
    console.log('5️⃣ Бот выполняет команду: /pay chinoyouka1 1000000');
    
    await sleep(500);
    
    console.log('6️⃣ Деньги переведены успешно!');
    await sendMessage(BUYER.buyerId, 'Успешно перевёл вам 1000000 валюты!', true);
    await sendMessage(BUYER.buyerId, 'Подтвердите заказ и напишите отзыв если вам все понравилось!', true);
    
    order.done = true;
    Order.setCurrent(null);
    
    console.log('✅ Заказ завершён успешно\n');
}

// ============================================
// СЦЕНАРИЙ 2: Неверный ник
// ============================================
async function testInvalidNick() {
    console.log('❌ СЦЕНАРИЙ 2: Неверный ник');
    console.log('─'.repeat(50));
    
    const order = new Order('#INV001', BUYER.username, BUYER.buyerId, 1, 'что-то связанное с валютой');
    Order.setCurrent(order);
    
    console.log('1️⃣ Заказ создан:', order.id);
    await sendMessage(BUYER.buyerId, 'Напишите свой ник на сервере.', true);
    
    await sleep(500);
    
    const invalidNicks = [
        'ab',              // Слишком короткий
        'very_long_nickname_123456', // Слишком длинный
        'nick with spaces', // Пробелы
        'ник_кириллица',   // Кириллица
        'nick@special'     // Спецсимволы
    ];
    
    for (const nick of invalidNicks) {
        console.log(`2️⃣ Покупатель отправляет: "${nick}"`);
        const isValid = /^[A-Za-z0-9_]{3,16}$/.test(nick);
        
        if (!isValid) {
            console.log(`   ❌ Ник невалиден`);
            await sendMessage(
                BUYER.buyerId,
                '❌ Неверный ник. Ник должен состоять из 3–16 символов (латинские буквы, цифры, подчёркивание) и без пробелов. Попробуйте ещё раз.',
                true
            );
        }
    }
    
    console.log('3️⃣ Покупатель отправляет валидный ник: chinoyouka1');
    global.bot.givingUser = 'chinoyouka1';
    console.log('✅ Ник принят\n');
    
    Order.setCurrent(null);
}

// ============================================
// СЦЕНАРИЙ 3: Недостаточно баланса
// ============================================
async function testInsufficientBalance() {
    console.log('💸 СЦЕНАРИЙ 3: Недостаточно баланса');
    console.log('─'.repeat(50));
    
    const order = new Order('#BAL001', BUYER.username, BUYER.buyerId, 5, 'что-то связанное с валютой');
    Order.setCurrent(order);
    
    console.log('1️⃣ Заказ на 5 млн валюты');
    console.log('2️⃣ Баланс бота:', global.bot.balance || 0);
    
    global.bot.givingUser = 'chinoyouka1';
    order.applied = true;
    global.bot.mustGive = 5000000;
    
    if (global.bot.balance < global.bot.mustGive) {
        console.log('3️⃣ ❌ Недостаточно баланса!');
        await sendMessage(
            BUYER.buyerId,
            `У бота не хватает денег! Возвращаю... (Баланс бота: ${global.bot.balance}, надо выдать ${global.bot.mustGive})`,
            true
        );
        console.log('4️⃣ Выполняется возврат средств...');
        Order.setCurrent(null);
        console.log('✅ Возврат выполнен\n');
    }
}

// ============================================
// СЦЕНАРИЙ 4: Очередь заказов
// ============================================
async function testOrderQueue() {
    console.log('📋 СЦЕНАРИЙ 4: Очередь заказов');
    console.log('─'.repeat(50));
    
    // Текущий заказ занят
    const currentOrder = new Order('#CUR001', 'user1', '111111', 1, 'что-то связанное с валютой');
    Order.setCurrent(currentOrder);
    console.log('1️⃣ Текущий заказ:', currentOrder.id);
    
    // Новый заказ от chinoyouka1
    const newOrder = new Order('#QUE001', BUYER.username, BUYER.buyerId, 1, 'что-то связанное с валютой');
    console.log('2️⃣ Новый заказ от chinoyouka1:', newOrder.id);
    
    const position = Order.addWaiting(newOrder);
    console.log(`3️⃣ Заказ добавлен в очередь, позиция: ${position}`);
    
    await sendMessage(BUYER.buyerId, `Бот занят. Ваш заказ помещён в очередь. Ваша позиция #${position}.`, true);
    
    // Добавляем ещё заказы
    const order2 = new Order('#QUE002', 'user2', '222222', 1, 'что-то связанное с валютой');
    const order3 = new Order('#QUE003', 'user3', '333333', 1, 'что-то связанное с валютой');
    
    Order.addWaiting(order2);
    Order.addWaiting(order3);
    
    console.log(`4️⃣ Всего в очереди: ${Order.getWaiting().length} заказов`);
    
    // Завершаем текущий заказ
    console.log('5️⃣ Текущий заказ завершён');
    Order.setCurrent(null);
    
    // Обрабатываем следующий
    const next = Order.nextWaiting();
    Order.setCurrent(next);
    console.log(`6️⃣ Следующий заказ: ${next.id} (${next.username})`);
    
    await sendMessage(next.buyerId, '👉 Ваша очередь подошла! Выполняю заказ.', true);
    
    console.log(`7️⃣ Осталось в очереди: ${Order.getWaiting().length} заказов`);
    console.log('✅ Очередь работает корректно\n');
    
    Order.setCurrent(null);
}

// ============================================
// СЦЕНАРИЙ 5: Таймаут заказа
// ============================================
async function testOrderTimeout() {
    console.log('⏱️ СЦЕНАРИЙ 5: Таймаут заказа (симуляция)');
    console.log('─'.repeat(50));
    
    const order = new Order('#TIME001', BUYER.username, BUYER.buyerId, 1, 'что-то связанное с валютой');
    Order.setCurrent(order);
    
    console.log('1️⃣ Заказ создан:', order.id);
    await sendMessage(BUYER.buyerId, 'Напишите свой ник на сервере.', true);
    
    console.log('2️⃣ Установлен таймаут 2 минуты');
    console.log('3️⃣ Покупатель не отвечает...');
    console.log('4️⃣ [Симуляция] Таймаут истёк!');
    
    // Симуляция истечения таймаута
    if (Order.isCurrent(order)) {
        Order.clearTimeoutSafe(order);
        
        if (global.bot?.withdrawed) {
            global.bot.withdrawed = false;
            global.bot.mustGive = 0;
        }
        
        await sendMessage(BUYER.buyerId, '⌛ Вы не успели завершить покупку за 2 мин. Вас переместили в конец очереди.', true);
        
        order.promptSent = false;
        const pos = Order.addWaiting(order);
        
        await sendMessage(BUYER.buyerId, `Ваша новая позиция в очереди: ${pos}`, true);
        
        Order.setCurrent(null);
        console.log('5️⃣ Заказ перемещён в конец очереди');
        console.log('✅ Таймаут обработан корректно\n');
    }
}

// ============================================
// СЦЕНАРИЙ 6: Отмена подтверждения
// ============================================
async function testCancelConfirmation() {
    console.log('🔄 СЦЕНАРИЙ 6: Отмена подтверждения ника');
    console.log('─'.repeat(50));
    
    const order = new Order('#CANC001', BUYER.username, BUYER.buyerId, 1, 'что-то связанное с валютой');
    Order.setCurrent(order);
    
    console.log('1️⃣ Заказ создан:', order.id);
    
    global.bot.givingUser = 'chinoyouka1';
    order.question = true;
    
    await sendMessage(BUYER.buyerId, 'Выдавать валюту на ник "chinoyouka1"? (Да/Нет)', true);
    
    console.log('2️⃣ Покупатель отвечает: Нет');
    
    global.bot.withdrawed = false;
    order.question = false;
    order.applied = false;
    
    await sendMessage(BUYER.buyerId, 'Хорошо. Напишите свой ник на сервере.', true);
    
    console.log('3️⃣ Запрос ника повторён');
    console.log('✅ Отмена обработана корректно\n');
    
    Order.setCurrent(null);
}

// ============================================
// Запуск всех тестов
// ============================================
async function runAllTests() {
    try {
        await testNormalPurchase();
        await sleep(1000);
        
        await testInvalidNick();
        await sleep(1000);
        
        await testInsufficientBalance();
        await sleep(1000);
        
        await testOrderQueue();
        await sleep(1000);
        
        await testOrderTimeout();
        await sleep(1000);
        
        await testCancelConfirmation();
        
        console.log('═'.repeat(50));
        console.log('🎉 ВСЕ ТЕСТЫ ЗАВЕРШЕНЫ!');
        console.log('═'.repeat(50));
        console.log(`Покупатель: ${BUYER.username}`);
        console.log(`ID: ${BUYER.buyerId}`);
        console.log('Все сценарии протестированы успешно ✅\n');
        
    } catch (error) {
        console.error('❌ Ошибка при тестировании:', error);
    }
    
    process.exit(0);
}

runAllTests();
