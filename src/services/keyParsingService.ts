import forge from 'node-forge';

export interface ParsedKeyResult {
    privateKey?: string;
    publicKey?: string;
    certificate?: string;
    type: 'private' | 'public' | 'cert' | 'keystore';
    format: 'PEM' | 'PKCS12' | 'JWK';
}

export const keyParsingService = {
    /**
     * Parses a local file (Blob/File) into a key or certificate.
     */
    async parseFile(file: File, password?: string): Promise<ParsedKeyResult> {
        const buffer = await file.arrayBuffer();
        const fileName = file.name.toLowerCase();

        if (fileName.endsWith('.p12') || fileName.endsWith('.pfx')) {
            return this.parsePkcs12(buffer, password || '');
        }

        const text = new TextDecoder().decode(buffer);
        
        if (text.includes('BEGIN')) {
            return this.parsePem(text, password);
        }

        if (text.trim().startsWith('{')) {
            return this.parseJwk(text);
        }

        throw new Error('Unsupported file format. Please use .pem, .p12, .pfx, or .jwk');
    },

    /**
     * Parses PKCS#12 binary data.
     */
    parsePkcs12(buffer: ArrayBuffer, password: string): ParsedKeyResult {
        const bytes = forge.util.createBuffer(buffer);
        const p12Asn1 = forge.asn1.fromDer(bytes);
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

        let privateKey = '';
        let certificate = '';
        let publicKey = '';

        // Extract safe contents
        for (let i = 0; i < p12.safeContents.length; i++) {
            const safeContents = p12.safeContents[i];
            for (let j = 0; j < safeContents.safeBags.length; j++) {
                const bag = safeContents.safeBags[j];
                if (bag.type === forge.pki.oids.pkcs8ShroudedKeyBag || bag.type === forge.pki.oids.keyBag) {
                    // Normalize to PKCS#8 for Web Crypto compatibility
                    const keyAsn1 = forge.pki.privateKeyToAsn1(bag.key!);
                    const keyInfo = forge.pki.wrapRsaPrivateKey(keyAsn1);
                    privateKey = forge.pki.privateKeyInfoToPem(keyInfo);
                } else if (bag.type === forge.pki.oids.certBag) {
                    certificate = forge.pki.certificateToPem(bag.cert!);
                    publicKey = forge.pki.publicKeyToPem(bag.cert!.publicKey);
                }
            }
        }

        if (!privateKey && !certificate) {
            throw new Error('No keys or certificates found in the PKCS#12 file.');
        }

        return {
            privateKey,
            publicKey,
            certificate,
            type: 'keystore',
            format: 'PKCS12'
        };
    },

    /**
     * Parses PEM text data.
     */
    parsePem(text: string, _password?: string): ParsedKeyResult {
        if (text.includes('BEGIN CERTIFICATE')) {
            const cert = forge.pki.certificateFromPem(text);
            return {
                certificate: text,
                publicKey: forge.pki.publicKeyToPem(cert.publicKey),
                type: 'cert',
                format: 'PEM'
            };
        }

        if (text.includes('BEGIN PUBLIC KEY')) {
            return {
                publicKey: text,
                type: 'public',
                format: 'PEM'
            };
        }

        if (text.includes('BEGIN PRIVATE KEY') || text.includes('BEGIN RSA PRIVATE KEY') || text.includes('BEGIN EC PRIVATE KEY')) {
            // Attempt to normalize to PKCS#8 if it's an RSA key (PKCS#1)
            if (text.includes('BEGIN RSA PRIVATE KEY')) {
                try {
                    const rsaKey = forge.pki.privateKeyFromPem(text);
                    const keyAsn1 = forge.pki.privateKeyToAsn1(rsaKey);
                    const keyInfo = forge.pki.wrapRsaPrivateKey(keyAsn1);
                    const pkcs8 = forge.pki.privateKeyInfoToPem(keyInfo);
                    return {
                        privateKey: pkcs8,
                        type: 'private',
                        format: 'PEM'
                    };
                } catch (e) {
                    console.error('Normalization failed', e);
                }
            }
            return {
                privateKey: text,
                type: 'private',
                format: 'PEM'
            };
        }

        throw new Error('Unrecognized PEM format.');
    },

    /**
     * Parses JWK JSON data.
     */
    parseJwk(text: string): ParsedKeyResult {
        try {
            const jwk = JSON.parse(text);
            // This is a simplified JWK check. Full conversion would need more logic or a library.
            // For now, we'll just return it as a string if it looks like a JWK.
            if (jwk.kty) {
                return {
                    publicKey: text, // Or handle conversion to PEM if needed by jwtService
                    type: jwk.d ? 'private' : 'public',
                    format: 'JWK'
                };
            }
            throw new Error('Not a valid JWK.');
        } catch (e) {
            throw new Error('Failed to parse JWK JSON.');
        }
    },

    /**
     * Derives a Public Key from a Private Key PEM string.
     * Currently supports RSA.
     */
    derivePublicKey(privateKeyPem: string): string | null {
        try {
            if (privateKeyPem.includes('BEGIN RSA PRIVATE KEY') || privateKeyPem.includes('BEGIN PRIVATE KEY')) {
                // forge can handle both PKCS#1 and PKCS#8 RSA keys
                const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
                // Extract public key and convert to PEM
                const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
                return forge.pki.publicKeyToPem(publicKey);
            }
            return null;
        } catch (e) {
            console.error('Failed to derive public key:', e);
            return null;
        }
    }
};
