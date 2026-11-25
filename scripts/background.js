importScripts('./ai.js');

chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: false
}).catch((error) => {
    console.error('[Sidekick] Could not restore popup toolbar behavior:', error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'ASK_GEMINI') {
        return false;
    }

    if (typeof message.prompt !== 'string' || !message.prompt.trim()) {
        sendResponse({ error: { message: 'A non-empty prompt is required.' } });
        return false;
    }

    chrome.storage.local.get(
        ['geminiApiKey', 'geminiModel', 'sidekickCustomInstructions'],
        async (settings) => {
            if (chrome.runtime.lastError) {
                sendResponse({
                    error: { message: chrome.runtime.lastError.message }
                });
                return;
            }

            if (!settings.geminiApiKey) {
                sendResponse({
                    error: { message: 'No Gemini API key found. Add one in Sidekick Settings.' }
                });
                return;
            }

            const customInstructions =
                typeof settings.sidekickCustomInstructions === 'string'
                    ? settings.sidekickCustomInstructions.trim().slice(0, 4000)
                    : '';
            const prompt = customInstructions
                ? `${message.prompt}\n\nAdditional user response preferences:\n${customInstructions}`
                : message.prompt;

            try {
                const response = await askGemini(
                    prompt,
                    settings.geminiApiKey,
                    settings.geminiModel || 'gemini-3.5-flash-lite'
                );
                sendResponse(response);
            } catch (error) {
                console.error('Background Gemini request failed:', error);
                sendResponse({
                    error: { message: error.message || 'Gemini request failed.' }
                });
            }
        }
    );

    return true;
});
