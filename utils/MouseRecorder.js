const { Easing } = require('bezier-easing'); // No, let's stick to simple math to avoid deps

/**
 * Generates a human-like look path.
 * Simulates:
 * 1. Reaction delay (still).
 * 2. Looking down to check landing (rapid but smooth).
 * 3. Micro-adjustments (seeking).
 */
function generateHumanFallPath(startYaw, startPitch, durationMs = 3000) {
    const path = [];
    const steps = Math.floor(durationMs / 50); // 50ms ticks

    // Target: Look down (~80 degrees / 1.4 rads) and slightly change yaw
    // Randomize target slightly
    const targetPitch = 1.3 + (Math.random() * 0.2);
    const targetYaw = startYaw + (Math.random() - 0.5) * 1.0; // +/- ~30 degrees

    // Simple Cubic Ease-Out
    // t: 0..1
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const easedT = easeOutCubic(t);

        // Add noise (hand tremor)
        const noiseYaw = (Math.random() - 0.5) * 0.02;
        const noisePitch = (Math.random() - 0.5) * 0.02;

        path.push({
            yaw: startYaw + ((targetYaw - startYaw) * easedT) + noiseYaw,
            pitch: startPitch + ((targetPitch - startPitch) * easedT) + noisePitch
        });
    }
    return path;
}

class MouseRecorder {
    static async play(bot, path) {
        if (!bot || !path || path.length === 0) return;

        let index = 0;
        return new Promise((resolve) => {
            const interval = setInterval(() => {
                if (!bot.entity || index >= path.length) {
                    clearInterval(interval);
                    resolve();
                    return;
                }

                const point = path[index++];
                bot.look(point.yaw, point.pitch, true).catch(() => { });
            }, 50);

            // Store interval on bot to allow cancellation
            bot._mousePlaybackInterval = interval;
        });
    }

    static stop(bot) {
        if (bot._mousePlaybackInterval) {
            clearInterval(bot._mousePlaybackInterval);
            bot._mousePlaybackInterval = null;
        }
    }

    static generateHumanFall(bot) {
        if (!bot || !bot.entity) return [];
        return generateHumanFallPath(bot.entity.yaw, bot.entity.pitch, 4000);
    }
}

module.exports = MouseRecorder;
