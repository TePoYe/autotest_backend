export function selectLatestBotAnswer(messageTexts, beforeCount, previousAnswer = '') {
    const normalizedMessages = (messageTexts || [])
        .map((text) => (text || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    if (normalizedMessages.length <= beforeCount) {
        return null;
    }

    const latest = normalizedMessages[normalizedMessages.length - 1];
    const previous = (previousAnswer || '').replace(/\s+/g, ' ').trim();

    if (previous && latest === previous) {
        return null;
    }

    return latest;
}
