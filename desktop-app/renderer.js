// POLYFILL: Giả lập chrome.storage.local cho Desktop dùng localStorage
window.chrome = {
    storage: {
        local: {
            get: (keys) => {
                return new Promise((resolve) => {
                    const res = {};
                    keys.forEach(key => {
                        const val = localStorage.getItem(key);
                        res[key] = val ? JSON.parse(val) : undefined;
                    });
                    resolve(res);
                });
            },
            set: (data) => {
                return new Promise((resolve) => {
                    Object.keys(data).forEach(key => {
                        localStorage.setItem(key, JSON.stringify(data[key]));
                    });
                    resolve();
                });
            }
        }
    },
    tabs: {
        create: (options) => {
            // Trong Electron, window.open mặc định sẽ mở bằng trình duyệt hệ thống 
            // nếu đã được config trong main.js WindowOpenHandler
            window.open(options.url, '_blank');
        }
    }
};

let accounts = [];
let currentSearchQuery = '';

// Load accounts from storage
async function loadAccounts() {
    try {
        const result = await chrome.storage.local.get(['accounts']);
        accounts = result.accounts || [];
        renderAccounts();
        if (accounts.length > 0) {
            updateAllOTP();
        }
    } catch (err) {
        console.error('Error loading accounts:', err);
    }
}

// Save accounts to storage
async function saveAccounts() {
    try {
        await chrome.storage.local.set({ accounts });
    } catch (err) {
        console.error('Error saving accounts:', err);
    }
}

// Search/Filter accounts
function filterAccounts(query) {
    currentSearchQuery = query.toLowerCase().trim();
    const clearBtn = document.getElementById('clearSearch');

    // Show/hide clear button
    clearBtn.style.display = currentSearchQuery ? 'flex' : 'none';

    const accountItems = document.querySelectorAll('.account-item');
    const emptyState = document.getElementById('emptyState');
    const noResults = document.getElementById('noResults');
    const accountsList = document.getElementById('accountsList');

    let visibleCount = 0;

    accountItems.forEach((item, index) => {
        const account = accounts[index];
        if (!account) return;

        const searchText = `${account.name} ${account.issuer}`.toLowerCase();
        const isMatch = searchText.includes(currentSearchQuery);

        if (isMatch || !currentSearchQuery) {
            item.classList.remove('hidden');
            visibleCount++;
        } else {
            item.classList.add('hidden');
        }
    });

    // Show appropriate state
    if (accounts.length === 0) {
        emptyState.style.display = 'flex';
        noResults.style.display = 'none';
        accountsList.style.display = 'block';
    } else if (visibleCount === 0 && currentSearchQuery) {
        emptyState.style.display = 'none';
        noResults.style.display = 'flex';
        accountsList.style.display = 'none';
    } else {
        emptyState.style.display = 'none';
        noResults.style.display = 'none';
        accountsList.style.display = 'block';
    }
}

// Clear search
function clearSearch() {
    const searchInput = document.getElementById('searchInput');
    searchInput.value = '';
    filterAccounts('');
    searchInput.focus();
}

