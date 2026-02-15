/**
 * Generates a human-like look path.
 * Simulates:
 * 1. Reaction delay (still).
 * 2. Looking down to check landing (rapid but smooth).
 * 3. Micro-adjustments (seeking).
 */
function generateHumanFallPath(startYaw, startPitch, durationMs = 3000) {
    const path = [];
    const avgStep = 60; // Average 60ms per packet
    const steps = Math.floor(durationMs / avgStep);

    // Target: Look down (~80 degrees / 1.4 rads) and close to current yaw (maybe slight pan)
    // Looking down is the most natural reaction to falling
    const targetPitch = 1.35 + (Math.random() * 0.15); // Almost straight down
    const targetYaw = startYaw + (Math.random() - 0.5) * 0.5; // Slight yaw drift

    // Simple Cubic Ease-Out for pitch (look down fast, then settle)
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    let currentTime = 0;

    // 1. REACTION DELAY: Stay still for ~300-600ms
    const reactionDelay = 300 + Math.random() * 300;
    let delaySteps = Math.floor(reactionDelay / avgStep);
    for (let i = 0; i < delaySteps; i++) {
        path.push({
            yaw: startYaw,
            pitch: startPitch,
            delay: 40 + Math.random() * 40 // variable polling 40-80ms
        });
    }

    // 2. ACTION: Look down
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const easedT = easeOutCubic(t);

        // Add varying "hand tremor" noise
        const noiseYaw = (Math.random() - 0.5) * 0.015;
        const noisePitch = (Math.random() - 0.5) * 0.015;

        path.push({
            yaw: startYaw + ((targetYaw - startYaw) * easedT) + noiseYaw,
            pitch: startPitch + ((targetPitch - startPitch) * easedT) + noisePitch,
            delay: 35 + Math.random() * 50 // Variable delay 35-85ms (simulating OS/mouse poll variance)
        });
    }
    return path;
}

class MouseRecorder {
    static async play(bot, path) {
        if (!bot || !path || path.length === 0) return;

        // Clear any existing playback
        if (bot._mousePlaybackTimeout) {
            clearTimeout(bot._mousePlaybackTimeout);
            bot._mousePlaybackTimeout = null;
        }

        let index = 0;

        const nextStep = () => {
            if (!bot.entity || index >= path.length) {
                bot._mousePlaybackTimeout = null;
                return;
            }

            const point = path[index++];
            // Send look packet
            bot.look(point.yaw, point.pitch, true).catch(() => { });

            // Schedule next update with variable delay
            bot._mousePlaybackTimeout = setTimeout(nextStep, point.delay || 50);
        };

        // Start immediate
        nextStep();
    }

    static stop(bot) {
        if (bot._mousePlaybackTimeout) {
            clearTimeout(bot._mousePlaybackTimeout);
            bot._mousePlaybackTimeout = null;
        }
    }

    static isPlaying(bot) {
        return !!bot._mousePlaybackTimeout;
    }

    static generateHumanFall(bot) {
        if (!bot || !bot.entity) return [];
        return generateHumanFallPath(bot.entity.yaw, bot.entity.pitch, 3500);
    }
}

module.exports = MouseRecorder;
