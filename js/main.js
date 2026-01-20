import { loadAccounts, saveAccounts, loadGitSettings, saveGitSettings } from './modules/storage.js';
import { decodeBase64, createRipple } from './modules/utils.js';
import { parseProtobuf } from './modules/google-importer.js';
import { backupToGitHub, restoreFromGitHub } from './modules/github-backup.js';
import { encryptData, decryptData, generateBackupFilename } from './modules/crypto.js';
import * as UI from './modules/ui.js';

/**
 * Main application logic for NovaOTP
 */

let accounts = [];
let currentSearchQuery = '';

// --- Core functions ---

async function init() {
  accounts = await loadAccounts();
  renderApp();
  updateTimer();
  setupEventListeners();
}

function renderApp() {
  UI.renderAccounts(accounts, currentSearchQuery, copyCode, onReorder);
  UI.updateAllOTP(accounts);
}

function onReorder() {
  const list = document.getElementById('accountsList');
  const items = [...list.querySelectorAll('.account-item')];
  const newOrderIndices = items.map(i => parseInt(i.dataset.index));
  accounts = newOrderIndices.map(oldIdx => accounts[oldIdx]);
  UI.updateDOMIndices();
  saveAccounts(accounts);
}

async function copyCode(index) {
  const otpElement = document.getElementById(`otp-${index}`);
  if (!otpElement) return;
  const code = otpElement.textContent;
  if (code !== 'ERROR' && code !== '------') {
    try {
      await navigator.clipboard.writeText(code);
      const itemElement = document.querySelector(`.account-item[data-index="${index}"]`);
      if (itemElement) {
        itemElement.classList.add('copied');
        setTimeout(() => itemElement.classList.remove('copied'), 1000);
      }
    } catch (err) {
      console.error('Copy failed:', err);
    }
  }
}

function updateTimer() {
  const epoch = Math.floor(Date.now() / 1000);
  const remaining = 30 - (epoch % 30);
  if (remaining === 30 && accounts.length > 0) {
    UI.updateAllOTP(accounts);
  }
  setTimeout(updateTimer, 1000);
}

// --- Action Handlers ---

async function handleGoogleImport() {
  const uri = document.getElementById('uriInput').value.trim();
  try {
    if (!uri.startsWith('otpauth-migration://offline?data=')) {
      throw new Error('Invalid Google Authenticator URI');
    }
    const dataParam = uri.split('data=')[1];
    const base64Data = decodeURIComponent(dataParam);
    const bytes = decodeBase64(base64Data);
    const newAccounts = parseProtobuf(bytes);

    if (newAccounts.length === 0) throw new Error('No accounts found');

    accounts.push(...newAccounts);
    await saveAccounts(accounts);
    renderApp();
    UI.closeSettings();
  } catch (err) {
    UI.setModalError(err.message);
  }
}

async function handleManualAdd() {
  const name = document.getElementById('manualName').value.trim();
  const issuer = document.getElementById('manualIssuer').value.trim();
  let secret = document.getElementById('manualSecret').value.trim().toUpperCase().replace(/\s/g, '');

  try {
    if (!name) throw new Error('Please enter account name');
    if (!secret) throw new Error('Please enter Secret Key');
    const base32Regex = /^[A-Z2-7]+=*$/;
    if (!base32Regex.test(secret)) throw new Error('Invalid Secret Key');

    accounts.push({
      secretBase32: secret,
      name: name,
      issuer: issuer,
      type: 'TOTP',
      digits: 6
    });

    await saveAccounts(accounts);
    renderApp();
    UI.clearInputs(['manualName', 'manualIssuer', 'manualSecret']);
    UI.closeSettings();
  } catch (err) {
    UI.setModalError(err.message);
  }
}

// --- Edit Handlers ---

function openEditModal() {
  const modal = document.getElementById('editModal');
  document.getElementById('editMsg').style.display = 'none';
  document.getElementById('editListContainer').style.display = 'flex';
  document.getElementById('editFormContainer').style.display = 'none';
  UI.renderEditList(accounts, handleEditSelect);
  modal.style.display = 'block';
  setTimeout(() => modal.classList.add('active'), 10);
}

function closeEditModal() {
  const modal = document.getElementById('editModal');
  modal.classList.remove('active');
  setTimeout(() => modal.style.display = 'none', 300);
}

function handleEditSelect(index) {
  const account = accounts[index];
  if (!account) return;

  document.getElementById('editMsg').style.display = 'none';
  document.getElementById('editAccountIndex').value = index;
  document.getElementById('editName').value = account.name || '';
  document.getElementById('editIssuer').value = account.issuer || '';
  document.getElementById('editSecret').value = account.secretBase32 || account.secret || '';

  document.getElementById('editListContainer').style.display = 'none';
  document.getElementById('editFormContainer').style.display = 'flex';
}

async function handleSaveEdit() {
  const index = parseInt(document.getElementById('editAccountIndex').value);
  const name = document.getElementById('editName').value.trim();
  const issuer = document.getElementById('editIssuer').value.trim();
  let secret = document.getElementById('editSecret').value.trim().toUpperCase().replace(/\s/g, '');

  try {
    if (!name) throw new Error('Name is required');
    if (!secret) throw new Error('Secret is required');
    if (!/^[A-Z2-7]+=*$/.test(secret)) throw new Error('Invalid Secret Key');

    accounts[index] = {
      ...accounts[index],
      name: name,
      issuer: issuer,
      secretBase32: secret
    };

    await saveAccounts(accounts);
    renderApp();

    UI.setEditStatus('Account updated!', 'success');
    setTimeout(() => {
      document.getElementById('editFormContainer').style.display = 'none';
      document.getElementById('editListContainer').style.display = 'flex';
      UI.renderEditList(accounts, handleEditSelect);
      document.getElementById('editMsg').style.display = 'none';
    }, 1000);
  } catch (err) {
    UI.setEditStatus(err.message, 'error');
  }
}