// Decode base64
function decodeBase64(str) {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// Encode to base32
function base32Encode(bytes) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    let output = '';

    for (let i = 0; i < bytes.length; i++) {
        value = (value << 8) | bytes[i];
        bits += 8;

        while (bits >= 5) {
            output += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }

    if (bits > 0) {
        output += alphabet[(value << (5 - bits)) & 31];
    }

    return output;
}

// Parse protobuf
function parseProtobuf(bytes) {
    const accounts = [];
    let i = 0;

    while (i < bytes.length) {
        const fieldTag = bytes[i++];
        const wireType = fieldTag & 0x07;
        const fieldNum = fieldTag >> 3;

        if (wireType === 2) {
            let length = 0;
            let shift = 0;
            while (i < bytes.length) {
                const byte = bytes[i++];
                length |= (byte & 0x7f) << shift;
                if ((byte & 0x80) === 0) break;
                shift += 7;
            }

            if (fieldNum === 1) {
                const accountData = bytes.slice(i, i + length);
                const account = parseAccount(accountData);
                if (account) accounts.push(account);
            }
            i += length;
        } else if (wireType === 0) {
            while (i < bytes.length && (bytes[i] & 0x80)) i++;
            i++;
        } else {
            i++;
        }
    }

    return accounts;
}

// Parse single account
function parseAccount(bytes) {
    const account = { secretBase32: '', name: '', issuer: '', type: 'TOTP', digits: 6 };
    let i = 0;

    while (i < bytes.length) {
        const fieldTag = bytes[i++];
        const wireType = fieldTag & 0x07;
        const fieldNum = fieldTag >> 3;

        if (wireType === 2) {
            let length = 0;
            let shift = 0;
            while (i < bytes.length) {
                const byte = bytes[i++];
                length |= (byte & 0x7f) << shift;
                if ((byte & 0x80) === 0) break;
                shift += 7;
            }

            const value = bytes.slice(i, i + length);

            if (fieldNum === 1) {
                account.secretBase32 = base32Encode(value);
            } else if (fieldNum === 2) {
                account.name = new TextDecoder().decode(value);
            } else if (fieldNum === 3) {
                account.issuer = new TextDecoder().decode(value);
            }
            i += length;
        } else if (wireType === 0) {
            let value = 0;
            let shift = 0;
            while (i < bytes.length) {
                const byte = bytes[i++];
                value |= (byte & 0x7f) << shift;
                if ((byte & 0x80) === 0) break;
                shift += 7;
            }

            if (fieldNum === 4) account.type = value === 1 ? 'TOTP' : 'HOTP';
            if (fieldNum === 5) {
                account.digits = value && value > 0 ? value : 6;
            }
        } else {
            i++;
        }
    }

    if (!account.digits || account.digits < 6 || account.digits > 8) {
        account.digits = 6;
    }

    return account;
}

function createRipple(event) {
    const button = event.currentTarget;
    const ripple = document.createElement("span");
    const rect = button.getBoundingClientRect();

    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.classList.add("ripple");

    const prevRipple = button.getElementsByClassName("ripple")[0];
    if (prevRipple) {
        prevRipple.remove();
    }

    button.appendChild(ripple);

    setTimeout(() => {
        ripple.remove();
    }, 600);
}

// Render accounts - LIST VERSION
function renderAccounts() {
    const emptyState = document.getElementById('emptyState');
    const accountsList = document.getElementById('accountsList');
    const noResults = document.getElementById('noResults');

    if (accounts.length === 0) {
        emptyState.style.display = 'flex';
        noResults.style.display = 'none';
        accountsList.innerHTML = '';
    } else {
        emptyState.style.display = 'none';

        accountsList.innerHTML = accounts.map((account, index) => {
            return `
      <div class="account-item" data-index="${index}">
        <div class="drag-handle">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="19" r="1"></circle>
            <circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="19" r="1"></circle>
          </svg>
        </div>
        <div class="account-info">
          <div class="account-name">${escapeHtml(account.issuer || account.name)}</div>
          ${account.issuer && account.name ? `<div class="account-issuer">${escapeHtml(account.name)}</div>` : ''}
        </div>
        <div class="otp-display">
          <div class="otp-code" id="otp-${index}">------</div>
        </div>
      </div>
    `;
        }).join('');

        // Add click and drag listeners to account items
        document.querySelectorAll('.account-item').forEach(item => {
            const handle = item.querySelector('.drag-handle');

            handle.addEventListener('mousedown', () => item.setAttribute('draggable', 'true'));
            handle.addEventListener('mouseup', () => item.removeAttribute('draggable'));

            item.addEventListener('click', function (e) {
                if (this.classList.contains('dragging') || e.target.closest('.drag-handle')) return;
                createRipple(e);
                const index = parseInt(this.dataset.index);
                copyCode(index);
            });

            item.addEventListener('dragstart', (e) => {
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            item.addEventListener('dragend', async () => {
                item.classList.remove('dragging');
                item.removeAttribute('draggable');

                const list = document.getElementById('accountsList');
                const newOrderIndices = [...list.querySelectorAll('.account-item')].map(i => parseInt(i.dataset.index));
                const newAccounts = newOrderIndices.map(oldIdx => accounts[oldIdx]);
                accounts = newAccounts;
                await saveAccounts();
                renderAccounts();
                updateAllOTP();
            });
        });

        const list = document.getElementById('accountsList');
        list.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggingItem = document.querySelector('.dragging');
            if (!draggingItem) return;

            const afterElement = Array.from(list.querySelectorAll('.account-item:not(.dragging)')).reduce((closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = e.clientY - box.top - box.height / 2;
                if (offset < 0 && offset > closest.offset) {
                    return { offset: offset, element: child };
                } else {
                    return closest;
                }
            }, { offset: Number.NEGATIVE_INFINITY }).element;

            if (afterElement == null) {
                list.appendChild(draggingItem);
            } else {
                list.insertBefore(draggingItem, afterElement);
            }
        });

        if (currentSearchQuery) {
            filterAccounts(currentSearchQuery);
        }
    }
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Update all OTP codes
async function updateAllOTP() {
    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        const otpElement = document.getElementById(`otp-${i}`);

        if (otpElement) {
            try {
                const code = await TOTP.generate(account.secretBase32, account.digits);
                otpElement.textContent = code;
            } catch (err) {
                console.error('Error generating OTP:', err);
                otpElement.textContent = 'ERROR';
            }
        }
    }
    updateTimer();
}

// Update timer
function updateTimer() {
    const epoch = Math.floor(Date.now() / 1000);
    const remaining = 30 - (epoch % 30);
    if (remaining === 30 && accounts.length > 0) {
        updateAllOTP();
    }
    setTimeout(updateTimer, 1000);
}

// Copy code to clipboard with visual feedback
async function copyCode(index) {
    const otpElement = document.getElementById(`otp-${index}`);
    const itemElement = document.querySelector(`.account-item[data-index="${index}"]`);
    if (!otpElement) return;
    const code = otpElement.textContent;

    if (code !== 'ERROR' && code !== '------') {
        try {
            await navigator.clipboard.writeText(code);
            if (itemElement) {
                itemElement.classList.add('copied');
                setTimeout(() => {
                    itemElement.classList.remove('copied');
                }, 1000);
            }
        } catch (err) {
            console.error('Cannot copy:', err);
        }
    }
}

// Open modal
function openSettings() {
    const modal = document.getElementById('settingsModal');
    const input = document.getElementById('uriInput');
    const error = document.getElementById('modalError');

    modal.style.display = 'block';
    modal.offsetHeight;
    modal.classList.add('active');

    input.value = '';
    error.style.display = 'none';
}

// Close modal
function closeSettings() {
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

// Add accounts from URI
async function addAccounts() {
    const uri = document.getElementById('uriInput').value.trim();
    const errorDiv = document.getElementById('modalError');
    errorDiv.style.display = 'none';

    try {
        if (!uri.startsWith('otpauth-migration://offline?data=')) {
            throw new Error('Invalid URI. URI must start with "otpauth-migration://offline?data="');
        }
        const dataParam = uri.split('data=')[1];
        if (!dataParam) throw new Error('No data found in URI');
        const base64Data = decodeURIComponent(dataParam);
        const bytes = decodeBase64(base64Data);
        const newAccounts = parseProtobuf(bytes);
        if (newAccounts.length === 0) throw new Error('No accounts found in data');
        accounts.push(...newAccounts);
        await saveAccounts();
        renderAccounts();
        updateAllOTP();
        closeSettings();
    } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.style.display = 'block';
    }
}

// Add manual account
async function addManualAccount() {
    const name = document.getElementById('manualName').value.trim();
    const issuer = document.getElementById('manualIssuer').value.trim();
    let secret = document.getElementById('manualSecret').value.trim().toUpperCase().replace(/\s/g, '');
    const errorDiv = document.getElementById('modalError');
    errorDiv.style.display = 'none';

    try {
        if (!name) throw new Error('Please enter account name');
        if (!secret) throw new Error('Please enter Secret Key');
        const base32Regex = /^[A-Z2-7]+=*$/;
        if (!base32Regex.test(secret)) throw new Error('Invalid Secret Key (Only A-Z and 2-7 allowed)');

        const newAccount = {
            secretBase32: secret,
            name: name,
            issuer: issuer || '',
            type: 'TOTP',
            digits: 6,
            period: 30
        };

        accounts.push(newAccount);
        await saveAccounts();
        renderAccounts();
        updateAllOTP();
        document.getElementById('manualName').value = '';
        document.getElementById('manualIssuer').value = '';
        document.getElementById('manualSecret').value = '';
        closeSettings();
    } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.style.display = 'block';
    }
}

