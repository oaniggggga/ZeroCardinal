/**
 * Тестовый скрипт для симуляции покупок
 * Ник покупателя: chinoyouka1
 */

import './src/modules.js';

const { sendMessage } = global.chat;
const { Order } = await import('./src/ru/cycle/Utils.js');

// Тестовые данные покупателя
const TEST_BUYER = {
    username: 'chinoyouka1',
    buyerId: '999999', // Тестовый ID
    node: 'users-123456-999999' // Замените 123456 на ваш ID
};

// Симуляция заказа
const TEST_ORDER = {
    id: '#TEST001',
    buyerName: TEST_BUYER.username,
    buyerId: TEST_BUYER.buyerId,
    name: 'что-то связанное с валютой, 1 шт.', // Соответствует настройке bot.orderName
    price: 100,
    unit: '₽',
    count: 1
};

console.log('=== ТЕСТ АВТОВЫДАЧИ ===\n');

// Тест 1: Создание заказа
console.log('📦 Тест 1: Создание заказа');
console.log(`Заказ: ${TEST_ORDER.id}`);
console.log(`Покупатель: ${TEST_ORDER.buyerName}`);
console.log(`Товар: ${TEST_ORDER.name}`);
console.log(`Количество: ${TEST_ORDER.count}\n`);

// Тест 2: Установка текущего заказа
console.log('📝 Тест 2: Установка текущего заказа');
const testOrder = new Order(
    TEST_ORDER.id,
    TEST_ORDER.buyerName,
    TEST_ORDER.buyerId,
    TEST_ORDER.count,
    TEST_ORDER.name
);
Order.setCurrent(testOrder);
console.log(`✓ Заказ установлен: ${Order.getCurrent()?.id}\n`);

// Тест 3: Симуляция отправки первого сообщения
console.log('💬 Тест 3: Отправка приветственного сообщения');
console.log(`Отправка сообщения покупателю ${TEST_BUYER.username}...`);
await sendMessage(TEST_BUYER.buyerId, '👉 Ваша очередь подошла! Выполняю заказ.', true);
await sendMessage(TEST_BUYER.buyerId, 'Напишите свой ник на сервере.', true);
console.log('✓ Сообщения отправлены\n');

// Тест 4: Симуляция ответа с ником
console.log('🎮 Тест 4: Симуляция ответа покупателя с ником');
const testNick = 'chinoyouka1';
console.log(`Покупатель отправил ник: ${testNick}`);

// Проверка валидации ника
const isValidNick = /^[A-Za-z0-9_]{3,16}$/.test(testNick);
console.log(`Валидация ника: ${isValidNick ? '✓ Прошла' : '✗ Не прошла'}`);

if (isValidNick) {
    global.bot.givingUser = testNick;
    console.log(`✓ Ник сохранён: ${global.bot.givingUser}\n`);
    
    // Тест 5: Подтверждение ника
    console.log('✅ Тест 5: Запрос подтверждения');
    await sendMessage(TEST_BUYER.buyerId, `Выдавать валюту на ник "${testNick}"? (Да/Нет)`, true);
    testOrder.question = true;
    console.log('✓ Запрос отправлен\n');
}

// Тест 6: Симуляция подтверждения "Да"
console.log('👍 Тест 6: Симуляция ответа "Да"');
testOrder.applied = true;
global.bot.mustGive = testOrder.count * 1000000;
console.log(`✓ Заказ подтверждён`);
console.log(`✓ Сумма к выдаче: ${global.bot.mustGive} валюты\n`);

// Проверка баланса
console.log('💰 Тест 7: Проверка баланса бота');
console.log(`Баланс бота: ${global.bot.balance || 0}`);
console.log(`Требуется: ${global.bot.mustGive}`);

if (global.bot.balance >= global.bot.mustGive) {
    console.log('✓ Баланса достаточно\n');
    
    await sendMessage(
        TEST_BUYER.buyerId, 
        `Хорошо. Зайдите на ${global.settings.bot.anarchy} анархию и бот вам сразу отправит деньги. Если вы находились на данной анархии, перезайдите.`,
        true
    );
    console.log('✓ Инструкция отправлена покупателю\n');
} else {
    console.log('✗ Недостаточно баланса для выдачи\n');
}

// Тест 8: Очередь заказов
console.log('📋 Тест 8: Тест очереди заказов');
const queueOrder1 = new Order('#TEST002', 'testuser1', '888888', 2, 'что-то связанное с валютой');
const queueOrder2 = new Order('#TEST003', 'testuser2', '777777', 1, 'что-то связанное с валютой');

const pos1 = Order.addWaiting(queueOrder1);
const pos2 = Order.addWaiting(queueOrder2);

console.log(`✓ Заказ #TEST002 добавлен в очередь, позиция: ${pos1}`);
console.log(`✓ Заказ #TEST003 добавлен в очередь, позиция: ${pos2}`);
console.log(`Всего в очереди: ${Order.getWaiting().length}\n`);

// Тест 9: Обработка следующего заказа
console.log('⏭️ Тест 9: Извлечение следующего заказа из очереди');
Order.setCurrent(null);
const nextOrder = Order.nextWaiting();
console.log(`✓ Следующий заказ: ${nextOrder?.id || 'нет'}`);
console.log(`Осталось в очереди: ${Order.getWaiting().length}\n`);

// Тест 10: Завершение заказа
console.log('✔️ Тест 10: Завершение заказа');
if (testOrder) {
    testOrder.done = true;
    Order.clearTimeoutSafe(testOrder);
    console.log(`✓ Заказ ${testOrder.id} помечен как выполненный`);
    console.log(`✓ Таймаут очищен\n`);
}

// Итоги
console.log('=== ИТОГИ ТЕСТИРОВАНИЯ ===');
console.log(`✓ Покупатель: ${TEST_BUYER.username}`);
console.log(`✓ Ник на сервере: ${testNick}`);
console.log(`✓ Сумма к выдаче: ${global.bot.mustGive || 0} валюты`);
console.log(`✓ Текущий заказ: ${Order.getCurrent()?.id || 'нет'}`);
console.log(`✓ В очереди: ${Order.getWaiting().length} заказов`);
console.log('\n🎉 Тестирование завершено!\n');

// Очистка
Order.setCurrent(null);
console.log('🧹 Тестовые данные очищены');

process.exit(0);
