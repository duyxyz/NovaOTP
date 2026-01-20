import { base32Encode } from './utils.js';

/**
 * Parses Google Authenticator migration protobuf data
 */
export function parseProtobuf(bytes) {
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

export function parseAccount(bytes) {
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