// Toggle Select All
function toggleSelectAll() {
    const selectAll = document.getElementById('selectAllCheckbox');
    const checkboxes = document.querySelectorAll('.delete-checkbox');
    checkboxes.forEach(cb => cb.checked = selectAll.checked);
}

// Render Delete List
function renderDeleteList() {
    const container = document.getElementById('deleteList');
    const deleteBtn = document.getElementById('deleteSelectedBtn');
    const selectAll = document.getElementById('selectAllCheckbox');
    if (!container) return;
    if (selectAll) selectAll.checked = false;

    if (accounts.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:10px;">No accounts available</div>';
        deleteBtn.style.display = 'none';
        if (selectAll) selectAll.disabled = true;
        return;
    }
    if (selectAll) selectAll.disabled = false;
    container.innerHTML = accounts.map((acc, idx) => `
    <label class="delete-list-item" data-idx="${idx}">
      <input type="checkbox" class="delete-checkbox" value="${idx}">
      <span>${escapeHtml(acc.issuer ? acc.issuer + ' (' + acc.name + ')' : acc.name)}</span>
    </label>
  `).join('');

    document.querySelectorAll('.delete-list-item').forEach(item => {
        item.addEventListener('click', createRipple);
    });
    deleteBtn.style.display = 'block';

    const checkboxes = document.querySelectorAll('.delete-checkbox');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            const allChecked = Array.from(checkboxes).every(c => c.checked);
            if (selectAll) selectAll.checked = allChecked;
        });
    });
}

