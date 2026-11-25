const views = [...document.querySelectorAll('.view')];
const mainContent = document.getElementById('mainContent');
const selectToggle = document.getElementById('selectToggle');
const globalStatus = document.getElementById('globalStatus');
const apiKeyInput = document.getElementById('apiKeyInput');
const modelSelect = document.getElementById('modelSelect');
const customModelInput = document.getElementById('customModelInput');
const customModelField = document.getElementById('customModelField');
const customInstructions = document.getElementById('customInstructions');
const cheatModeToggle = document.getElementById('cheatModeToggle');
const settingsTabs = [
    document.getElementById('generalSettingsTab'),
    document.getElementById('profileSettingsTab')
];
const settingsPanels = [
    document.getElementById('generalSettingsPanel'),
    document.getElementById('profileSettingsPanel')
];
let activeTab;
let activeSettingsTab = 'general';

function showStatus(message, isError = false, target = globalStatus) {
    target.textContent = message;
    target.classList.toggle('error', isError);
}

function showView(name) {
    mainContent.hidden = !name;
    views.forEach((view) => {
        view.hidden = view.id !== `${name}View`;
    });

    if (name === 'settings') {
        setSettingsTab(activeSettingsTab);
    }
}

function setSettingsTab(name) {
    activeSettingsTab = name;
    const profileSelected = name === 'profile';
    settingsTabs[0].setAttribute('aria-selected', String(!profileSelected));
    settingsTabs[1].setAttribute('aria-selected', String(profileSelected));
    settingsPanels[0].hidden = profileSelected;
    settingsPanels[1].hidden = !profileSelected;
}

function readStorage(keys) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(keys, (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            resolve(result);
        });
    });
}

function writeStorage(values) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(values, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            resolve();
        });
    });
}

function setSelectionButton(enabled) {
    selectToggle.setAttribute('aria-pressed', String(enabled));
    selectToggle.title = enabled
        ? 'Disable selection capture'
        : 'Enable selection capture';
}

function setCheatModeButton(enabled) {
    cheatModeToggle.setAttribute('aria-pressed', String(enabled));
    cheatModeToggle.title = enabled
        ? 'Disable Cheat Mode'
        : 'Enable Cheat Mode';
}

document.getElementById('headerSettings').addEventListener('click', () => {
    showView(document.getElementById('settingsView').hidden ? 'settings' : null);
});

document.getElementById('openAskAi').addEventListener('click', () => {
    if (!activeTab?.id) {
        showStatus('Could not identify the current tab. Try again.', true);
        return;
    }

    chrome.sidePanel.open({ tabId: activeTab.id }).catch((error) => {
        showStatus(`Could not open Ask AI: ${error.message}`, true);
    });
});

settingsTabs[0].addEventListener('click', () => setSettingsTab('general'));
settingsTabs[1].addEventListener('click', () => setSettingsTab('profile'));

selectToggle.addEventListener('click', async () => {
    const enabled = selectToggle.getAttribute('aria-pressed') !== 'true';
    try {
        await writeStorage({ sidekickSelectionModeEnabled: enabled });
        setSelectionButton(enabled);
        showStatus(enabled
            ? 'Selection capture is on. Highlight text on the webpage.'
            : 'Selection capture is off.');
    } catch (error) {
        showStatus(`Could not update selection mode: ${error.message}`, true);
    }
});

modelSelect.addEventListener('change', () => {
    customModelField.hidden = modelSelect.value !== 'custom';
    if (!customModelField.hidden) {
        customModelInput.focus();
    } else {
        customModelInput.value = '';
    }
});

document.getElementById('getApiKeyButton').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://aistudio.google.com/app/apikey' });
});

document.getElementById('saveSettingsButton').addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value === 'custom'
        ? customModelInput.value.trim()
        : modelSelect.value;

    if (!apiKey) {
        showStatus('Enter your Gemini API key.', true, document.getElementById('settingsStatus'));
        return;
    }

    if (!model) {
        showStatus('Enter a custom Gemini model name.', true, document.getElementById('settingsStatus'));
        return;
    }

    try {
        await writeStorage({
            geminiApiKey: apiKey,
            geminiModel: model,
            sidekickCustomInstructions: customInstructions.value.trim()
        });
        showStatus('Settings saved.', false, document.getElementById('settingsStatus'));
    } catch (error) {
        showStatus(`Could not save settings: ${error.message}`, true, document.getElementById('settingsStatus'));
    }
});

cheatModeToggle.addEventListener('click', async () => {
    const enabled = cheatModeToggle.getAttribute('aria-pressed') !== 'true';
    cheatModeToggle.disabled = true;
    try {
        await writeStorage({ docsenseCheatModeEnabled: enabled });
        setCheatModeButton(enabled);
        showStatus(enabled ? 'Cheat Mode enabled.' : 'Cheat Mode disabled.');
    } catch (error) {
        showStatus(`Could not update Cheat Mode: ${error.message}`, true);
    } finally {
        cheatModeToggle.disabled = false;
    }
});

async function initializePopup() {
    try {
        const [tabs, settings] = await Promise.all([
            new Promise((resolve, reject) => {
                chrome.tabs.query({ active: true, currentWindow: true }, (result) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    resolve(result);
                });
            }),
            readStorage([
                'geminiApiKey',
                'geminiModel',
                'sidekickCustomInstructions',
                'sidekickSelectionModeEnabled',
                'docsenseCheatModeEnabled'
            ])
        ]);

        activeTab = tabs[0];
        setSelectionButton(settings.sidekickSelectionModeEnabled === true);
        setCheatModeButton(settings.docsenseCheatModeEnabled === true);
        apiKeyInput.value = settings.geminiApiKey || '';
        customInstructions.value = settings.sidekickCustomInstructions || '';

        if (settings.geminiModel) {
            const hasModel = [...modelSelect.options]
                .some((option) => option.value === settings.geminiModel);

            if (hasModel) {
                modelSelect.value = settings.geminiModel;
            } else {
                modelSelect.value = 'custom';
                customModelInput.value = settings.geminiModel;
                customModelField.hidden = false;
            }
        }

    } catch (error) {
        showStatus(`Could not load Sidekick settings: ${error.message}`, true);
    }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.sidekickSelectionModeEnabled) {
        setSelectionButton(changes.sidekickSelectionModeEnabled.newValue === true);
    }

    if (changes.docsenseCheatModeEnabled) {
        setCheatModeButton(changes.docsenseCheatModeEnabled.newValue === true);
    }
});

initializePopup();
