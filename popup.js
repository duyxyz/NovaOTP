let accounts = [];


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

  // Force 6 digits nếu không hợp lệ
  if (!account.digits || account.digits < 6 || account.digits > 8) {
    account.digits = 6;
  }

  console.log('Parsed account:', account);
  return account;
}

// Render accounts - LIST VERSION
function renderAccounts() {
  const emptyState = document.getElementById('emptyState');
  const accountsList = document.getElementById('accountsList');

  if (accounts.length === 0) {
    emptyState.style.display = 'flex';
    accountsList.innerHTML = '';
  } else {
    emptyState.style.display = 'none';

    accountsList.innerHTML = accounts.map((account, index) => {
      return `
      <div class="account-item" data-index="${index}">
        <div class="account-info">
          <div class="account-name">${escapeHtml(account.issuer || account.name)}</div>
          ${account.issuer && account.name ? `<div class="account-issuer">${escapeHtml(account.name)}</div>` : ''}
        </div>
        <div class="otp-display">
          <div class="otp-code" id="otp-${index}">------</div>
        </div>
      </div>
    `;
    }).join('<div class="separator"></div>');

    // Add click listeners to account items
    document.querySelectorAll('.account-item').forEach(item => {
      // Left click - copy code
      item.addEventListener('click', function (e) {
        const index = parseInt(this.dataset.index);
        copyCode(index);
      });
    });
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
        console.log(`Generating OTP for ${account.issuer || account.name} with ${account.digits} digits`);
        const code = await TOTP.generate(account.secretBase32, account.digits);
        console.log(`Generated code: ${code} (length: ${code.length})`);
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

      // Visual feedback on item
      if (itemElement) {
        itemElement.classList.add('copied');
        setTimeout(() => {
          itemElement.classList.remove('copied');
        }, 1000);
      }
    } catch (err) {
      console.error('Không thể copy:', err);
    }
  }
}



// Open modal
function openSettings() {
  const modal = document.getElementById('settingsModal');
  const input = document.getElementById('uriInput');
  const error = document.getElementById('modalError');

  modal.style.display = 'block';
  // Force reflow
  modal.offsetHeight;
  modal.classList.add('active');

  input.value = '';
  error.style.display = 'none';
}

// Close modal
function closeSettings() {
  const modal = document.getElementById('settingsModal');
  modal.classList.remove('active');

  // Wait for transition to finish before hiding
  setTimeout(() => {
    modal.style.display = 'none';
  }, 300); // match transition duration
}

// Add accounts from URI
async function addAccounts() {
  const uri = document.getElementById('uriInput').value.trim();
  const errorDiv = document.getElementById('modalError');

  errorDiv.style.display = 'none';

  try {
    if (!uri.startsWith('otpauth-migration://offline?data=')) {
      throw new Error('URI không hợp lệ. URI phải bắt đầu với "otpauth-migration://offline?data="');
    }

    const dataParam = uri.split('data=')[1];
    if (!dataParam) {
      throw new Error('Không tìm thấy dữ liệu trong URI');
    }

    const base64Data = decodeURIComponent(dataParam);
    const bytes = decodeBase64(base64Data);
    const newAccounts = parseProtobuf(bytes);

    if (newAccounts.length === 0) {
      throw new Error('Không tìm thấy tài khoản nào trong dữ liệu');
    }

    // Add new accounts
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
    if (!name) throw new Error('Vui lòng nhập tên tài khoản');
    if (!secret) throw new Error('Vui lòng nhập Secret Key');

    // Validate Base32
    const base32Regex = /^[A-Z2-7]+=*$/;
    if (!base32Regex.test(secret)) {
      throw new Error('Secret Key không hợp lệ (Chỉ chấp nhận chữ A-Z và số 2-7)');
    }

    const newAccount = {
      secretBase32: secret,
      name: name,
      issuer: issuer || '',
      type: 'TOTP',
      digits: 6,
      period: 30
    };

    // Add and save
    accounts.push(newAccount);
    await saveAccounts();
    renderAccounts();
    updateAllOTP();

    // Clear inputs upon success
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

// Render Delete List (with checkboxes)
function renderDeleteList() {
  const container = document.getElementById('deleteList');
  const deleteBtn = document.getElementById('deleteSelectedBtn');
  const selectAll = document.getElementById('selectAllCheckbox');

  if (!container) return;

  // Reset select all checkbox
  if (selectAll) selectAll.checked = false;

  if (accounts.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:10px;">Không có tài khoản nào</div>';
    deleteBtn.style.display = 'none';
    if (selectAll) selectAll.disabled = true;
    return;
  }

  if (selectAll) selectAll.disabled = false;

  container.innerHTML = accounts.map((acc, idx) => `
    <label class="delete-list-item">
      <input type="checkbox" class="delete-checkbox" value="${idx}">
      <span>${escapeHtml(acc.issuer ? acc.issuer + ' (' + acc.name + ')' : acc.name)}</span>
    </label>
  `).join('');

  deleteBtn.style.display = 'block';

  // Add listener to individual checkboxes to update Select All state
  const checkboxes = document.querySelectorAll('.delete-checkbox');
  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const allChecked = Array.from(checkboxes).every(c => c.checked);
      if (selectAll) selectAll.checked = allChecked;
    });
  });
}