// Delete selected accounts
function deleteSelectedAccounts() {
    const checked = document.querySelectorAll('.delete-checkbox:checked');
    if (checked.length === 0) {
        alert('Please select at least 1 account to delete');
        return;
    }
    const confirmModal = document.getElementById('confirmModal');
    const confirmMsg = document.getElementById('confirmMessage');
    confirmMsg.textContent = `Are you sure you want to delete ${checked.length} selected accounts? This action cannot be undone.`;
    confirmModal.style.display = 'block';
    setTimeout(() => confirmModal.classList.add('active'), 10);
}

async function confirmDelete() {
    const checked = document.querySelectorAll('.delete-checkbox:checked');
    const indicesToDelete = new Set(Array.from(checked).map(cb => parseInt(cb.value)));
    accounts = accounts.filter((_, index) => !indicesToDelete.has(index));
    await saveAccounts();
    renderAccounts();
    updateAllOTP();
    renderDeleteList();
    if (accounts.length === 0) {
        document.getElementById('deleteSelectedBtn').style.display = 'none';
    }
    closeConfirmModal();
}

function closeConfirmModal() {
    const confirmModal = document.getElementById('confirmModal');
    confirmModal.classList.remove('active');
    setTimeout(() => confirmModal.style.display = 'none', 300);
}

// GitHub Functions
async function loadGitSettings() {
    const result = await chrome.storage.local.get(['ghToken', 'ghProjNum']);
    if (result.ghToken) document.getElementById('githubToken').value = result.ghToken;
    if (result.ghProjNum) document.getElementById('githubProjectNumber').value = result.ghProjNum;
    return result;
}

async function saveGitSettings(token, projNum) {
    await chrome.storage.local.set({ ghToken: token, ghProjNum: projNum });
}

async function githubGraphQL(token, query, variables = {}) {
    const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query, variables })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || `GitHub API Error: ${response.status}`);
    }

    if (data.errors) {
        throw new Error(data.errors[0].message);
    }

    if (!data.data) {
        throw new Error('No data returned from GitHub. Check your token permissions.');
    }

    return data.data;
}

async function backupToGitHub() {
    const token = document.getElementById('githubToken').value.trim();
    const projNumStr = document.getElementById('githubProjectNumber').value.trim();
    const statusMsg = document.getElementById('githubMsg');
    statusMsg.style.display = 'block';
    statusMsg.style.color = '#3b82f6';
    statusMsg.textContent = 'Backing up to Project...';

    if (!token || !projNumStr) {
        statusMsg.style.color = '#ef4444';
        statusMsg.textContent = 'Token and Project # are required.';
        return;
    }
    const projNum = parseInt(projNumStr);

    try {
        const backupTitle = 'TOTP_BACKUP_DATA';
        const content = JSON.stringify(accounts, null, 2);
        const findProj = `
      query($number: Int!) {
        viewer {
          projectV2(number: $number) {
            id
            items(first: 100) {
              nodes {
                id
                content {
                  ... on DraftIssue {
                    id
                    title
                  }
                }
              }
            }
          }
        }
      }
    `;
        const projData = await githubGraphQL(token, findProj, { number: projNum });
        const project = projData.viewer && projData.viewer.projectV2;
        if (!project) throw new Error('Project not found in your account.');
        const existingItem = project.items.nodes.find(node => node.content && node.content.title === backupTitle);

        if (existingItem) {
            const updateMut = `
        mutation($id: ID!, $body: String!) {
          updateProjectV2DraftIssue(input: {draftIssueId: $id, body: $body}) {
            draftIssue { id }
          }
        }
      `;
            await githubGraphQL(token, updateMut, { id: existingItem.content.id, body: content });
        } else {
            const addMut = `
        mutation($projectId: ID!, $title: String!, $body: String!) {
          addProjectV2DraftIssue(input: {projectId: $projectId, title: $title, body: $body}) {
            projectItem { id }
          }
        }
      `;
            await githubGraphQL(token, addMut, { projectId: project.id, title: backupTitle, body: content });
        }
        await saveGitSettings(token, projNumStr);
        statusMsg.style.color = '#166534';
        statusMsg.textContent = 'Backup success!';
    } catch (err) {
        statusMsg.style.color = '#ef4444';
        statusMsg.textContent = err.message;
    }
}

