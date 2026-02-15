const { Vec3 } = require('vec3');

class SpookyRotation {
    constructor() {
        this.lastYaw = 0;
        this.lastPitch = 0;
        this.rotate = { x: 0, y: 0 }; // Current rotation (yaw, pitch)
    }

    /**
     * Wrap degrees to -180 to 180
     */
    wrapDegrees(matches) {
        let value = matches % 360.0;
        if (value >= 180.0) {
            value -= 360.0;
        }
        if (value < -180.0) {
            value += 360.0;
        }
        return value;
    }

    clamp(val, min, max) {
        return Math.min(Math.max(val, min), max);
    }

    getGCDValue() {
        // Standard "sensitivity" based GCD. 
        // In MC: f = sensitivity * 0.6 + 0.2; gcd = f * f * f * 8.0 * 0.15;
        // Assuming a sensitivity of ~0.5 (100%)
        const sensitivity = 0.5;
        const f = sensitivity * 0.6 + 0.2;
        return f * f * f * 8.0 * 0.15;
    }

    /**
     * Calculates the next rotation packet based on "Spookytime" logic
     * @param {Object} bot - Mineflayer bot instance
     * @param {Vec3} targetPos - Target position to look at
     * @returns {Object} { yaw, pitch } in radians (Mineflayer expects radians)
     */
    getNextRotation(bot, targetPos) {
        if (!bot || !bot.entity) return null;

        // Current bot rotation (Mineflayer uses radians, algorithm uses degrees)
        const currentYawDeg = (bot.entity.yaw * 180) / Math.PI; // -PI to PI -> -180 to 180
        const currentPitchDeg = (bot.entity.pitch * 180) / Math.PI;

        // Initialize state if needed
        if (this.rotate.x === 0 && this.rotate.y === 0) {
            this.rotate.x = currentYawDeg;
            this.rotate.y = currentPitchDeg;
            this.lastYaw = 0; // Relative delta state
            this.lastPitch = 0;
        }

        // Calculate deltas to target
        const eyePos = bot.entity.position.offset(0, bot.entity.height, 0);
        const vecToTarget = targetPos.minus(eyePos);

        const dist = Math.sqrt(vecToTarget.x * vecToTarget.x + vecToTarget.z * vecToTarget.z);
        const targetYaw = this.wrapDegrees(Math.atan2(vecToTarget.z, vecToTarget.x) * (180 / Math.PI) - 90.0);
        const targetPitch = this.wrapDegrees(-Math.atan2(vecToTarget.y, dist) * (180 / Math.PI));

        let yawDelta = this.wrapDegrees(targetYaw - this.rotate.x);
        let pitchDelta = this.wrapDegrees(targetPitch - this.rotate.y);

        // --- Spookytime Logic ---
        // Constants (from snippet)
        let clampedYaw = this.clamp(Math.abs(yawDelta), 0.0001, 22.5); // Max 22.5 degrees per tick
        let clampedPitch = this.clamp(Math.abs(pitchDelta), 0.0001, 7.0); // Max 7.0 degrees per tick

        // Random factors
        const randomYawFactor = (Math.random() * 2.5) - 1.5;
        const randomPitchFactor = (Math.random() * 2.5) - 1.0;
        const randomThreshold = Math.random() * 2.5;
        const randomAddition = (Math.random() * 3.5) + 2.5;

        // "Selection" logic simulation: We assume "selected != target" to maximize Pitch speed for snapping?
        // Snippet: if (this.selected != this.target) clampedPitch = Math.max(Math.abs(pitchDelta), 1.0F);
        // We'll mimic "snapping" behavior
        clampedPitch = Math.max(Math.abs(pitchDelta), 1.0);

        // Jitter logic
        if (Math.abs(clampedYaw - this.lastYaw) <= randomThreshold) {
            clampedYaw = this.lastYaw + randomAddition;
        }

        clampedYaw += randomYawFactor;
        clampedPitch += randomPitchFactor;

        // Apply
        let nextYaw = this.rotate.x + (yawDelta > 0 ? clampedYaw : -clampedYaw);
        let nextPitch = this.clamp(this.rotate.y + (pitchDelta > 0 ? clampedPitch : -clampedPitch), -90.0, 90.0);

        // GCD Fix
        const gcd = this.getGCDValue();
        nextYaw -= (nextYaw - this.rotate.x) % gcd;
        nextPitch -= (nextPitch - this.rotate.y) % gcd;

        // Update state
        this.rotate.x = nextYaw;
        this.rotate.y = nextPitch;
        this.lastYaw = clampedYaw;
        this.lastPitch = clampedPitch;

        // Convert back to radians for Mineflayer
        return {
            yaw: (nextYaw * Math.PI) / 180,
            pitch: (nextPitch * Math.PI) / 180
        };
    }
}

module.exports = new SpookyRotation();
