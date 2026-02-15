/**
 * Быстрый тест покупки
 * Ник: chinoyouka1
 * 
 * Запуск: node quick-test.js
 */

import './src/modules.js';

const { sendMessage } = global.chat;
const { Order } = await import('./src/ru/cycle/Utils.js');

console.clear();
console.log('⚡ БЫСТРЫЙ ТЕСТ ПОКУПКИ\n');

// Данные покупателя
const BUYER_NICK = 'chinoyouka1';
const BUYER_ID = '999999'; // Замените на реальный ID если нужно

// Создание тестового заказа
const testOrder = new Order(
    '#TEST_' + Date.now(),
    BUYER_NICK,
    BUYER_ID,
    1, // Количество (1 млн валюты)
    'что-то связанное с валютой, 1 шт.'
);

console.log('📦 Заказ:', testOrder.id);
console.log('👤 Покупатель:', BUYER_NICK);
console.log('💰 Сумма: 1,000,000 валюты\n');

// Установка заказа
Order.setCurrent(testOrder);
console.log('✅ Заказ установлен как текущий\n');

// Шаг 1: Приветствие
console.log('1️⃣ Отправка приветствия...');
await sendMessage(BUYER_ID, '👉 Ваша очередь подошла! Выполняю заказ.', true);
await sendMessage(BUYER_ID, 'Напишите свой ник на сервере.', true);
console.log('   ✓ Отправлено\n');

// Шаг 2: Получение ника
console.log('2️⃣ Симуляция ответа покупателя...');
console.log(`   Покупатель: "${BUYER_NICK}"`);

// Валидация
const isValid = /^[A-Za-z0-9_]{3,16}$/.test(BUYER_NICK);
console.log(`   Валидация: ${isValid ? '✅ OK' : '❌ FAIL'}\n`);

if (isValid) {
    global.bot.givingUser = BUYER_NICK;
    testOrder.question = false;
    
    // Шаг 3: Подтверждение
    console.log('3️⃣ Запрос подтверждения...');
    await sendMessage(BUYER_ID, `Выдавать валюту на ник "${BUYER_NICK}"? (Да/Нет)`, true);
    testOrder.question = true;
    console.log('   ✓ Отправлено\n');
    
    // Шаг 4: Подтверждение "Да"
    console.log('4️⃣ Симуляция ответа "Да"...');
    testOrder.applied = true;
    global.bot.mustGive = testOrder.count * 1000000;
    console.log(`   Сумма к выдаче: ${global.bot.mustGive.toLocaleString()} валюты`);
    console.log(`   Баланс бота: ${(global.bot.balance || 0).toLocaleString()}\n`);
    
    // Проверка баланса
    if (global.bot.balance >= global.bot.mustGive) {
        console.log('5️⃣ Инструкция для покупателя...');
        await sendMessage(
            BUYER_ID,
            `Хорошо. Зайдите на ${global.settings.bot.anarchy} анархию и бот вам сразу отправит деньги. Если вы находились на данной анархии, перезайдите.`,
            true
        );
        console.log('   ✓ Отправлено\n');
        
        console.log('6️⃣ Ожидание входа на сервер...');
        console.log(`   Команда: /pay ${BUYER_NICK} ${global.bot.mustGive}\n`);
        
        console.log('7️⃣ [СИМУЛЯЦИЯ] Деньги переведены!');
        await sendMessage(BUYER_ID, `Успешно перевёл вам ${global.bot.mustGive.toLocaleString()} валюты!`, true);
        await sendMessage(BUYER_ID, 'Подтвердите заказ и напишите отзыв если вам все понравилось!', true);
        console.log('   ✓ Уведомления отправлены\n');
        
        // Завершение
        testOrder.done = true;
        Order.setCurrent(null);
        
        console.log('═'.repeat(50));
        console.log('✅ ТЕСТ ЗАВЕРШЁН УСПЕШНО!');
        console.log('═'.repeat(50));
        console.log(`Покупатель: ${BUYER_NICK}`);
        console.log(`Заказ: ${testOrder.id}`);
        console.log(`Выдано: ${global.bot.mustGive.toLocaleString()} валюты`);
        console.log('═'.repeat(50));
        
    } else {
        console.log('❌ НЕДОСТАТОЧНО БАЛАНСА!');
        console.log(`   Требуется: ${global.bot.mustGive.toLocaleString()}`);
        console.log(`   Доступно: ${(global.bot.balance || 0).toLocaleString()}\n`);
        
        await sendMessage(
            BUYER_ID,
            `У бота не хватает денег! Возвращаю... (Баланс бота: ${global.bot.balance}, надо выдать ${global.bot.mustGive})`,
            true
        );
        
        console.log('🔄 Выполняется возврат средств...');
        Order.setCurrent(null);
        console.log('✅ Возврат выполнен');
    }
} else {
    console.log('❌ Ник не прошёл валидацию!');
    await sendMessage(
        BUYER_ID,
        '❌ Неверный ник. Ник должен состоять из 3–16 символов (латинские буквы, цифры, подчёркивание) и без пробелов. Попробуйте ещё раз.',
        true
    );
}

console.log('\n🧹 Очистка...');
Order.setCurrent(null);
console.log('✓ Готово\n');

process.exit(0);