// Delete selected accounts
async function deleteSelectedAccounts() {
  const checked = document.querySelectorAll('.delete-checkbox:checked');
  if (checked.length === 0) {
    alert('Vui lòng chọn ít nhất 1 tài khoản để xóa');
    return;
  }

  if (!confirm(`Bạn có chắc muốn xóa ${checked.length} tài khoản đã chọn?`)) {
    return;
  }

  // Get indices to delete
  const indicesToDelete = new Set(Array.from(checked).map(cb => parseInt(cb.value)));

  // Filter out deleted accounts
  accounts = accounts.filter((_, index) => !indicesToDelete.has(index));

  await saveAccounts();

  // Update UI main list
  renderAccounts();
  updateAllOTP(); // Generate codes for remaining accounts

  // Update delete list in modal
  renderDeleteList();

  // If no accounts left, update empty state visuals manually if needed or just let renderAccounts handle it
  if (accounts.length === 0) {
    document.getElementById('deleteSelectedBtn').style.display = 'none';
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
  // Event listeners
  const settingsBtn = document.getElementById('settingsBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const submitBtn = document.getElementById('submitBtn');
  const submitManualBtn = document.getElementById('submitManualBtn');
  const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
  const selectAllCheckbox = document.getElementById('selectAllCheckbox');
  const modal = document.getElementById('settingsModal');
  const tabs = document.querySelectorAll('.tab');

  if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
  if (deleteSelectedBtn) deleteSelectedBtn.addEventListener('click', deleteSelectedAccounts);
  if (selectAllCheckbox) selectAllCheckbox.addEventListener('change', toggleSelectAll);
  if (submitBtn) submitBtn.addEventListener('click', addAccounts);
  if (submitManualBtn) submitManualBtn.addEventListener('click', addManualAccount);

  // Tab Switching Logic
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active from all tabs and contents
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      // Add active to clicked tab
      tab.classList.add('active');

      // Show corresponding content
      const targetId = `tab-${tab.dataset.tab}`;
      document.getElementById(targetId).classList.add('active');

      // If clicking Options tab, render the delete list
      if (tab.dataset.tab === 'options') {
        renderDeleteList();
      }

      // Clear errors
      const errorDiv = document.getElementById('modalError');
      if (errorDiv) errorDiv.style.display = 'none';
    });
  });

  // Color picker event listeners


  // Close modal when clicking outside
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        closeSettings();
      }
    });
  }

  // Load accounts and start timer
  loadAccounts();
  updateTimer();
});
