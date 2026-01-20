/**
 * GitHub API integration using Private Gists for backup
 */

const DEFAULT_BACKUP_FILENAME = 'nova_otp_backup.txt';

async function fetchGitHub(token, endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `https://api.github.com${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (response.status === 401) throw new Error('Invalid GitHub Token.');
  if (response.status === 403) throw new Error('GitHub API rate limit or permission error.');

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || `GitHub Error: ${response.status}`);
  }
  return data;
}

/**
 * Finds the backup Gist ID by checking the user's gists for any NovaOTP backup file.
 */
async function findBackupGistId(token, filename) {
  const gists = await fetchGitHub(token, '/gists');
  // First, try to find by the specific filename for this password
  let backupGist = gists.find(g => g.files && g.files[filename]);

  // If not found, try to find any gist containing any NovaOTP backup file (older versions or other passwords)
  if (!backupGist) {
    backupGist = gists.find(g => g.files && Object.keys(g.files).some(fname => fname.startsWith('nova_otp_')));
  }

  return backupGist ? backupGist.id : null;
}

export async function backupToGitHub(token, gistId, content, filename = DEFAULT_BACKUP_FILENAME) {
  let targetGistId = gistId;

  if (!targetGistId) {
    targetGistId = await findBackupGistId(token, filename);
  }

  if (targetGistId) {
    // Update existing Gist - this adds or updates the specific file for this password
    await fetchGitHub(token, `/gists/${targetGistId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        files: {
          [filename]: { content: content }
        }
      })
    });
    return targetGistId;
  } else {
    // Create new private Gist with this file
    const newGist = await fetchGitHub(token, '/gists', {
      method: 'POST',
      body: JSON.stringify({
        description: 'NovaOTP Secure Backup Data',
        public: false,
        files: {
          [filename]: { content: content }
        }
      })
    });
    return newGist.id;
  }
}

export async function restoreFromGitHub(token, gistId, filename = DEFAULT_BACKUP_FILENAME) {
  let targetGistId = gistId;

  if (!targetGistId) {
    targetGistId = await findBackupGistId(token, filename);
  }

  if (!targetGistId) {
    throw new Error('No NovaOTP backup found on your GitHub account.');
  }

  const gist = await fetchGitHub(token, `/gists/${targetGistId}`);
  const file = gist.files[filename];

  if (!file) {
    throw new Error('No backup found for this specific password. Check your password or Gist ID.');
  }

  if (!file.content) {
    if (file.truncated) {
      const rawResponse = await fetch(file.raw_url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return await rawResponse.text();
    }
    throw new Error('Backup file is empty.');
  }

  return file.content;
}
