import { escapeHtml, createRipple } from './utils.js';
import TOTP from './otp-engine.js';

/**
 * UI Management for OTP Viewer
 */

export function renderAccounts(accounts, currentSearchQuery, onCopy, onReorder) {
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
          <span class="material-icons" style="font-size: 16px;">drag_indicator</span>
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

        // Add click and drag listeners
        document.querySelectorAll('.account-item').forEach(item => {
            const handle = item.querySelector('.drag-handle');

            handle.addEventListener('mousedown', () => item.setAttribute('draggable', 'true'));
            handle.addEventListener('mouseup', () => item.removeAttribute('draggable'));

            item.addEventListener('click', function (e) {
                if (this.classList.contains('dragging') || e.target.closest('.drag-handle')) return;
                createRipple(e);
                const index = parseInt(this.dataset.index);
                onCopy(index);
            });

            item.addEventListener('dragstart', (e) => {
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            item.addEventListener('dragend', async () => {
                item.classList.remove('dragging');
                item.removeAttribute('draggable');
                onReorder();
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
            filterAccounts(accounts, currentSearchQuery);
        }
    }
}

export function filterAccounts(accounts, query) {
    const currentSearchQuery = query.toLowerCase().trim();
    const clearBtn = document.getElementById('clearSearch');
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

export async function updateAllOTP(accounts) {
    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        const otpElement = document.getElementById(`otp-${i}`);

        if (otpElement) {
            try {
                const secret = account.secretBase32 || account.secret;
                if (!secret) throw new Error('No secret found');
                const code = await TOTP.generate(secret, account.digits);
                otpElement.textContent = code;
            } catch (err) {
                console.error('Error generating OTP:', err);
                otpElement.textContent = 'ERROR';
            }
        }
    }
}

export function renderDeleteList(accounts) {
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

    container.innerHTML = accounts.map((acc, idx) => {
        const initial = (acc.issuer || acc.name || '?').charAt(0).toUpperCase();
        return `
      <label class="delete-card" data-idx="${idx}">
        <input type="checkbox" class="delete-checkbox" value="${idx}" style="display: none;">
        <div class="selection-indicator">
          <span class="material-icons">check_circle</span>
        </div>
        <div class="card-avatar">${initial}</div>
        <div class="card-info">
          <div class="card-name">${escapeHtml(acc.issuer || acc.name)}</div>
          <div class="card-issuer">${escapeHtml(acc.name)}</div>
        </div>
      </label>
    `;
    }).join('');

    const checkboxes = document.querySelectorAll('.delete-checkbox');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            cb.closest('.delete-card').classList.toggle('selected', cb.checked);
            const allChecked = Array.from(checkboxes).every(c => c.checked);
            if (selectAll) selectAll.checked = allChecked;
        });
    });

    document.querySelectorAll('.delete-list-item').forEach(item => {
        item.addEventListener('click', createRipple);
    });

    deleteBtn.style.display = 'block';

    if (selectAll) {
        selectAll.onchange = () => {
            checkboxes.forEach(cb => {
                cb.checked = selectAll.checked;
                cb.closest('.delete-card').classList.toggle('selected', cb.checked);
            });
        };
    }
}

export function renderEditList(accounts, onEditSelect) {
    const container = document.getElementById('editList');
    if (!container) return;

    if (accounts.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:10px;">No accounts available to edit</div>';
        return;
    }

    container.innerHTML = accounts.map((acc, idx) => `
    <div class="edit-list-item" data-idx="${idx}">
      <div class="item-info">
        <div class="item-name">${escapeHtml(acc.issuer || acc.name)}</div>
        <div class="item-issuer">${escapeHtml(acc.name)}</div>
      </div>
      <span class="material-icons edit-icon">edit</span>
    </div>
  `).join('');

    container.querySelectorAll('.edit-list-item').forEach(item => {
        item.addEventListener('click', (e) => {
            createRipple(e);
            onEditSelect(parseInt(item.dataset.idx));
        });
    });
}

