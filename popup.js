let accounts = [];
let accountColors = {}; // Lưu màu cho từng account
let currentContextAccount = null;

// Load accounts from storage
async function loadAccounts() {
  try {
    const result = await chrome.storage.local.get(['accounts', 'accountColors']);
    accounts = result.accounts || [];
    accountColors = result.accountColors || {};
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

// Save account colors
async function saveAccountColors() {
  try {
    await chrome.storage.local.set({ accountColors });
  } catch (err) {
    console.error('Error saving colors:', err);
  }
}

// Get color for account
function getAccountColor(index) {
  return accountColors[index] || '#667eea';
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
    emptyState.style.display = 'block';
    accountsList.innerHTML = '';
  } else {
    emptyState.style.display = 'none';
    
    accountsList.innerHTML = accounts.map((account, index) => {
      const color = getAccountColor(index);
      return `
      <div class="account-item" data-index="${index}">
        <div class="account-info">
          <div class="account-name">${escapeHtml(account.issuer || account.name)}</div>
          ${account.issuer && account.name ? `<div class="account-issuer">${escapeHtml(account.name)}</div>` : ''}
        </div>
        <div class="otp-display">
          <div class="otp-code" id="otp-${index}" style="color: ${color}">------</div>
        </div>
      </div>
    `;
    }).join('<div class="separator"></div>');

    // Add click listeners to account items
    document.querySelectorAll('.account-item').forEach(item => {
      // Left click - copy code
      item.addEventListener('click', function(e) {
        if (e.button === 0) { // Left click
          const index = parseInt(this.dataset.index);
          copyCode(index);
        }
      });

      // Right click - show color picker
      item.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        const index = parseInt(this.dataset.index);
        currentContextAccount = index;
        showColorPicker(e.pageX, e.pageY);
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

// Show color picker menu
function showColorPicker(x, y) {
  const menu = document.getElementById('colorPickerMenu');
  const input = document.getElementById('colorPickerInput');
  
  // Set current color
  if (currentContextAccount !== null) {
    const currentColor = getAccountColor(currentContextAccount);
    input.value = currentColor;
  }
  
  // Show menu first to get its dimensions
  menu.classList.add('show');
  
  // Get menu dimensions
  const menuRect = menu.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // Calculate position to keep menu within viewport
  let left = x;
  let top = y;
  
  // Adjust horizontal position if menu would overflow right
  if (left + menuRect.width > viewportWidth) {
    left = viewportWidth - menuRect.width - 10;
  }
  
  // Adjust vertical position if menu would overflow bottom
  if (top + menuRect.height > viewportHeight) {
    top = viewportHeight - menuRect.height - 10;
  }
  
  // Ensure menu doesn't go off left or top edge
  if (left < 10) left = 10;
  if (top < 10) top = 10;
  
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

// Hide color picker menu
function hideColorPicker() {
  const menu = document.getElementById('colorPickerMenu');
  menu.classList.remove('show');
  currentContextAccount = null;
}

// Apply color to account
async function applyColorToAccount(index, color) {
  accountColors[index] = color;
  await saveAccountColors();
  
  // Update the OTP code color immediately
  const otpElement = document.getElementById(`otp-${index}`);
  if (otpElement) {
    otpElement.style.color = color;
  }
  
  hideColorPicker();
}

// Open modal
function openSettings() {
  const modal = document.getElementById('settingsModal');
  const input = document.getElementById('uriInput');
  const error = document.getElementById('modalError');
  
  modal.classList.add('active');
  input.value = '';
  error.style.display = 'none';
}

// Close modal
function closeSettings() {
  const modal = document.getElementById('settingsModal');
  modal.classList.remove('active');
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

// Clear all accounts
async function clearAccounts() {
  if (confirm('Bạn có chắc muốn xóa tất cả tài khoản?')) {
    accounts = [];
    await saveAccounts();
    renderAccounts();
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  // Event listeners
  const settingsBtn = document.getElementById('settingsBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const clearBtn = document.getElementById('clearBtn');
  const submitBtn = document.getElementById('submitBtn');
  const modal = document.getElementById('settingsModal');

  if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
  if (clearBtn) clearBtn.addEventListener('click', clearAccounts);
  if (submitBtn) submitBtn.addEventListener('click', addAccounts);

  // Color picker event listeners
  const colorPickerInput = document.getElementById('colorPickerInput');
  if (colorPickerInput) {
    colorPickerInput.addEventListener('change', function() {
      const color = this.value;
      if (currentContextAccount !== null) {
        applyColorToAccount(currentContextAccount, color);
      }
    });
    
    // Also update on input (real-time preview)
    colorPickerInput.addEventListener('input', function() {
      const color = this.value;
      if (currentContextAccount !== null) {
        const otpElement = document.getElementById(`otp-${currentContextAccount}`);
        if (otpElement) {
          otpElement.style.color = color;
        }
      }
    });
  }

  // Hide color picker when clicking outside
  document.addEventListener('click', function(e) {
    const menu = document.getElementById('colorPickerMenu');
    if (!menu.contains(e.target) && e.button === 0) {
      hideColorPicker();
    }
  });

  // Close modal when clicking outside
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        closeSettings();
      }
    });
  }

  // Load accounts and start timer
  loadAccounts();
  updateTimer();
});
