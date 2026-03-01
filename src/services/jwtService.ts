import type { DecodedJwt, JwtHeader, JwtPayload, VerificationResult, KeyPair } from '../types';
import forge from 'node-forge';

function base64UrlEncode(data: string | Uint8Array): string {
  let inputBytes: Uint8Array;
  if (typeof data === 'string') {
      inputBytes = new TextEncoder().encode(data);
  } else {
      inputBytes = data;
  }
  
  const binaryStr = Array.from(inputBytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binaryStr)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str: string): string {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) {
        str += '=';
    }
    
    const binaryStr = atob(str);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }
    
    return new TextDecoder().decode(bytes);
}

// Helper to fix potential reference error in base64UrlDecode if needed, 
// though logic above used binaryStr, let's clean up the decode function slightly.
function base64UrlDecodeClean(str: string): string {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) { str += '='; }
    const binaryStr = atob(str);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

function exportPem(keyData: ArrayBuffer, type: 'public' | 'private'): string {
    const base64Key = arrayBufferToBase64(keyData);
    const header = type === 'public' ? '-----BEGIN PUBLIC KEY-----' : '-----BEGIN PRIVATE KEY-----';
    const footer = type === 'public' ? '-----END PUBLIC KEY-----' : '-----END PRIVATE KEY-----';
    const chunks = base64Key.match(/.{1,64}/g) || [];
    return `${header}\n${chunks.join('\n')}\n${footer}`;
}

function importPem(pem: string, type: 'public' | 'private') {
    const b64 = pem
        .replace(/-----BEGIN (PUBLIC|PRIVATE) KEY-----/, '')
        .replace(/-----END (PUBLIC|PRIVATE) KEY-----/, '')
        .replace(/\s/g, '');
    return base64ToArrayBuffer(b64);
}


