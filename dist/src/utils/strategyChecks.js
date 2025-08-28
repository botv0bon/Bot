"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateStrategy = validateStrategy;
/**
 * Simple strategy validation helpers.
 * Exports a function that checks a normalized strategy for common mistakes and
 * returns an array of human-readable warnings/errors.
 */
function validateStrategy(strategy) {
    const issues = [];
    if (!strategy || typeof strategy !== 'object') {
        issues.push('Strategy is missing or not an object.');
        return issues;
    }
    // Basic numeric sanity
    if (strategy.buyAmount !== undefined && (typeof strategy.buyAmount !== 'number' || isNaN(strategy.buyAmount) || strategy.buyAmount <= 0)) {
        issues.push('buyAmount should be a positive number.');
    }
    if (strategy.minAge !== undefined && (isNaN(Number(strategy.minAge)) || Number(strategy.minAge) < 0)) {
        issues.push('minAge should be a non-negative number (minutes).');
    }
    if (strategy.minVolume !== undefined && (isNaN(Number(strategy.minVolume)) || Number(strategy.minVolume) < 0)) {
        issues.push('minVolume should be a non-negative number (USD).');
    }
    // Logical checks
    if (strategy.enabled === false && strategy.autoBuy === true) {
        issues.push('Strategy is disabled but autoBuy is enabled; autoBuy will not run while disabled.');
    }
    if (strategy.target1 !== undefined && strategy.target2 !== undefined && Number(strategy.target1) >= Number(strategy.target2)) {
        issues.push('target1 should be less than target2 for progressive sells.');
    }
    // Warn on missing trade params when autoBuy enabled
    if (strategy.autoBuy !== false && (strategy.buyAmount === undefined || Number(strategy.buyAmount) <= 0)) {
        issues.push('autoBuy is enabled but buyAmount is missing or not positive.');
    }
    return issues;
}
exports.default = { validateStrategy };