// --- GitHub Handlers ---

async function handleGitHubBackup() {
  const token = document.getElementById('githubToken').value.trim();
  const password = document.getElementById('githubPassword').value.trim();
  const gistIdInput = document.getElementById('githubProjectNumber').value.trim();

  if (!token || !password) {
    UI.setGitHubStatus('Token and Password required', 'error');
    return;
  }

  UI.openConfirmModal({
    title: 'Backup to GitHub',
    message: 'Overwrite existing backup for this password?',
    confirmText: 'Backup',
    confirmColor: '#3b82f6',
    icon: 'cloud_upload',
    onConfirm: async () => {
      UI.setGitHubStatus('Backing up...');
      try {
        const filename = await generateBackupFilename(password);
        const encryptedData = await encryptData(JSON.stringify(accounts), password);
        const newGistId = await backupToGitHub(token, gistIdInput, encryptedData, filename);
        await saveGitSettings(token, newGistId);
        document.getElementById('githubProjectNumber').value = newGistId;
        UI.setGitHubStatus('Success!', 'success');
      } catch (err) {
        UI.setGitHubStatus(err.message, 'error');
      }
    }
  });
}

async function handleGitHubRestore() {
  const token = document.getElementById('githubToken').value.trim();
  const password = document.getElementById('githubPassword').value.trim();
  const gistIdInput = document.getElementById('githubProjectNumber').value.trim();

  if (!token || !password) {
    UI.setGitHubStatus('Token and Password required', 'error');
    return;
  }

  UI.openConfirmModal({
    title: 'Restore from GitHub',
    message: 'COMPLETELY OVERWRITE local data?',
    confirmText: 'Restore',
    confirmColor: '#166534',
    icon: 'cloud_download',
    onConfirm: async () => {
      UI.setGitHubStatus('Restoring...');
      try {
        const filename = await generateBackupFilename(password);
        const encryptedData = await restoreFromGitHub(token, gistIdInput, filename);
        accounts = JSON.parse(await decryptData(encryptedData, password));
        await saveAccounts(accounts);
        renderApp();
        UI.setGitHubStatus('Restored!', 'success');
      } catch (err) {
        UI.setGitHubStatus(err.message, 'error');
      }
    }
  });
}

function handleDeleteSelected() {
  const checked = document.querySelectorAll('.delete-checkbox:checked');
  if (checked.length === 0) return;

  UI.openConfirmModal({
    title: 'Delete Accounts',
    message: `Delete ${checked.length} selected accounts?`,
    confirmText: 'Delete',
    onConfirm: async () => {
      const indices = new Set(Array.from(checked).map(cb => parseInt(cb.value)));
      accounts = accounts.filter((_, idx) => !indices.has(idx));
      await saveAccounts(accounts);
      renderApp();
      UI.renderDeleteList(accounts);
    }
  });
}

// --- Events ---

function setupEventListeners() {
  document.getElementById('settingsBtn').addEventListener('click', UI.openSettings);
  document.getElementById('closeSettingsBtn').addEventListener('click', UI.closeSettings);
  document.getElementById('openGuideBtn').addEventListener('click', () => chrome.tabs.create({ url: 'pages/guide.html' }));

  // Edit logic
  document.getElementById('editBtn').addEventListener('click', openEditModal);
  document.getElementById('closeEditModalBtn').addEventListener('click', closeEditModal);
  document.getElementById('backToEditListBtn').addEventListener('click', () => {
    document.getElementById('editFormContainer').style.display = 'none';
    document.getElementById('editListContainer').style.display = 'flex';
    document.getElementById('editMsg').style.display = 'none';
  });
  document.getElementById('saveEditBtn').addEventListener('click', handleSaveEdit);

  document.getElementById('submitBtn').addEventListener('click', handleGoogleImport);
  document.getElementById('submitManualBtn').addEventListener('click', handleManualAdd);
  document.getElementById('githubBackupBtn').addEventListener('click', handleGitHubBackup);
  document.getElementById('githubRestoreBtn').addEventListener('click', handleGitHubRestore);
  document.getElementById('deleteSelectedBtn').addEventListener('click', handleDeleteSelected);

  document.getElementById('confirmModal').addEventListener('click', (e) => {
    if (e.target.id === 'confirmModal') UI.closeConfirmModal();
  });
  document.getElementById('cancelDeleteBtn').addEventListener('click', UI.closeConfirmModal);

  document.getElementById('searchInput').addEventListener('input', (e) => {
    currentSearchQuery = e.target.value;
    UI.filterAccounts(accounts, currentSearchQuery);
  });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
      if (tab.dataset.tab === 'delete') UI.renderDeleteList(accounts);
      if (tab.dataset.tab === 'github') loadGitSettings().then(s => {
        if (s.ghToken) document.getElementById('githubToken').value = s.ghToken;
        if (s.ghProjNum) document.getElementById('githubProjectNumber').value = s.ghProjNum;
      });
    });
  });
}

init();