async function restoreFromGitHub() {
    const token = document.getElementById('githubToken').value.trim();
    const projNumStr = document.getElementById('githubProjectNumber').value.trim();
    const statusMsg = document.getElementById('githubMsg');
    statusMsg.style.display = 'block';
    statusMsg.style.color = '#3b82f6';
    statusMsg.textContent = 'Restoring...';

    if (!token || !projNumStr) {
        statusMsg.style.color = '#ef4444';
        statusMsg.textContent = 'Token and Project # are required.';
        return;
    }
    const projNum = parseInt(projNumStr);

    try {
        const backupTitle = 'TOTP_BACKUP_DATA';
        const findProj = `
      query($number: Int!) {
        viewer {
          projectV2(number: $number) {
            items(first: 100) {
              nodes {
                content {
                  ... on DraftIssue {
                    title
                    body
                  }
                }
              }
            }
          }
        }
      }
    `;
        const projData = await githubGraphQL(token, findProj, { number: projNum });
        const project = projData.viewer && projData.viewer.projectV2;
        if (!project) throw new Error('Project not found.');
        const backupItem = project.items.nodes.find(node => node.content && node.content.title === backupTitle);
        if (!backupItem || !backupItem.content.body) throw new Error('No backup found.');
        const restoredAccounts = JSON.parse(backupItem.content.body);

        if (Array.isArray(restoredAccounts)) {
            const currentSecrets = new Set(accounts.map(a => a.secretBase32));
            let addedCount = 0;
            restoredAccounts.forEach(acc => {
                if (!currentSecrets.has(acc.secretBase32)) {
                    accounts.push(acc);
                    addedCount++;
                }
            });
            await saveAccounts();
            await saveGitSettings(token, projNumStr);
            renderAccounts();
            updateAllOTP();
            statusMsg.style.color = '#166534';
            statusMsg.textContent = `Restored! Added ${addedCount} accounts.`;
        }
    } catch (err) {
        statusMsg.style.color = '#ef4444';
        statusMsg.textContent = err.message;
    }
}

// Init
document.addEventListener('DOMContentLoaded', function () {
    const settingsBtn = document.getElementById('settingsBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const submitBtn = document.getElementById('submitBtn');
    const submitManualBtn = document.getElementById('submitManualBtn');
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const modal = document.getElementById('settingsModal');
    const tabs = document.querySelectorAll('.tab');
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearch');
    const ghBackupBtn = document.getElementById('githubBackupBtn');
    const ghRestoreBtn = document.getElementById('githubRestoreBtn');
    const openGuideBtn = document.getElementById('openGuideBtn');

    if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
    if (openGuideBtn) {
        openGuideBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: 'guide.html' });
        });
    }
    if (deleteSelectedBtn) deleteSelectedBtn.addEventListener('click', deleteSelectedAccounts);
    if (selectAllCheckbox) selectAllCheckbox.addEventListener('change', toggleSelectAll);
    if (submitBtn) submitBtn.addEventListener('click', addAccounts);
    if (submitManualBtn) submitManualBtn.addEventListener('click', addManualAccount);

    document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDelete);
    document.getElementById('cancelDeleteBtn').addEventListener('click', closeConfirmModal);
    document.getElementById('confirmModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('confirmModal')) closeConfirmModal();
    });

    if (ghBackupBtn) ghBackupBtn.addEventListener('click', backupToGitHub);
    if (ghRestoreBtn) ghRestoreBtn.addEventListener('click', restoreFromGitHub);

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterAccounts(e.target.value);
        });
    }
    if (clearSearchBtn) clearSearchBtn.addEventListener('click', clearSearch);

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const targetId = `tab-${tab.dataset.tab}`;
            document.getElementById(targetId).classList.add('active');
            if (tab.dataset.tab === 'delete') renderDeleteList();
            if (tab.dataset.tab === 'github') loadGitSettings();
            const errorDiv = document.getElementById('modalError');
            if (errorDiv) errorDiv.style.display = 'none';
        });
    });

    if (modal) {
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeSettings();
        });
    }

    loadAccounts();
    // Timer được gọi bên trong updateAllOTP 
});
