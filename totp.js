const TOTP = (() => {
  const BITS_IN_BYTE = 8;
  const STEP_SECONDS = 30;
  const CODE_LENGTH = 6;
  const ALGORITHM = 'SHA-1';
  
  function base32ToBuffer(base32) {
    const map = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let buffer = [];
    let bits = 0;
    let value = 0;
    base32 = base32.replace(/=+$/, '').toUpperCase();
    
    for(let i = 0; i < base32.length; i++) {
      const char = base32.charAt(i);
      const index = map.indexOf(char);
      if(index === -1) throw new Error('Invalid base32 character');
      value = (value << 5) | index;
      bits += 5;
      while(bits >= BITS_IN_BYTE) {
        bits -= BITS_IN_BYTE;
        buffer.push((value >> bits) & 0xFF);
      }
    }
    return new Uint8Array(buffer).buffer;
  }
  
  async function generateHMAC(key, data) {
    const cryptoKey = await crypto.subtle.importKey('raw', key, {
      name: 'HMAC',
      hash: {name: ALGORITHM}
    }, false, ['sign']);
    return await crypto.subtle.sign('HMAC', cryptoKey, data);
  }
  
  async function generateCode(secretBase32, digits = CODE_LENGTH) {
    try {
      const keyBuffer = base32ToBuffer(secretBase32);
      const epoch = Math.floor(Date.now() / 1000);
      const timeStep = Math.floor(epoch / STEP_SECONDS);
      const counterBuffer = new ArrayBuffer(8);
      const counterView = new DataView(counterBuffer);
      counterView.setUint32(0, 0, false);
      counterView.setUint32(4, timeStep, false);
      
      const hmac = await generateHMAC(keyBuffer, counterBuffer);
      const hmacView = new DataView(hmac);
      const offset = hmacView.getUint8(hmac.byteLength - 1) & 0x0F;
      const truncatedHash = hmacView.getUint32(offset, false) & 0x7FFFFFFF;
      const powerOfTen = Math.pow(10, digits);
      let code = (truncatedHash % powerOfTen).toString();
      
      // Đảm bảo luôn có đủ số chữ số
      while(code.length < digits) {
        code = '0' + code;
      }
      
      return code;
    } catch (err) {
      console.error('TOTP generation error:', err);
      return '------';
    }
  }
  
  return {generate: generateCode};
})();