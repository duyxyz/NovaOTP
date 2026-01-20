/**
 * Storage management for accounts and settings
 */

export async function loadAccounts() {
    try {
        const result = await chrome.storage.local.get(['accounts']);
        return result.accounts || [];
    } catch (err) {
        console.error('Error loading accounts:', err);
        return [];
    }
}

export async function saveAccounts(accounts) {
    try {
        await chrome.storage.local.set({ accounts });
    } catch (err) {
        console.error('Error saving accounts:', err);
    }
}

export async function loadGitSettings() {
    const result = await chrome.storage.local.get(['ghToken', 'ghProjNum']);
    return result;
}

export async function saveGitSettings(token, projNum) {
    await chrome.storage.local.set({ ghToken: token, ghProjNum: projNum });
}