export function openSettings() {
    const modal = document.getElementById('settingsModal');
    const input = document.getElementById('uriInput');
    const error = document.getElementById('modalError');

    modal.style.display = 'block';
    modal.offsetHeight;
    modal.classList.add('active');

    input.value = '';
    error.style.display = 'none';
}

export function closeSettings() {
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

export function openConfirmModal({ title, message, confirmText, confirmColor = '#ef4444', icon = 'help_outline', onConfirm }) {
    const modal = document.getElementById('confirmModal');
    const titleEl = modal.querySelector('h3');
    const messageEl = document.getElementById('confirmMessage');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    const iconEl = modal.querySelector('.material-icons');
    const iconContainer = iconEl.parentElement;

    // Set content
    titleEl.textContent = title || 'Confirm Action';
    messageEl.textContent = message || 'Are you sure?';
    confirmBtn.textContent = confirmText || 'Confirm';
    confirmBtn.style.backgroundColor = confirmColor;
    iconEl.textContent = icon;
    iconEl.style.color = confirmColor;
    iconContainer.style.background = confirmColor + '1a'; // 10% opacity

    // Show modal
    modal.style.display = 'block';
    setTimeout(() => modal.classList.add('active'), 10);

    // Remove old listeners (by replacing node)
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    newConfirmBtn.addEventListener('click', () => {
        onConfirm();
        closeConfirmModal();
    });

    // Cancel listener
    const cancelBtn = document.getElementById('cancelDeleteBtn');
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    newCancelBtn.addEventListener('click', closeConfirmModal);

    // Backdrop click
    modal.onclick = (e) => {
        if (e.target === modal) closeConfirmModal();
    };
}

export function closeConfirmModal() {
    const confirmModal = document.getElementById('confirmModal');
    confirmModal.classList.remove('active');
    setTimeout(() => confirmModal.style.display = 'none', 300);
}

// --- Issue 4: Consolidated UI Helpers ---

/**
 * Show error message in the settings modal
 */
export function setModalError(message) {
    const errorDiv = document.getElementById('modalError');
    if (!errorDiv) return;

    if (message) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    } else {
        errorDiv.style.display = 'none';
    }
}

/**
 * Show status message for GitHub operations
 * @param {string} message - Message to show
 * @param {string} type - 'error' | 'success' | 'progress'
 */
export function setGitHubStatus(message, type = 'progress') {
    const statusMsg = document.getElementById('githubMsg');
    if (!statusMsg) return;

    statusMsg.style.display = 'block';
    if (type === 'error') statusMsg.style.color = '#ef4444';
    else if (type === 'success') statusMsg.style.color = '#166534';
    else statusMsg.style.color = '#3b82f6';

    statusMsg.textContent = message;
}

/**
 * Show status message for Edit operations
 * @param {string} message - Message to show
 * @param {string} type - 'error' | 'success' | 'progress'
 */
export function setEditStatus(message, type = 'progress') {
    const statusMsg = document.getElementById('editMsg');
    if (!statusMsg) return;

    statusMsg.style.display = 'block';
    if (type === 'error') statusMsg.style.color = '#ef4444';
    else if (type === 'success') statusMsg.style.color = '#166534';
    else statusMsg.style.color = '#3b82f6';

    statusMsg.textContent = message;
}

/**
 * Clear input fields by ID
 */
export function clearInputs(ids) {
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

/**
 * Issue 5: Optimized Drag & Drop updates
 * Updates the data-index and related IDs of all account items in the DOM
 */
export function updateDOMIndices() {
    const items = document.querySelectorAll('.account-item');
    items.forEach((item, idx) => {
        item.dataset.index = idx;
        const otpElement = item.querySelector('.otp-code');
        if (otpElement) {
            otpElement.id = `otp-${idx}`;
        }
    });
}