export const jwtService = {
  async generateRsaKeyPair(modulusLength: number = 2048): Promise<KeyPair> {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5', // Fixed algorithm name
        modulusLength: modulusLength,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );

    const publicKeyData = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    const privateKeyData = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

    const kid = crypto.randomUUID().substring(0, 8);
    (jwk as any).kid = kid;
    jwk.use = 'sig';
    jwk.alg = 'RS256';

    return {
      publicKey: exportPem(publicKeyData, 'public'),
      privateKey: exportPem(privateKeyData, 'private'),
      jwks: { keys: [jwk] },
      keyId: kid
    };
  },

  async generateEcKeyPair(namedCurve: string = 'P-256'): Promise<KeyPair> {
      const keyPair = await crypto.subtle.generateKey(
          {
              name: 'ECDSA',
              namedCurve: namedCurve,
          },
          true,
          ['sign', 'verify']
      );

      const publicKeyData = await crypto.subtle.exportKey('spki', keyPair.publicKey);
      const privateKeyData = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
      const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

      const kid = crypto.randomUUID().substring(0, 8);
      (jwk as any).kid = kid;
      jwk.use = 'sig';
      jwk.alg = 'ES256';

      return {
          publicKey: exportPem(publicKeyData, 'public'),
          privateKey: exportPem(privateKeyData, 'private'),
          jwks: { keys: [jwk] },
          keyId: kid
      };
  },

  async sign(header: JwtHeader, payload: JwtPayload, key: string): Promise<string> {
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const dataToSign = `${encodedHeader}.${encodedPayload}`;
    
    let signature: ArrayBuffer;

    if (header.alg === 'HS256') {
        const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(dataToSign));
    } else if (header.alg === 'RS256') {
        const privateKeyBuffer = importPem(key, 'private');
        const cryptoKey = await crypto.subtle.importKey('pkcs8', privateKeyBuffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
        signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(dataToSign));
    } else if (header.alg === 'ES256') {
        const privateKeyBuffer = importPem(key, 'private');
        const cryptoKey = await crypto.subtle.importKey('pkcs8', privateKeyBuffer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
        signature = await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, cryptoKey, new TextEncoder().encode(dataToSign));
    } else {
        throw new Error(`Unsupported algorithm: ${header.alg}`);
    }

    const signatureBytes = new Uint8Array(signature);
    // Manual base64url encoding for signature bytes to avoid btoa issues with binary
    let binary = '';
    const len = signatureBytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(signatureBytes[i]);
    }
    const encodedSignature = btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    return `${dataToSign}.${encodedSignature}`;
  },

  decode(token: string): DecodedJwt | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      
      const [encodedHeader, encodedPayload, signature] = parts;

      const header: JwtHeader = JSON.parse(base64UrlDecodeClean(encodedHeader));
      const payload: JwtPayload = JSON.parse(base64UrlDecodeClean(encodedPayload));

      return {
        header,
        payload,
        signature,
        raw: { header: encodedHeader, payload: encodedPayload, token }
      };
    } catch (error) {
      console.error("Failed to decode token:", error);
      return null;
    }
  },

  async verify(token: string, key: string, options?: { audience?: string; issuer?: string }): Promise<VerificationResult> {
    const decoded = this.decode(token);
    if (!decoded) {
      return { isValid: false, reason: 'Token is malformed or could not be decoded.' };
    }
    
    const { header, payload, raw } = decoded;
    
    if (header.alg === 'none') {
        return { isValid: false, reason: 'Algorithm "none" is not accepted for security reasons.' };
    }

    const dataToSign = `${raw.header}.${raw.payload}`;
    
    const sigStr = decoded.signature.replace(/-/g, '+').replace(/_/g, '/');
    const pad = sigStr.length % 4;
    const paddedSig = pad ? sigStr + '='.repeat(4 - pad) : sigStr;
    const signatureBytes = new Uint8Array(atob(paddedSig).split('').map(c => c.charCodeAt(0)));

    try {
      let isValidSignature = false;
      if (header.alg === 'HS256') {
          const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
          isValidSignature = await crypto.subtle.verify('HMAC', cryptoKey, signatureBytes, new TextEncoder().encode(dataToSign));
      } else if (header.alg === 'RS256') {
          const publicKeyBuffer = importPem(key, 'public');
          const cryptoKey = await crypto.subtle.importKey('spki', publicKeyBuffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
          isValidSignature = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signatureBytes, new TextEncoder().encode(dataToSign));
      } else if (header.alg === 'ES256') {
          const publicKeyBuffer = importPem(key, 'public');
          const cryptoKey = await crypto.subtle.importKey('spki', publicKeyBuffer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
          isValidSignature = await crypto.subtle.verify({ name: 'ECDSA', hash: { name: 'SHA-256' } }, cryptoKey, signatureBytes, new TextEncoder().encode(dataToSign));
      } else {
        return { isValid: false, reason: `Unsupported algorithm "${header.alg}" for verification.` };
      }

      if (!isValidSignature) {
        return { isValid: false, reason: 'Signature is invalid.' };
      }

      const now = Math.floor(Date.now() / 1000);
      const tolerance = 2;

      if (payload.exp && now > (payload.exp + tolerance)) {
        return { isValid: false, reason: `Token expired at ${new Date(payload.exp * 1000).toLocaleString()}.` };
      }

      if (payload.nbf && now < (payload.nbf - tolerance)) {
        return { isValid: false, reason: `Token is not valid before ${new Date(payload.nbf * 1000).toLocaleString()}.` };
      }
      
      if (options?.audience && payload.aud && payload.aud !== options.audience) {
        return { isValid: false, reason: `Invalid audience. Expected "${options.audience}", but got "${payload.aud}".` };
      }

      if (options?.issuer && payload.iss && payload.iss !== options.issuer) {
        return { isValid: false, reason: `Invalid issuer. Expected "${options.issuer}", but got "${payload.iss}".` };
      }

      return { isValid: true, reason: 'Token signature and claims are valid.' };
    } catch (error: any) {
      console.error('Verification error:', error);
      return { isValid: false, reason: `Verification failed: ${error.message}` };
    }
  },

  async sha256(plain: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return crypto.subtle.digest('SHA-256', data);
  },

  base64UrlEncode(buffer: ArrayBuffer): string {
    return arrayBufferToBase64(buffer)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  },

  async fetchJwks(issuer: string): Promise<any> {
    try {
      const discoveryUrl = issuer.replace(/\/$/, '') + '/.well-known/openid-configuration';
      const response = await fetch(discoveryUrl);
      const config = await response.json();
      if (!config.jwks_uri) throw new Error('No JWKS URI found in discovery document');
      
      const jwksResponse = await fetch(config.jwks_uri);
      return await jwksResponse.json();
    } catch (e: any) {
      throw new Error(`Failed to fetch JWKS: ${e.message}`);
    }
  },

  async validateIdToken(token: string, issuer: string, audience: string): Promise<VerificationResult> {
    const decoded = this.decode(token);
    if (!decoded) return { isValid: false, reason: 'Malformed token' };

    if (decoded.payload.iss !== issuer) {
      return { isValid: false, reason: `Issuer mismatch. Expected ${issuer}, got ${decoded.payload.iss}` };
    }

    if (decoded.payload.aud !== audience) {
      return { isValid: false, reason: `Audience mismatch. Expected ${audience}, got ${decoded.payload.aud}` };
    }

    const now = Math.floor(Date.now() / 1000);
    if (decoded.payload.exp && decoded.payload.exp < now) {
      return { isValid: false, reason: 'Token has expired' };
    }

    try {
      const jwks = await this.fetchJwks(issuer);
      const kid = decoded.header.kid;
      const key = jwks.keys.find((k: any) => k.kid === kid);
      
      if (!key) {
        return { isValid: false, reason: `Key with kid "${kid}" not found in JWKS` };
      }
      return { isValid: true, reason: 'Token claims are valid and matching key found in JWKS.' };
    } catch (e: any) {
      return { isValid: false, reason: `Signature verification failed: ${e.message}` };
    }
  },

  /**
   * Exports keys/certificates to a PKCS#12 (.p12) binary format.
   */
  exportToPkcs12(privateKeyPem: string, certificatePem: string | null, password: string, alias: string): Uint8Array {
    try {
      const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
      
      let cert;
      if (certificatePem) {
        cert = forge.pki.certificateFromPem(certificatePem);
      } else {
        // Generate a minimal self-signed certificate if none provided
        // This is often required for P12 files to be valid in many tools
        cert = forge.pki.createCertificate();
        cert.publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
        cert.serialNumber = '01';
        cert.validity.notBefore = new Date();
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
        
        const attrs = [{
          name: 'commonName',
          value: alias
        }];
        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        cert.sign(privateKey);
      }

      const p12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, [cert], password, {
        generateLocalKeyId: true,
        friendlyName: alias,
        algorithm: 'aes128'
      });

      const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
      const p12Uint8 = new Uint8Array(p12Der.length);
      for (let i = 0; i < p12Der.length; i++) {
        p12Uint8[i] = p12Der.charCodeAt(i);
      }
      return p12Uint8;
    } catch (e: any) {
      console.error('PKCS#12 Export Error:', e);
      throw new Error(`Failed to generate PKCS#12: ${e.message}`);
    }
  },

  /**
   * Triggers a browser download for binary or text content.
   */
  downloadFile(content: string | Uint8Array, filename: string, contentType: string) {
    const blob = new Blob([content as any], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
};
